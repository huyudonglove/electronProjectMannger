import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { RECORD_COUNTERS_PATH } from '../paths.js'

const fileMutationQueues = new Map<string, Promise<void>>()

export async function readProjectFile(dataRoot: string, relativePath: string) {
  return readFile(path.join(dataRoot, relativePath), 'utf8')
}

export async function readExistingProjectFile(dataRoot: string, relativePath: string) {
  try {
    return await readFile(path.join(dataRoot, relativePath), 'utf8')
  } catch {
    return ''
  }
}

export async function readExistingRootFile(root: string, relativePath: string) {
  try {
    return await readFile(path.join(root, relativePath), 'utf8')
  } catch {
    return ''
  }
}

export async function writeProjectFile(dataRoot: string, relativePath: string, content: string) {
  await atomicWriteFile(path.join(dataRoot, relativePath), content)
}

export async function ensureProjectDirectory(dataRoot: string, relativePath: string) {
  await mkdir(path.join(dataRoot, relativePath), { recursive: true })
}

export async function ensureProjectFile(dataRoot: string, relativePath: string, content: string) {
  try {
    await readFile(path.join(dataRoot, relativePath), 'utf8')
  } catch {
    await writeProjectFile(dataRoot, relativePath, content)
  }
}

export async function atomicWriteFile(absolutePath: string, content: string) {
  await mkdir(path.dirname(absolutePath), { recursive: true })
  const temporaryPath = path.join(
    path.dirname(absolutePath),
    `.${path.basename(absolutePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  )
  try {
    await writeFile(temporaryPath, content, 'utf8')
    await rename(temporaryPath, absolutePath)
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
}

export async function mutateProjectFile<T>(
  dataRoot: string,
  relativePath: string,
  update: (content: string) => Promise<{ content: string; value: T }> | { content: string; value: T },
): Promise<T> {
  const absolutePath = path.resolve(dataRoot, relativePath)
  return withFileMutation(absolutePath, async () => {
    const existing = await readExistingProjectFile(dataRoot, relativePath)
    const result = await update(existing)
    if (result.content !== existing) await writeProjectFile(dataRoot, relativePath, result.content)
    return result.value
  })
}

export async function withFileMutation<T>(absolutePath: string, action: () => Promise<T>): Promise<T> {
  const previous = fileMutationQueues.get(absolutePath) || Promise.resolve()
  let resolveCurrent!: () => void
  const current = new Promise<void>((resolve) => {
    resolveCurrent = resolve
  })
  const queued = previous.catch(() => undefined).then(() => current)
  fileMutationQueues.set(absolutePath, queued)

  await previous.catch(() => undefined)
  try {
    return await action()
  } finally {
    resolveCurrent()
    if (fileMutationQueues.get(absolutePath) === queued) fileMutationQueues.delete(absolutePath)
  }
}

export async function allocateShortId(dataRoot: string, prefix: string, observedValues: string[]) {
  return mutateProjectFile(dataRoot, RECORD_COUNTERS_PATH, (content) => {
    let counters: Record<string, number> = {}
    if (content.trim()) {
      try {
        counters = (JSON.parse(content) as { counters?: Record<string, number> }).counters || {}
      } catch {
        throw new Error('记录 ID 计数器已损坏，请先恢复 record-counters.json')
      }
    }
    const observedMaximum = Math.max(
      0,
      ...observedValues.map((value) => Number(String(value).match(/\d+$/)?.[0] || 0)),
    )
    const next = Math.max(Number(counters[prefix] || 0), observedMaximum) + 1
    const nextCounters = { ...counters, [prefix]: next }
    return {
      content: `${JSON.stringify({ schemaVersion: 1, counters: nextCounters }, null, 2)}\n`,
      value: `${prefix}${String(next).padStart(3, '0')}`,
    }
  })
}

export async function ensureRecordCounters(dataRoot: string, observed: Record<string, string[]>) {
  await mutateProjectFile(dataRoot, RECORD_COUNTERS_PATH, (content) => {
    let counters: Record<string, number> = {}
    if (content.trim()) {
      try {
        counters = (JSON.parse(content) as { counters?: Record<string, number> }).counters || {}
      } catch {
        throw new Error('记录 ID 计数器已损坏，请先恢复 record-counters.json')
      }
    }
    for (const [prefix, values] of Object.entries(observed)) {
      const maximum = Math.max(0, ...values.map((value) => Number(String(value).match(/\d+$/)?.[0] || 0)))
      counters[prefix] = Math.max(Number(counters[prefix] || 0), maximum)
    }
    return {
      content: `${JSON.stringify({ schemaVersion: 1, counters }, null, 2)}\n`,
      value: undefined,
    }
  })
}

export async function listMarkdownFiles(dataRoot: string, base = ''): Promise<string[]> {
  const absoluteBase = path.join(dataRoot, base)
  let entries
  try {
    entries = await readdir(absoluteBase, { withFileTypes: true })
  } catch {
    return []
  }

  const files = await Promise.all(entries
    .filter((entry) => !['.git', 'node_modules', 'dist', 'release'].includes(entry.name))
    .map(async (entry) => {
      const relativePath = path.join(base, entry.name)
      if (entry.isDirectory()) return listMarkdownFiles(dataRoot, relativePath)
      return entry.isFile() && entry.name.endsWith('.md') ? [relativePath] : []
    }))
  return files.flat()
}

export async function removeProjectMarkdownFile(root: string, relativePath: string, baseDir: string) {
  await rm(path.join(root, safeMarkdownPath(relativePath, baseDir)), { force: true })
}

export function safeMarkdownPath(relativePath: string, baseDir: string) {
  const normalized = path.normalize(String(relativePath || '').trim()).replace(/\\/g, '/')
  if (
    !normalized
    || path.isAbsolute(normalized)
    || normalized.split('/').includes('..')
    || !normalized.startsWith(`${baseDir}/`)
    || !normalized.endsWith('.md')
  ) throw new Error('文件路径不合法')
  return normalized
}
