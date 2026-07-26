import path from 'node:path'

import {
  AgentCoreError,
  toAgentError,
  type AgentRuntime,
  type JsonValue,
  type RuntimeContext,
  type ToolRequest,
  type ToolResult,
} from '@electron-manager/agent-core'

import { resolveProjectPath, resolveProjectPathCandidate } from './path-guard.js'
import { runProcess } from './process-runner.js'
import { readFileLines } from './read-file.js'
import { assertActionDigest } from './action-digest.js'
import { applyProjectPatch, createProjectFile, parsePatchOperations } from './write-tools.js'

export interface LocalRuntimeOptions {
  maxOutputChars?: number
  timeoutMs?: number
  maxWriteChars?: number
  clock?: () => string
}

type ToolHandler = (request: ToolRequest, context: RuntimeContext) => Promise<ToolResult>

export class LocalAgentRuntime implements AgentRuntime {
  readonly projectRoot: string
  readonly maxOutputChars: number
  readonly timeoutMs: number
  readonly maxWriteChars: number
  readonly #clock: () => string
  readonly #handlers: Map<string, ToolHandler>

  constructor(projectRoot: string, options: LocalRuntimeOptions = {}) {
    this.projectRoot = path.resolve(projectRoot)
    this.maxOutputChars = options.maxOutputChars ?? 20_000
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.maxWriteChars = options.maxWriteChars ?? 1_000_000
    this.#clock = options.clock || (() => new Date().toISOString())
    this.#handlers = new Map([
      ['list_files', this.#listFiles.bind(this)],
      ['search_text', this.#searchText.bind(this)],
      ['read_file', this.#readFile.bind(this)],
      ['git_status', this.#gitStatus.bind(this)],
      ['git_diff', this.#gitDiff.bind(this)],
      ['create_file', this.#createFile.bind(this)],
      ['apply_patch', this.#applyPatch.bind(this)],
    ])
  }

  async execute(request: ToolRequest, context: RuntimeContext, signal?: AbortSignal): Promise<ToolResult> {
    const startedAt = this.#clock()
    try {
      if (signal?.aborted) throw new AgentCoreError('CANCELLED', 'Tool request was cancelled')
      await this.#assertContext(context)
      if (context.permission.effect === 'deny') throw new AgentCoreError('PERMISSION_DENIED', context.permission.reason)
      if (context.permission.effect === 'ask') throw new AgentCoreError('APPROVAL_REQUIRED', context.permission.reason)
      const handler = this.#handlers.get(request.name)
      if (!handler) throw new AgentCoreError('TOOL_NOT_FOUND', `Unknown local tool: ${request.name}`)
      return await handler(request, context)
    } catch (error) {
      return {
        requestId: request.id,
        ok: false,
        summary: error instanceof Error ? error.message : String(error),
        startedAt,
        completedAt: this.#clock(),
        error: toAgentError(error, 'TOOL_EXECUTION_FAILED'),
      }
    }
  }

  async #assertContext(context: RuntimeContext) {
    const configured = await resolveProjectPath(this.projectRoot)
    const requested = await resolveProjectPath(context.projectRoot)
    if (configured.projectRoot !== requested.projectRoot) {
      throw new AgentCoreError('PATH_OUTSIDE_PROJECT', 'Runtime context project root does not match configured project root')
    }
  }

  async #listFiles(request: ToolRequest, context: RuntimeContext): Promise<ToolResult> {
    const startedAt = this.#clock()
    const requestedPath = optionalString(request.input.path, '.')
    const resolved = await resolveProjectPath(context.projectRoot, requestedPath)
    const args = ['--files']
    if (request.input.includeHidden === true) args.push('--hidden', '--glob', '!.git')
    if (resolved.relativePath !== '.') args.push(resolved.relativePath)
    const result = await runProcess('rg', args, { cwd: resolved.projectRoot, timeoutMs: this.timeoutMs, maxOutputChars: this.maxOutputChars })
    return processToolResult(request, startedAt, this.#clock(), result, 'Listed project files')
  }

  async #searchText(request: ToolRequest, context: RuntimeContext): Promise<ToolResult> {
    const startedAt = this.#clock()
    const query = requiredString(request.input.query, 'query')
    const requestedPath = optionalString(request.input.path, '.')
    const resolved = await resolveProjectPath(context.projectRoot, requestedPath)
    const args = ['--line-number', '--column', '--no-heading', '--color', 'never']
    for (const glob of optionalStringArray(request.input.globs, 'globs')) args.push('--glob', glob)
    args.push('--', query, resolved.relativePath)
    const result = await runProcess('rg', args, { cwd: resolved.projectRoot, timeoutMs: this.timeoutMs, maxOutputChars: this.maxOutputChars })
    const noMatches = result.exitCode === 1
    if (noMatches) result.exitCode = 0
    return processToolResult(request, startedAt, this.#clock(), result, noMatches ? 'No matches found' : 'Search completed')
  }

  async #readFile(request: ToolRequest, context: RuntimeContext): Promise<ToolResult> {
    const startedAt = this.#clock()
    const requestedPath = requiredString(request.input.path, 'path')
    const resolved = await resolveProjectPath(context.projectRoot, requestedPath)
    const read = await readFileLines(resolved.absolutePath, {
      startLine: optionalNumber(request.input.startLine, 1),
      endLine: optionalNumber(request.input.endLine, 400),
      maxOutputChars: this.maxOutputChars,
    })
    return {
      requestId: request.id,
      ok: true,
      summary: `Read ${resolved.relativePath} lines ${read.startLine}-${read.endLine}`,
      output: read.output,
      truncated: read.truncated,
      startedAt,
      completedAt: this.#clock(),
      metadata: { path: resolved.relativePath, startLine: read.startLine, endLine: read.endLine },
    }
  }

  async #gitStatus(request: ToolRequest, context: RuntimeContext): Promise<ToolResult> {
    const startedAt = this.#clock()
    const resolved = await resolveProjectPath(context.projectRoot)
    const result = await runProcess('git', ['status', '--short', '--branch'], {
      cwd: resolved.projectRoot,
      timeoutMs: this.timeoutMs,
      maxOutputChars: this.maxOutputChars,
    })
    return processToolResult(request, startedAt, this.#clock(), result, 'Read Git status')
  }

  async #gitDiff(request: ToolRequest, context: RuntimeContext): Promise<ToolResult> {
    const startedAt = this.#clock()
    const resolved = await resolveProjectPath(context.projectRoot)
    const relativePaths: string[] = []
    for (const requestedPath of optionalStringArray(request.input.paths, 'paths')) {
      relativePaths.push((await resolveProjectPathCandidate(resolved.projectRoot, requestedPath)).relativePath)
    }
    const args = ['diff', '--no-ext-diff', '--unified=3']
    if (relativePaths.length) args.push('--', ...relativePaths)
    const result = await runProcess('git', args, {
      cwd: resolved.projectRoot,
      timeoutMs: this.timeoutMs,
      maxOutputChars: this.maxOutputChars,
    })
    return processToolResult(request, startedAt, this.#clock(), result, 'Read Git diff')
  }

  async #createFile(request: ToolRequest, context: RuntimeContext): Promise<ToolResult> {
    const startedAt = this.#clock()
    assertActionDigest(request)
    const requestedPath = requiredString(request.input.path, 'path')
    const content = stringValue(request.input.content, 'content')
    const created = await createProjectFile(context.projectRoot, requestedPath, content, this.maxWriteChars)
    return {
      requestId: request.id,
      ok: true,
      summary: `Created ${created.path}`,
      changedPaths: [created.path],
      startedAt,
      completedAt: this.#clock(),
      metadata: { path: created.path, operation: 'create', afterHash: created.afterHash },
    }
  }

  async #applyPatch(request: ToolRequest, context: RuntimeContext): Promise<ToolResult> {
    const startedAt = this.#clock()
    assertActionDigest(request)
    const operations = parsePatchOperations(request.input.operations)
    const changes = await applyProjectPatch(context.projectRoot, operations, this.maxWriteChars)
    return {
      requestId: request.id,
      ok: true,
      summary: `Patched ${changes.length} file(s)`,
      changedPaths: changes.map((change) => change.path),
      startedAt,
      completedAt: this.#clock(),
      metadata: {
        files: changes.map((change) => ({ path: change.path, beforeHash: change.beforeHash, afterHash: change.afterHash })),
      },
    }
  }
}

export { LocalAgentRuntime as LocalReadRuntime }

function processToolResult(
  request: ToolRequest,
  startedAt: string,
  completedAt: string,
  processResult: Awaited<ReturnType<typeof runProcess>>,
  summary: string,
): ToolResult {
  if (processResult.timedOut) {
    return {
      requestId: request.id,
      ok: false,
      summary: `${summary} timed out`,
      output: processResult.output,
      truncated: processResult.truncated,
      exitCode: processResult.exitCode ?? undefined,
      startedAt,
      completedAt,
      error: { code: 'TOOL_TIMEOUT', message: `${request.name} timed out`, retryable: true },
    }
  }
  const ok = processResult.exitCode === 0
  return {
    requestId: request.id,
    ok,
    summary: ok ? summary : `${summary} failed with exit code ${processResult.exitCode}`,
    output: processResult.output,
    truncated: processResult.truncated,
    exitCode: processResult.exitCode ?? undefined,
    startedAt,
    completedAt,
    ...(!ok ? { error: { code: 'TOOL_EXECUTION_FAILED' as const, message: processResult.stderr || processResult.output || summary, retryable: true } } : {}),
  }
}

function requiredString(value: JsonValue | undefined, name: string) {
  if (typeof value !== 'string' || !value.trim()) throw new AgentCoreError('INVALID_INPUT', `${name} must be a non-empty string`)
  return value
}

function optionalString(value: JsonValue | undefined, fallback: string) {
  if (value === undefined) return fallback
  if (typeof value !== 'string') throw new AgentCoreError('INVALID_INPUT', 'Expected a string input')
  return value
}

function stringValue(value: JsonValue | undefined, name: string) {
  if (typeof value !== 'string') throw new AgentCoreError('INVALID_INPUT', `${name} must be a string`)
  return value
}

function optionalNumber(value: JsonValue | undefined, fallback: number) {
  if (value === undefined) return fallback
  if (typeof value !== 'number') throw new AgentCoreError('INVALID_INPUT', 'Expected a numeric input')
  return value
}

function optionalStringArray(value: JsonValue | undefined, name: string) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new AgentCoreError('INVALID_INPUT', `${name} must be an array of strings`)
  }
  return value as string[]
}
