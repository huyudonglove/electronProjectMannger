import { chmod, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'

import { AgentCoreError } from '@electron-manager/agent-core'

export interface PreparedFileChange {
  absolutePath: string
  relativePath: string
  beforeContent: string
  afterContent: string
  beforeHash: string
  afterHash: string
  mode: number
}

interface TransactionFile extends PreparedFileChange {
  temporaryPath: string
  backupPath: string
  backupCreated: boolean
}

export async function commitFileTransaction(changes: PreparedFileChange[]) {
  if (!changes.length) throw new AgentCoreError('INVALID_INPUT', 'File transaction requires at least one change')
  const transactionId = randomUUID()
  const files: TransactionFile[] = changes.map((change) => ({
    ...change,
    temporaryPath: path.join(path.dirname(change.absolutePath), `.${path.basename(change.absolutePath)}.agent-tmp-${transactionId}`),
    backupPath: path.join(path.dirname(change.absolutePath), `.${path.basename(change.absolutePath)}.agent-backup-${transactionId}`),
    backupCreated: false,
  }))

  let committed = false
  try {
    for (const file of files) {
      await writeFile(file.temporaryPath, file.afterContent, { encoding: 'utf8', flag: 'wx' })
      await chmod(file.temporaryPath, file.mode)
    }

    for (const file of files) {
      await assertFileUnchanged(file)
      await rename(file.absolutePath, file.backupPath)
      file.backupCreated = true
      await rename(file.temporaryPath, file.absolutePath)
    }

    committed = true
  } catch (error) {
    const rollbackErrors: string[] = []
    for (const file of [...files].reverse()) {
      if (!file.backupCreated) continue
      try {
        await rm(file.absolutePath, { force: true })
        await rename(file.backupPath, file.absolutePath)
        file.backupCreated = false
      } catch (rollbackError) {
        rollbackErrors.push(`${file.relativePath}: ${String(rollbackError)}`)
      }
    }
    await Promise.allSettled(files.flatMap((file) => [
      rm(file.temporaryPath, { force: true }),
      ...(file.backupCreated ? [] : [rm(file.backupPath, { force: true })]),
    ]))
    if (rollbackErrors.length) {
      throw new AgentCoreError('TOOL_EXECUTION_FAILED', 'File transaction failed and rollback was incomplete', {
        details: { rollbackErrors },
        cause: error,
      })
    }
    if (error instanceof AgentCoreError) throw error
    throw new AgentCoreError('TOOL_EXECUTION_FAILED', 'File transaction failed and was rolled back', {
      retryable: true,
      cause: error,
    })
  } finally {
    await Promise.allSettled(files.map((file) => rm(file.temporaryPath, { force: true })))
  }

  if (committed) {
    await Promise.allSettled(files.map(async (file) => {
      await rm(file.backupPath, { force: true })
      file.backupCreated = false
    }))
  }
}

export async function preparedFileChange(absolutePath: string, relativePath: string, afterContent: string): Promise<PreparedFileChange> {
  const beforeContent = await readFile(absolutePath, 'utf8')
  if (beforeContent.includes('\0')) throw new AgentCoreError('PATCH_CONFLICT', `Binary files cannot be patched: ${relativePath}`)
  const fileStat = await stat(absolutePath)
  return {
    absolutePath,
    relativePath,
    beforeContent,
    afterContent,
    beforeHash: contentHash(beforeContent),
    afterHash: contentHash(afterContent),
    mode: fileStat.mode & 0o777,
  }
}

export function contentHash(content: string) {
  return createHash('sha256').update(content).digest('hex')
}

async function assertFileUnchanged(file: PreparedFileChange) {
  const current = await readFile(file.absolutePath, 'utf8')
  if (contentHash(current) !== file.beforeHash) {
    throw new AgentCoreError('PATCH_CONFLICT', `File changed while patch was being prepared: ${file.relativePath}`, {
      retryable: true,
      details: { path: file.relativePath },
    })
  }
}
