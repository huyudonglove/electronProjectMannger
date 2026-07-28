import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { modelDiagnosticProjectKey } from './model-diagnostics.js'

export type AppDiagnosticCategory = 'startup' | 'ipc' | 'watcher' | 'code_map' | 'run' | 'system'

export interface AppDiagnosticView {
  at: string
  level: 'info' | 'warning' | 'error'
  category: AppDiagnosticCategory
  event: string
  message: string
  projectKey?: string
  runId?: string
  taskId?: string
  context?: Record<string, string | number | boolean>
}

export interface AppDiagnosticInput extends Omit<AppDiagnosticView, 'at' | 'message' | 'projectKey'> {
  at?: string
  message?: unknown
  projectRoot?: string
  error?: unknown
}

export class AppDiagnosticLog {
  readonly filePath: string
  #queue: Promise<void> = Promise.resolve()

  constructor(managerDataRoot: string) {
    this.filePath = path.join(path.resolve(managerDataRoot), 'agent', 'app-diagnostics.jsonl')
  }

  async append(input: AppDiagnosticInput) {
    const entry = sanitizeAppDiagnostic(input)
    const operation = this.#queue.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true })
      await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 })
    })
    this.#queue = operation.catch((error) => {
      console.warn('Unable to append application diagnostic log.', error instanceof Error ? error.message : String(error))
    })
    await operation
  }

  async recent(limit = 100, projectRoot = ''): Promise<AppDiagnosticView[]> {
    await this.#queue
    let content = ''
    try {
      content = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw error
    }
    const projectKey = projectRoot ? modelDiagnosticProjectKey(projectRoot) : ''
    return content
      .split('\n')
      .filter(Boolean)
      .slice(-2_000)
      .flatMap((line) => {
        try {
          return [sanitizeStoredAppDiagnostic(JSON.parse(line))]
        } catch {
          return []
        }
      })
      .filter((entry) => !projectKey || !entry.projectKey || entry.projectKey === projectKey)
      .slice(-Math.max(1, Math.min(500, Math.trunc(limit))))
      .reverse()
  }
}

export function diagnosticErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message || error.name
  return String(error || 'Unknown error')
}

export function sanitizeDiagnosticValue(value: unknown, maxCharacters = 1_000) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/gi, '[已隐藏私钥]')
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, '[已隐藏连接地址]')
    .replace(/(?:\/Users\/[^/\s]+|\/home\/[^/\s]+)(?:\/[^\s"'<>]*)?/g, '[已隐藏本机路径]')
    .replace(/\b[A-Za-z]:\\Users\\[^\\\s]+(?:\\[^\s"'<>]*)?/g, '[已隐藏本机路径]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g, '[已隐藏密钥]')
    .replace(/\b(api[_ -]?key|authorization|bearer|password|secret|token)\s*[:=]\s*\S+/gi, '$1=[已隐藏敏感值]')
    .slice(0, maxCharacters)
}

function sanitizeAppDiagnostic(input: AppDiagnosticInput): AppDiagnosticView {
  const projectKey = input.projectRoot ? modelDiagnosticProjectKey(input.projectRoot) : ''
  return {
    at: bounded(input.at || new Date().toISOString(), 64),
    level: ['info', 'warning', 'error'].includes(input.level) ? input.level : 'error',
    category: validCategory(input.category),
    event: bounded(input.event, 120),
    message: sanitizeDiagnosticValue(input.message || diagnosticErrorMessage(input.error), 1_500),
    ...(projectKey ? { projectKey } : {}),
    ...(input.runId ? { runId: bounded(input.runId, 180) } : {}),
    ...(input.taskId ? { taskId: bounded(input.taskId, 180) } : {}),
    ...(input.context ? { context: sanitizeContext(input.context) } : {}),
  }
}

function sanitizeStoredAppDiagnostic(value: unknown): AppDiagnosticView {
  const input = isRecord(value) ? value : {}
  const context = isRecord(input.context) ? sanitizeContext(input.context) : undefined
  return {
    at: bounded(input.at, 64),
    level: input.level === 'info' || input.level === 'warning' ? input.level : 'error',
    category: validCategory(input.category),
    event: bounded(input.event, 120),
    message: sanitizeDiagnosticValue(input.message, 1_500),
    ...(/^[a-f0-9]{24}$/.test(String(input.projectKey || '')) ? { projectKey: String(input.projectKey) } : {}),
    ...(input.runId ? { runId: bounded(input.runId, 180) } : {}),
    ...(input.taskId ? { taskId: bounded(input.taskId, 180) } : {}),
    ...(context && Object.keys(context).length ? { context } : {}),
  }
}

function sanitizeContext(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).slice(0, 20).flatMap(([key, item]) => {
    if (!['string', 'number', 'boolean'].includes(typeof item)) return []
    return [[bounded(key, 80), typeof item === 'string' ? sanitizeDiagnosticValue(item, 500) : item]]
  })) as Record<string, string | number | boolean>
}

function validCategory(value: unknown): AppDiagnosticCategory {
  return ['startup', 'ipc', 'watcher', 'code_map', 'run', 'system'].includes(String(value))
    ? value as AppDiagnosticCategory
    : 'system'
}

function bounded(value: unknown, length: number) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').slice(0, length)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
