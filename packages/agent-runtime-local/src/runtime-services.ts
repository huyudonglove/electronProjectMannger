import path from 'node:path'
import { readFile } from 'node:fs/promises'

import type { ToolRequest, ToolResult } from '@electron-manager/agent-core'

import { assertActionDigest } from './action-digest.js'
import { parseRestrictedCommand, type RestrictedCommand } from './command-policy.js'
import {
  resolveExistingWritablePath,
  resolveNewWritablePath,
  resolveProjectDirectory,
  resolveProjectPath,
  resolveProjectPathCandidate,
} from './path-guard.js'
import { runProcess, type ProcessRunResult } from './process-runner.js'
import { hashFileContent, readFileLines } from './read-file.js'
import {
  applyProjectPatch,
  createProjectFile,
  parsePatchOperations,
  preparePatch,
  type PatchReplaceOperation,
} from './write-tools.js'
import { contentHash } from './file-transaction.js'
import type { BackendAvailability } from './tool-registry.js'

export interface LocalRuntimeServiceOptions {
  maxOutputChars: number
  timeoutMs: number
  maxWriteChars: number
  allowedPackageScripts?: string[]
  clock: () => string
}

export class LocalRuntimeServices {
  readonly projectRoot: string
  readonly maxOutputChars: number
  readonly timeoutMs: number
  readonly maxWriteChars: number
  readonly allowedPackageScripts?: string[]
  readonly #clock: () => string
  readonly #cliProbes = new Map<string, Promise<BackendAvailability>>()

  constructor(projectRoot: string, options: LocalRuntimeServiceOptions) {
    this.projectRoot = path.resolve(projectRoot)
    this.maxOutputChars = options.maxOutputChars
    this.timeoutMs = options.timeoutMs
    this.maxWriteChars = options.maxWriteChars
    this.allowedPackageScripts = options.allowedPackageScripts
    this.#clock = options.clock
  }

  now() {
    return this.#clock()
  }

  resolvePath(requestedPath = '.') {
    return resolveProjectPath(this.projectRoot, requestedPath)
  }

  resolvePathCandidate(requestedPath: string) {
    return resolveProjectPathCandidate(this.projectRoot, requestedPath)
  }

  resolveDirectory(requestedPath = '.') {
    return resolveProjectDirectory(this.projectRoot, requestedPath)
  }

  run(command: string, args: string[], options: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; signal?: AbortSignal } = {}) {
    return runProcess(command, args, {
      cwd: options.cwd || this.projectRoot,
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
      maxOutputChars: this.maxOutputChars,
      ...(options.env ? { env: options.env } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    })
  }

  readLines(absolutePath: string, options: { startLine: number; endLine: number }) {
    return readFileLines(absolutePath, { ...options, maxOutputChars: this.maxOutputChars })
  }

  hashFile(absolutePath: string) {
    return hashFileContent(absolutePath)
  }

  assertDigest(request: ToolRequest) {
    assertActionDigest(request)
  }

  createFile(requestedPath: string, content: string) {
    return createProjectFile(this.projectRoot, requestedPath, content, this.maxWriteChars)
  }

  prepareCreatePath(requestedPath: string) {
    return resolveNewWritablePath(this.projectRoot, requestedPath)
  }

  parsePatch(value: Parameters<typeof parsePatchOperations>[0]) {
    return parsePatchOperations(value)
  }

  applyPatch(operations: PatchReplaceOperation[]) {
    return applyProjectPatch(this.projectRoot, operations, this.maxWriteChars)
  }

  preparePatch(operations: PatchReplaceOperation[]) {
    return preparePatch(this.projectRoot, operations, this.maxWriteChars)
  }

  hashContent(content: string) {
    return contentHash(content)
  }

  async inspectWritableFile(requestedPath: string) {
    const candidate = await resolveProjectPathCandidate(this.projectRoot, requestedPath)
    if (!candidate.exists) return { state: 'missing' as const, path: candidate.relativePath }
    const resolved = await resolveExistingWritablePath(this.projectRoot, requestedPath)
    const content = await readFile(resolved.absolutePath, 'utf8')
    return { state: 'present' as const, path: resolved.relativePath, hash: contentHash(content) }
  }

  parseCommand(input: Parameters<typeof parseRestrictedCommand>[0]): RestrictedCommand {
    return parseRestrictedCommand(input, {
      defaultTimeoutMs: this.timeoutMs,
      maxTimeoutMs: this.timeoutMs,
      allowedPackageScripts: this.allowedPackageScripts,
    })
  }

  async probeCli(backendId: string, command: string, args = ['--version']): Promise<BackendAvailability> {
    const key = JSON.stringify([backendId, command, args])
    const existing = this.#cliProbes.get(key)
    if (existing) return structuredClone(await existing)
    const probe = this.#probeCli(backendId, command, args)
    this.#cliProbes.set(key, probe)
    return structuredClone(await probe)
  }

  async #probeCli(backendId: string, command: string, args: string[]): Promise<BackendAvailability> {
    try {
      const result = await runProcess(command, args, {
        cwd: this.projectRoot,
        timeoutMs: Math.min(this.timeoutMs, 3_000),
        maxOutputChars: 2_000,
        env: commandEnvironment(),
      })
      if (result.exitCode !== 0) {
        return { backendId, available: false, reason: result.stderr || result.output || `Exited with ${result.exitCode}` }
      }
      return { backendId, available: true, version: result.output.split('\n')[0]?.trim() || 'unknown' }
    } catch (error) {
      return { backendId, available: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }
}

export function processToolResult(
  request: ToolRequest,
  startedAt: string,
  completedAt: string,
  processResult: ProcessRunResult,
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
      error: { code: 'TOOL_TIMEOUT' as const, message: `${request.name} timed out`, retryable: true },
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

export function nativeAvailability(toolName: string, backendId: string, checkedAt: string) {
  return {
    toolName,
    checkedAt,
    available: true,
    selectedBackend: backendId,
    backends: [{ backendId, available: true, version: process.version }],
  }
}

export function cliAvailability(toolName: string, checkedAt: string, backends: BackendAvailability[]) {
  const selected = backends.find((backend) => backend.available)
  return {
    toolName,
    checkedAt,
    available: Boolean(selected),
    ...(selected ? { selectedBackend: selected.backendId } : {}),
    backends,
  }
}

export function commandEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  const allowedKeys = new Set([
    'PATH',
    'HOME',
    'TMPDIR',
    'TMP',
    'TEMP',
    'LANG',
    'LANGUAGE',
    'TERM',
    'COLORTERM',
    'USER',
    'USERNAME',
    'LOGNAME',
    'SHELL',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
    'APPDATA',
    'LOCALAPPDATA',
  ])
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && (allowedKeys.has(key.toUpperCase()) || key.startsWith('LC_'))) {
      environment[key] = value
    }
  }
  return {
    ...environment,
    CI: '1',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    npm_config_update_notifier: 'false',
  }
}
