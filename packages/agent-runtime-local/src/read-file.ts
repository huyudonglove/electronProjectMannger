import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { createHash } from 'node:crypto'

import { AgentCoreError } from '@electron-manager/agent-core'
import { limitText } from './output.js'

export interface ReadFileOptions {
  startLine: number
  endLine: number
  maxOutputChars: number
}

export async function readFileLines(filePath: string, options: ReadFileOptions) {
  const startLine = positiveInteger(options.startLine, 'startLine')
  const endLine = positiveInteger(options.endLine, 'endLine')
  if (endLine < startLine) throw new AgentCoreError('INVALID_INPUT', 'endLine must be greater than or equal to startLine')
  if (endLine - startLine > 5_000) throw new AgentCoreError('INVALID_INPUT', 'A single read cannot exceed 5001 lines')

  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  let lineNumber = 0
  let output = ''
  let binary = false

  try {
    for await (const line of lines) {
      lineNumber += 1
      if (line.includes('\0')) {
        binary = true
        break
      }
      if (lineNumber < startLine) continue
      if (lineNumber > endLine) break
      output += `${lineNumber}: ${line}\n`
    }
  } catch (error) {
    throw new AgentCoreError('TOOL_EXECUTION_FAILED', `Failed to read file: ${filePath}`, { retryable: true, cause: error })
  } finally {
    lines.close()
    stream.destroy()
  }

  if (binary) throw new AgentCoreError('TOOL_EXECUTION_FAILED', 'Binary files cannot be read as text')
  const limited = limitText(output.trimEnd(), options.maxOutputChars)
  return {
    output: limited.text,
    truncated: limited.truncated || lineNumber > endLine,
    startLine,
    endLine: Math.min(lineNumber, endLine),
  }
}

export async function hashFileContent(filePath: string) {
  const hash = createHash('sha256')
  try {
    for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  } catch (error) {
    throw new AgentCoreError('TOOL_EXECUTION_FAILED', `Failed to hash file: ${filePath}`, { retryable: true, cause: error })
  }
  return hash.digest('hex')
}

function positiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value < 1) throw new AgentCoreError('INVALID_INPUT', `${name} must be a positive integer`)
  return value
}
