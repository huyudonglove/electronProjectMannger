import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { AgentCoreError } from '@electron-manager/agent-core'
import {
  renderRepositoryMapDirectoryCount,
  renderRepositoryMapHeader,
  renderRepositoryMapOmittedLines,
  renderRepositoryMapTreeHeading,
} from '@electron-manager/agent-prompts'

import {
  DEFAULT_REPO_MAP_EXCLUDED_DIRECTORIES,
  REPO_MAP_SCHEMA_VERSION,
  type RepoMapOptions,
  type RepoMapSnapshot,
  type ResolvedRepoMapOptions,
} from './types.js'

const exec = promisify(execFile)

interface ScanResult {
  strategy: RepoMapSnapshot['strategy']
  paths: string[]
  totalFiles: number
  truncated: boolean
}

interface DirectoryNode {
  directories: Map<string, DirectoryNode>
  files: string[]
  fileCount: number
}

export function resolveRepoMapOptions(options: RepoMapOptions = {}): ResolvedRepoMapOptions {
  const excludedDirectories = [...new Set(
    (options.excludedDirectories ?? [...DEFAULT_REPO_MAP_EXCLUDED_DIRECTORIES]).map((value) => value.trim()),
  )].sort((left, right) => left.localeCompare(right))
  if (excludedDirectories.some((value) => !value || value === '.' || value === '..' || value.includes('/') || value.includes('\\'))) {
    throw new AgentCoreError('INVALID_INPUT', 'Repo map excluded directories must be non-empty directory names')
  }
  return {
    maxFiles: positiveInteger(options.maxFiles ?? 5_000, 'maxFiles'),
    maxDepth: positiveInteger(options.maxDepth ?? 4, 'maxDepth'),
    maxOutputBytes: minimumInteger(options.maxOutputBytes ?? 32_000, 256, 'maxOutputBytes'),
    excludedDirectories,
  }
}

export async function buildRepoMap(projectRoot: string, options: RepoMapOptions = {}): Promise<RepoMapSnapshot> {
  const root = await resolveProjectDirectory(projectRoot)
  const resolved = resolveRepoMapOptions(options)
  const scanned = await scanWithGit(root, resolved).catch(() => scanWithFileSystem(root, resolved))
  const content = renderRepoMap(scanned, resolved)
  const revision = hash(canonicalJson({
    schemaVersion: REPO_MAP_SCHEMA_VERSION,
    totalFiles: scanned.totalFiles,
    truncated: scanned.truncated,
    options: resolved,
    paths: scanned.paths,
  }))
  return {
    schemaVersion: REPO_MAP_SCHEMA_VERSION,
    revision,
    strategy: scanned.strategy,
    totalFiles: scanned.totalFiles,
    mappedFiles: scanned.paths.length,
    truncated: scanned.truncated,
    options: structuredClone(resolved),
    paths: [...scanned.paths],
    content,
  }
}

async function resolveProjectDirectory(projectRoot: string) {
  if (!projectRoot.trim()) throw new AgentCoreError('INVALID_INPUT', 'Repo map project root is required')
  const resolved = await realpath(path.resolve(projectRoot)).catch((error) => {
    throw new AgentCoreError('INVALID_INPUT', 'Repo map project root does not exist', { cause: error })
  })
  const details = await stat(resolved)
  if (!details.isDirectory()) throw new AgentCoreError('INVALID_INPUT', 'Repo map project root must be a directory')
  return resolved
}

async function scanWithGit(root: string, options: ResolvedRepoMapOptions): Promise<ScanResult> {
  const { stdout } = await exec('git', [
    '-C',
    root,
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
  ], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  })
  const allPaths = normalizePaths(stdout.split('\0').filter(Boolean), options.excludedDirectories)
  return {
    strategy: 'git',
    paths: allPaths.slice(0, options.maxFiles),
    totalFiles: allPaths.length,
    truncated: allPaths.length > options.maxFiles,
  }
}

async function scanWithFileSystem(root: string, options: ResolvedRepoMapOptions): Promise<ScanResult> {
  const excluded = new Set(options.excludedDirectories)
  const paths: string[] = []
  let truncated = false

  async function visit(relativeDirectory: string): Promise<void> {
    const absoluteDirectory = path.join(root, relativeDirectory)
    const entries = (await readdir(absoluteDirectory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (paths.length >= options.maxFiles) {
        truncated = true
        return
      }
      if (entry.isSymbolicLink()) continue
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!excluded.has(entry.name)) await visit(relative)
        if (truncated) return
      } else if (entry.isFile()) {
        paths.push(relative)
      }
    }
  }

  await visit('')
  return {
    strategy: 'filesystem',
    paths,
    totalFiles: paths.length,
    truncated,
  }
}

function normalizePaths(values: string[], excludedDirectories: string[]) {
  const excluded = new Set(excludedDirectories)
  return [...new Set(values.flatMap((value) => {
    const normalized = value.replaceAll('\\', '/')
    if (!isSafeRelativePath(normalized)) return []
    const segments = normalized.split('/')
    if (segments.some((segment) => excluded.has(segment))) return []
    return [normalized]
  }))].sort((left, right) => left.localeCompare(right))
}

function isSafeRelativePath(value: string) {
  if (!value || value.includes('\0') || path.posix.isAbsolute(value)) return false
  const segments = value.split('/')
  return segments.every((segment) => segment && segment !== '.' && segment !== '..')
}

function renderRepoMap(scan: ScanResult, options: ResolvedRepoMapOptions) {
  const discovered = scan.truncated && scan.strategy === 'filesystem'
    ? `${scan.totalFiles}+`
    : String(scan.totalFiles)
  const lines = renderRepositoryMapHeader({
    discovered,
    mapped: scan.paths.length,
    truncated: scan.truncated,
  })
  const root = directoryTree(scan.paths)
  for (const [name, directory] of sortedDirectories(root)) {
    lines.push(`- ${escapeLabel(name)}/ (${renderRepositoryMapDirectoryCount(directory.fileCount)})`)
  }
  for (const file of [...root.files].sort((left, right) => left.localeCompare(right))) {
    lines.push(`- ${escapeLabel(file)}`)
  }
  lines.push(renderRepositoryMapTreeHeading())
  renderDirectory(root, '', 1, options.maxDepth, lines)
  return fitLines(lines, options.maxOutputBytes)
}

function directoryTree(paths: string[]): DirectoryNode {
  const root = node()
  for (const filePath of paths) {
    const segments = filePath.split('/')
    let current = root
    current.fileCount += 1
    for (const segment of segments.slice(0, -1)) {
      let child = current.directories.get(segment)
      if (!child) {
        child = node()
        current.directories.set(segment, child)
      }
      child.fileCount += 1
      current = child
    }
    current.files.push(segments.at(-1)!)
  }
  return root
}

function node(): DirectoryNode {
  return { directories: new Map(), files: [], fileCount: 0 }
}

function renderDirectory(nodeValue: DirectoryNode, indent: string, depth: number, maxDepth: number, lines: string[]) {
  for (const [name, directory] of sortedDirectories(nodeValue)) {
    lines.push(`${indent}${escapeLabel(name)}/ (${renderRepositoryMapDirectoryCount(directory.fileCount)})`)
    if (depth < maxDepth) renderDirectory(directory, `${indent}  `, depth + 1, maxDepth, lines)
  }
  for (const file of [...nodeValue.files].sort((left, right) => left.localeCompare(right))) {
    lines.push(`${indent}${escapeLabel(file)}`)
  }
}

function sortedDirectories(nodeValue: DirectoryNode) {
  return [...nodeValue.directories.entries()].sort(([left], [right]) => left.localeCompare(right))
}

function escapeLabel(value: string) {
  return JSON.stringify(value).slice(1, -1)
}

function fitLines(lines: string[], maxBytes: number) {
  const selected: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const omitted = lines.length - index
    const marker = renderRepositoryMapOmittedLines(omitted)
    const candidate = [...selected, lines[index]!]
    const hasMore = index < lines.length - 1
    const rendered = [...candidate, ...(hasMore ? [marker] : [])].join('\n')
    if (Buffer.byteLength(rendered, 'utf8') > maxBytes) break
    selected.push(lines[index]!)
  }
  if (selected.length === lines.length) return selected.join('\n')
  let marker = renderRepositoryMapOmittedLines(lines.length - selected.length)
  while (selected.length && Buffer.byteLength([...selected, marker].join('\n'), 'utf8') > maxBytes) selected.pop()
  if (Buffer.byteLength(marker, 'utf8') > maxBytes) marker = marker.slice(0, maxBytes)
  return [...selected, marker].join('\n')
}

function positiveInteger(value: number, name: string) {
  return minimumInteger(value, 1, name)
}

function minimumInteger(value: number, minimum: number, name: string) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new AgentCoreError('INVALID_INPUT', `Repo map ${name} must be an integer of at least ${minimum}`)
  }
  return value
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}
