import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export interface ModelDiagnosticView {
  at: string
  level: 'info' | 'error'
  event: string
  providerId: string
  model: string
  runId: string
  turnId: string
  projectKey?: string
  durationMs?: number
  status?: number
  messageCount?: number
  toolCount?: number
  finishReason?: string
  toolCallNames?: string[]
  actionShape?: string
  error?: string
  routeId?: string
  profileId?: string
  attempt?: number
  order?: number
  result?: 'succeeded' | 'failed' | 'cancelled'
  errorCategory?: string
}

export class ModelDiagnosticLog {
  readonly filePath: string
  #queue: Promise<void> = Promise.resolve()

  constructor(managerDataRoot: string) {
    this.filePath = path.join(path.resolve(managerDataRoot), 'agent', 'model-diagnostics.jsonl')
  }

  async append(input: ModelDiagnosticView) {
    const entry = sanitizeEntry(input)
    const operation = this.#queue.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true })
      await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 })
    })
    this.#queue = operation.catch((error) => {
      console.warn('Unable to append model diagnostic log.', error instanceof Error ? error.message : String(error))
    })
    await operation
  }

  async recent(limit = 80, projectKey = ''): Promise<ModelDiagnosticView[]> {
    await this.#queue
    let content = ''
    try {
      content = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw error
    }
    const normalizedProjectKey = normalizedDiagnosticProjectKey(projectKey)
    return content
      .split('\n')
      .filter(Boolean)
      .slice(-1_000)
      .flatMap((line) => {
        try {
          return [sanitizeEntry(JSON.parse(line) as ModelDiagnosticView)]
        } catch {
          return []
        }
      })
      .filter((entry) => !normalizedProjectKey || entry.projectKey === normalizedProjectKey)
      .slice(-Math.max(1, Math.min(200, Math.trunc(limit))))
      .reverse()
  }
}

function sanitizeEntry(input: ModelDiagnosticView): ModelDiagnosticView {
  return {
    at: bounded(input.at, 64),
    level: input.level === 'error' ? 'error' : 'info',
    event: bounded(input.event, 80),
    providerId: bounded(input.providerId, 80),
    model: bounded(input.model, 160),
    runId: bounded(input.runId, 160),
    turnId: bounded(input.turnId, 200),
    ...(normalizedDiagnosticProjectKey(input.projectKey) ? { projectKey: normalizedDiagnosticProjectKey(input.projectKey) } : {}),
    ...(finite(input.durationMs) ? { durationMs: input.durationMs } : {}),
    ...(finite(input.status) ? { status: input.status } : {}),
    ...(finite(input.messageCount) ? { messageCount: input.messageCount } : {}),
    ...(finite(input.toolCount) ? { toolCount: input.toolCount } : {}),
    ...(input.finishReason ? { finishReason: bounded(input.finishReason, 80) } : {}),
    ...(input.actionShape ? { actionShape: bounded(input.actionShape, 160) } : {}),
    ...(input.error ? { error: redactDiagnosticError(input.error) } : {}),
    ...(input.routeId ? { routeId: bounded(input.routeId, 160) } : {}),
    ...(input.profileId ? { profileId: bounded(input.profileId, 200) } : {}),
    ...(finite(input.attempt) ? { attempt: Math.trunc(input.attempt) } : {}),
    ...(finite(input.order) ? { order: Math.trunc(input.order) } : {}),
    ...(['succeeded', 'failed', 'cancelled'].includes(String(input.result || '')) ? { result: input.result } : {}),
    ...(input.errorCategory ? { errorCategory: bounded(input.errorCategory, 80) } : {}),
    ...(input.toolCallNames?.length ? { toolCallNames: input.toolCallNames.slice(0, 16).map((name) => bounded(name, 120)) } : {}),
  }
}

export function modelDiagnosticProjectKey(projectRoot: string) {
  const root = String(projectRoot || '').trim()
  return root ? createHash('sha256').update(root).digest('hex').slice(0, 24) : ''
}

function normalizedDiagnosticProjectKey(value: unknown) {
  const key = String(value || '').trim().toLocaleLowerCase()
  return /^[a-f0-9]{24}$/.test(key) ? key : ''
}

function bounded(value: unknown, length: number) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').slice(0, length)
}

function redactDiagnosticError(value: unknown) {
  return bounded(value, 1_000)
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, '[已隐藏连接地址]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g, '[已隐藏密钥]')
    .replace(/\b(api[_ -]?key|authorization|bearer)\s*[:=]\s*\S+/gi, '$1=[已隐藏密钥]')
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
