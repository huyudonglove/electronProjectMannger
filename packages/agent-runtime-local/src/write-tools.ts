import { writeFile } from 'node:fs/promises'

import { AgentCoreError, type JsonValue } from '@electron-manager/agent-core'
import { commitFileTransaction, contentHash, preparedFileChange, type PreparedFileChange } from './file-transaction.js'
import { resolveExistingWritablePath, resolveNewWritablePath } from './path-guard.js'

export interface PatchReplaceOperation {
  path: string
  oldText: string
  newText: string
  expectedOccurrences: number
  expectedHash?: string
}

export async function createProjectFile(projectRoot: string, requestedPath: string, content: string, maxWriteChars: number) {
  if (content.length > maxWriteChars) {
    throw new AgentCoreError('LIMIT_EXCEEDED', `New file exceeds write limit of ${maxWriteChars} characters`)
  }
  if (content.includes('\0')) throw new AgentCoreError('INVALID_INPUT', 'New text files cannot contain null bytes')
  const target = await resolveNewWritablePath(projectRoot, requestedPath)
  try {
    await writeFile(target.absolutePath, content, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new AgentCoreError('PATCH_CONFLICT', `Create target appeared before write: ${requestedPath}`, {
        retryable: true,
        details: { path: requestedPath },
      })
    }
    throw new AgentCoreError('TOOL_EXECUTION_FAILED', `Failed to create file: ${requestedPath}`, {
      retryable: true,
      cause: error,
    })
  }
  return {
    path: target.relativePath,
    afterHash: contentHash(content),
  }
}

export async function preparePatch(
  projectRoot: string,
  operations: PatchReplaceOperation[],
  maxWriteChars: number,
): Promise<PreparedFileChange[]> {
  if (!operations.length) throw new AgentCoreError('INVALID_INPUT', 'apply_patch requires at least one operation')
  if (operations.length > 100) throw new AgentCoreError('LIMIT_EXCEEDED', 'apply_patch cannot contain more than 100 operations')

  const grouped = new Map<string, PatchReplaceOperation[]>()
  for (const operation of operations) {
    if (!operation.path.trim()) throw new AgentCoreError('INVALID_INPUT', 'Patch path is required')
    if (!operation.oldText) throw new AgentCoreError('INVALID_INPUT', `Patch oldText cannot be empty: ${operation.path}`)
    if (operation.oldText === operation.newText) throw new AgentCoreError('INVALID_INPUT', `Patch replacement is a no-op: ${operation.path}`)
    if (!Number.isInteger(operation.expectedOccurrences) || operation.expectedOccurrences < 1) {
      throw new AgentCoreError('INVALID_INPUT', `expectedOccurrences must be a positive integer: ${operation.path}`)
    }
    grouped.set(operation.path, [...(grouped.get(operation.path) || []), operation])
  }

  const changes: PreparedFileChange[] = []
  const resolvedTargets = new Set<string>()
  for (const [requestedPath, fileOperations] of grouped) {
    const target = await resolveExistingWritablePath(projectRoot, requestedPath)
    if (resolvedTargets.has(target.absolutePath)) {
      throw new AgentCoreError('INVALID_INPUT', `Patch contains duplicate aliases for the same file: ${requestedPath}`)
    }
    resolvedTargets.add(target.absolutePath)
    const initial = await preparedFileChange(target.absolutePath, target.relativePath, '')
    let content = initial.beforeContent
    for (const operation of fileOperations) {
      if (operation.expectedHash && initial.beforeHash !== operation.expectedHash) {
        throw patchConflict(requestedPath, 'File hash does not match expectedHash')
      }
      const occurrences = countOccurrences(content, operation.oldText)
      if (occurrences !== operation.expectedOccurrences) {
        throw patchConflict(requestedPath, `Expected ${operation.expectedOccurrences} occurrence(s), found ${occurrences}`)
      }
      content = content.split(operation.oldText).join(operation.newText)
      if (content.length > maxWriteChars) {
        throw new AgentCoreError('LIMIT_EXCEEDED', `Patched file exceeds write limit of ${maxWriteChars} characters`, {
          details: { path: requestedPath },
        })
      }
    }
    if (content === initial.beforeContent) {
      throw new AgentCoreError('INVALID_INPUT', `Patch produces no net change: ${requestedPath}`)
    }
    changes.push({ ...initial, afterContent: content, afterHash: contentHash(content) })
  }
  const totalWriteChars = changes.reduce((total, change) => total + change.afterContent.length, 0)
  if (totalWriteChars > maxWriteChars) {
    throw new AgentCoreError('LIMIT_EXCEEDED', `Patch transaction exceeds write limit of ${maxWriteChars} characters`)
  }
  return changes
}

export async function applyProjectPatch(projectRoot: string, operations: PatchReplaceOperation[], maxWriteChars: number) {
  const changes = await preparePatch(projectRoot, operations, maxWriteChars)
  await commitFileTransaction(changes)
  return changes.map((change) => ({
    path: change.relativePath,
    beforeHash: change.beforeHash,
    afterHash: change.afterHash,
  }))
}

export function parsePatchOperations(value: JsonValue | undefined): PatchReplaceOperation[] {
  if (!Array.isArray(value)) throw new AgentCoreError('INVALID_INPUT', 'operations must be an array')
  return value.map((item, index) => {
    if (!item || Array.isArray(item) || typeof item !== 'object') {
      throw new AgentCoreError('INVALID_INPUT', `Patch operation ${index + 1} must be an object`)
    }
    const path = item.path
    const oldText = item.oldText
    const newText = item.newText
    const expectedOccurrences = item.expectedOccurrences ?? 1
    const expectedHash = item.expectedHash
    if (typeof path !== 'string' || typeof oldText !== 'string' || typeof newText !== 'string') {
      throw new AgentCoreError('INVALID_INPUT', `Patch operation ${index + 1} requires string path, oldText and newText`)
    }
    if (typeof expectedOccurrences !== 'number') {
      throw new AgentCoreError('INVALID_INPUT', `Patch operation ${index + 1} expectedOccurrences must be numeric`)
    }
    if (expectedHash !== undefined && typeof expectedHash !== 'string') {
      throw new AgentCoreError('INVALID_INPUT', `Patch operation ${index + 1} expectedHash must be a string`)
    }
    return { path, oldText, newText, expectedOccurrences, ...(expectedHash ? { expectedHash } : {}) }
  })
}

function countOccurrences(content: string, search: string) {
  let count = 0
  let from = 0
  while (true) {
    const index = content.indexOf(search, from)
    if (index < 0) return count
    count += 1
    from = index + search.length
  }
}

function patchConflict(path: string, reason: string) {
  return new AgentCoreError('PATCH_CONFLICT', `Patch conflict in ${path}: ${reason}`, {
    retryable: true,
    details: { path },
  })
}
