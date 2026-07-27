import { spawn } from 'node:child_process'

import { AgentCoreError } from '@electron-manager/agent-core'
import { limitText } from './output.js'

export interface ProcessRunOptions {
  cwd: string
  timeoutMs: number
  maxOutputChars: number
  env?: NodeJS.ProcessEnv
  signal?: AbortSignal
}

export interface ProcessRunResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  output: string
  truncated: boolean
  timedOut: boolean
  stdoutChars: number
  stderrChars: number
}

export function runProcess(command: string, args: string[], options: ProcessRunOptions): Promise<ProcessRunResult> {
  if (options.signal?.aborted) return Promise.reject(cancelledError(options.signal))

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let stdoutChars = 0
    let stderrChars = 0
    let timedOut = false
    let timeoutTimer: NodeJS.Timeout | undefined
    let forceKillTimer: NodeJS.Timeout | undefined
    let terminationReason: 'timeout' | 'abort' | undefined
    const collectionLimit = Math.max(options.maxOutputChars * 2, options.maxOutputChars + 1)

    const terminate = (reason: 'timeout' | 'abort') => {
      if (terminationReason) return
      terminationReason = reason
      timedOut = reason === 'timeout'
      forceKillTimer = terminateProcessTree(child.pid)
    }
    const abort = () => terminate('abort')
    const cleanup = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer)
      options.signal?.removeEventListener('abort', abort)
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdoutChars += chunk.length
      if (stdout.length < collectionLimit) stdout += chunk.slice(0, collectionLimit - stdout.length)
    })
    child.stderr.on('data', (chunk: string) => {
      stderrChars += chunk.length
      if (stderr.length < collectionLimit) stderr += chunk.slice(0, collectionLimit - stderr.length)
    })

    child.once('error', (error) => {
      cleanup()
      if (terminationReason === 'abort') {
        reject(cancelledError(options.signal))
        return
      }
      reject(new AgentCoreError('TOOL_EXECUTION_FAILED', `Failed to start ${command}`, { retryable: true, cause: error }))
    })
    child.once('close', (exitCode, signal) => {
      cleanup()
      if (terminationReason === 'abort') {
        reject(cancelledError(options.signal))
        return
      }
      const combined = [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join('\n')
      const limited = limitText(combined, options.maxOutputChars)
      resolve({
        exitCode,
        signal,
        stdout: limitText(stdout, options.maxOutputChars).text,
        stderr: limitText(stderr, options.maxOutputChars).text,
        output: limited.text,
        truncated: limited.truncated || stdout.length >= collectionLimit || stderr.length >= collectionLimit,
        timedOut,
        stdoutChars,
        stderrChars,
      })
    })

    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    if (!terminationReason) {
      timeoutTimer = setTimeout(() => terminate('timeout'), options.timeoutMs)
      timeoutTimer.unref()
    }
  })
}

function cancelledError(signal: AbortSignal | undefined) {
  return new AgentCoreError('CANCELLED', 'Process execution was cancelled', { cause: signal?.reason })
}

function terminateProcessTree(pid: number | undefined) {
  if (!pid) return undefined
  try {
    if (process.platform === 'win32') process.kill(pid, 'SIGTERM')
    else process.kill(-pid, 'SIGTERM')
  } catch {
    return undefined
  }
  const forceTimer = setTimeout(() => {
    try {
      if (process.platform === 'win32') process.kill(pid, 'SIGKILL')
      else process.kill(-pid, 'SIGKILL')
    } catch {
      // The process already exited.
    }
  }, 500)
  forceTimer.unref()
  return forceTimer
}
