import { createHash } from 'node:crypto'
import { mkdir, lstat, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { AgentCoreError } from '@electron-manager/agent-core'

import { buildRepoMap, resolveRepoMapOptions } from './repo-map.js'
import {
  CODE_MAP_SCHEMA_VERSION,
  type CodeMapFileRecord,
  type CodeMapOptions,
  type CodeMapSnapshot,
  type ResolvedCodeMapOptions,
} from './types.js'

const SOURCE_EXTENSIONS = new Set(['.c', '.cc', '.cpp', '.cs', '.go', '.java', '.js', '.jsx', '.kt', '.mjs', '.php', '.py', '.rb', '.rs', '.swift', '.ts', '.tsx', '.vue'])
const CONFIG_NAMES = new Set(['package.json', 'tsconfig.json', 'vite.config.ts', 'vite.config.js', 'webpack.config.js', 'pyproject.toml', 'cargo.toml', 'go.mod'])

export class CodeMapService {
  private readonly directory: string
  private readonly pending = new Map<string, Promise<CodeMapSnapshot>>()

  constructor(managerDataRoot: string) {
    if (!managerDataRoot.trim()) throw new AgentCoreError('INVALID_INPUT', 'Code map data root is required')
    this.directory = path.join(path.resolve(managerDataRoot), 'agent', 'code-maps')
  }

  async ensure(projectRoot: string, options: CodeMapOptions = {}) {
    const resolvedRoot = path.resolve(projectRoot)
    const key = projectKey(resolvedRoot)
    const existing = await this.load(key)
    if (existing && sameOptions(existing.options, resolveCodeMapOptions(options))) return existing
    return this.enqueue(key, () => this.rebuild(resolvedRoot, options, existing))
  }

  async reconcile(projectRoot: string, options: CodeMapOptions = {}) {
    const resolvedRoot = path.resolve(projectRoot)
    const key = projectKey(resolvedRoot)
    return this.enqueue(key, async () => this.rebuild(resolvedRoot, options, await this.load(key)))
  }

  private enqueue(key: string, operation: () => Promise<CodeMapSnapshot>) {
    const previous = this.pending.get(key) || Promise.resolve(undefined)
    const next = previous.catch(() => undefined).then(operation)
    this.pending.set(key, next)
    void next.then(() => {
      if (this.pending.get(key) === next) this.pending.delete(key)
    }, () => {
      if (this.pending.get(key) === next) this.pending.delete(key)
    })
    return next
  }

  private async rebuild(projectRoot: string, options: CodeMapOptions, previous?: CodeMapSnapshot) {
    const resolved = resolveCodeMapOptions(options)
    const repoMap = await buildRepoMap(projectRoot, resolved)
    const previousByPath = new Map(previous?.files.map((file) => [file.path, file]) || [])
    const files: CodeMapFileRecord[] = []
    for (const relativePath of repoMap.paths) {
      const absolutePath = path.join(projectRoot, relativePath)
      const details = await lstat(absolutePath).catch(() => undefined)
      if (!details?.isFile() || details.isSymbolicLink()) continue
      const old = previousByPath.get(relativePath)
      if (old && old.bytes === details.size && old.modifiedAtMs === details.mtimeMs) {
        files.push(old)
        continue
      }
      files.push(await analyzeFile(absolutePath, relativePath, details.size, details.mtimeMs, resolved.maxSourceBytes))
    }
    const stable = { projectKey: projectKey(projectRoot), repoMapRevision: repoMap.revision, options: resolved, files }
    const revision = hash(JSON.stringify(stable))
    if (previous?.revision === revision) return previous
    const now = new Date().toISOString()
    const stats = summarize(files, repoMap.totalFiles)
    const snapshot: CodeMapSnapshot = {
      schemaVersion: CODE_MAP_SCHEMA_VERSION,
      revision,
      projectKey: stable.projectKey,
      generatedAt: previous?.generatedAt || now,
      updatedAt: now,
      repoMap,
      options: resolved,
      files,
      stats,
      content: renderContent(repoMap.content, files, stats),
    }
    await this.save(snapshot)
    return snapshot
  }

  private async load(key: string): Promise<CodeMapSnapshot | undefined> {
    const value = await readFile(this.filePath(key), 'utf8').then(JSON.parse).catch(() => undefined)
    if (!value || value.schemaVersion !== CODE_MAP_SCHEMA_VERSION || value.projectKey !== key || !Array.isArray(value.files)) return undefined
    return value as CodeMapSnapshot
  }

  private async save(snapshot: CodeMapSnapshot) {
    await mkdir(this.directory, { recursive: true })
    const target = this.filePath(snapshot.projectKey)
    const temporary = `${target}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    await rename(temporary, target)
  }

  private filePath(key: string) {
    return path.join(this.directory, `${key}.json`)
  }
}

export function resolveCodeMapOptions(options: CodeMapOptions = {}): ResolvedCodeMapOptions {
  const repo = resolveRepoMapOptions(options)
  const maxSourceBytes = options.maxSourceBytes ?? 256 * 1024
  if (!Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 1024) {
    throw new AgentCoreError('INVALID_INPUT', 'Code map maxSourceBytes must be an integer of at least 1024')
  }
  return { ...repo, maxSourceBytes }
}

function sameOptions(left: ResolvedCodeMapOptions, right: ResolvedCodeMapOptions) {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function analyzeFile(absolutePath: string, relativePath: string, bytes: number, modifiedAtMs: number, maxBytes: number): Promise<CodeMapFileRecord> {
  const language = languageFor(relativePath)
  const kind = kindFor(relativePath, language)
  const analyzable = language !== 'other' && bytes <= maxBytes
  const content = analyzable ? await readFile(absolutePath, 'utf8').catch(() => '') : ''
  return {
    path: relativePath,
    kind,
    language,
    bytes,
    modifiedAtMs,
    ...(content ? { contentHash: hash(content) } : {}),
    imports: content ? extractImports(content) : [],
    exports: content ? extractExports(content) : [],
  }
}

function languageFor(filePath: string) {
  const name = path.posix.basename(filePath).toLowerCase()
  if (CONFIG_NAMES.has(name)) return name.endsWith('.json') ? 'json' : 'config'
  const extension = path.posix.extname(name)
  return ({ '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.ts': 'typescript', '.tsx': 'typescript', '.vue': 'vue', '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java', '.kt': 'kotlin', '.swift': 'swift', '.rb': 'ruby', '.php': 'php', '.c': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cs': 'csharp', '.json': 'json', '.toml': 'toml', '.yaml': 'yaml', '.yml': 'yaml' } as Record<string, string>)[extension] || 'other'
}

function kindFor(filePath: string, language: string): CodeMapFileRecord['kind'] {
  const lower = filePath.toLowerCase()
  if (/(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\.[^.]+$/.test(lower)) return 'test'
  if (CONFIG_NAMES.has(path.posix.basename(lower)) || /(^|\/)(config|configs)\//.test(lower)) return 'config'
  if (SOURCE_EXTENSIONS.has(path.posix.extname(lower)) || !['other', 'json', 'yaml', 'toml'].includes(language)) return 'source'
  return 'other'
}

function extractImports(content: string) {
  const values = new Set<string>()
  const patterns = [/\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g, /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g, /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g]
  for (const pattern of patterns) for (const match of content.matchAll(pattern)) if (match[1]) values.add(match[1])
  return [...values].sort().slice(0, 80)
}

function extractExports(content: string) {
  const values = new Set<string>()
  for (const match of content.matchAll(/\bexport\s+(?:default\s+)?(?:async\s+)?(?:class|function|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) if (match[1]) values.add(match[1])
  for (const match of content.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
    for (const item of (match[1] || '').split(',')) {
      const name = item.trim().split(/\s+as\s+/)[1] || item.trim().split(/\s+as\s+/)[0]
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) values.add(name)
    }
  }
  return [...values].sort().slice(0, 120)
}

function summarize(files: CodeMapFileRecord[], totalFiles: number): CodeMapSnapshot['stats'] {
  const languages: Record<string, number> = {}
  for (const file of files) languages[file.language] = (languages[file.language] || 0) + 1
  return {
    totalFiles,
    analyzedFiles: files.filter((file) => !!file.contentHash).length,
    sourceFiles: files.filter((file) => file.kind === 'source').length,
    testFiles: files.filter((file) => file.kind === 'test').length,
    configFiles: files.filter((file) => file.kind === 'config').length,
    dependencyEdges: files.reduce((sum, file) => sum + file.imports.length, 0),
    exportedSymbols: files.reduce((sum, file) => sum + file.exports.length, 0),
    languages,
  }
}

function renderContent(repoMapContent: string, files: CodeMapFileRecord[], stats: CodeMapSnapshot['stats']) {
  const modules = files.filter((file) => file.imports.length || file.exports.length).slice(0, 240).map((file) => {
    const imports = file.imports.length ? ` imports=${file.imports.slice(0, 12).join(',')}` : ''
    const exports = file.exports.length ? ` exports=${file.exports.slice(0, 16).join(',')}` : ''
    return `- ${file.path}${imports}${exports}`
  })
  return [`# 持久化代码地图`, `文件 ${stats.totalFiles} · 已分析 ${stats.analyzedFiles} · 依赖 ${stats.dependencyEdges} · 导出 ${stats.exportedSymbols}`, '', repoMapContent, '', '## 模块关系', ...(modules.length ? modules : ['- 暂无可分析的模块关系'])].join('\n')
}

function projectKey(projectRoot: string) {
  return hash(path.resolve(projectRoot)).slice(0, 24)
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}
