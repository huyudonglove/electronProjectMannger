import { realpath } from 'node:fs/promises'
import path from 'node:path'

import { AgentCoreError } from '@electron-manager/agent-core'

export interface ResolvedProjectPath {
  projectRoot: string
  absolutePath: string
  relativePath: string
  exists: boolean
}

export async function resolveProjectPath(projectRoot: string, requestedPath = '.'): Promise<ResolvedProjectPath> {
  if (requestedPath.includes('\0')) throw new AgentCoreError('INVALID_INPUT', 'Path cannot contain null bytes')
  const root = await realpath(projectRoot)
  const lexicalTarget = path.resolve(root, requestedPath || '.')
  assertPathInside(root, lexicalTarget, requestedPath)

  let target: string
  try {
    target = await realpath(lexicalTarget)
  } catch (error) {
    throw new AgentCoreError('TOOL_EXECUTION_FAILED', `Path does not exist: ${requestedPath}`, {
      retryable: true,
      details: { path: requestedPath },
      cause: error,
    })
  }
  assertPathInside(root, target, requestedPath)
  return {
    projectRoot: root,
    absolutePath: target,
    relativePath: path.relative(root, target) || '.',
    exists: true,
  }
}

export async function resolveProjectPathCandidate(projectRoot: string, requestedPath: string): Promise<ResolvedProjectPath> {
  if (requestedPath.includes('\0')) throw new AgentCoreError('INVALID_INPUT', 'Path cannot contain null bytes')
  const root = await realpath(projectRoot)
  const lexicalTarget = path.resolve(root, requestedPath || '.')
  assertPathInside(root, lexicalTarget, requestedPath)

  let existingAncestor = lexicalTarget
  while (true) {
    try {
      const resolvedAncestor = await realpath(existingAncestor)
      assertPathInside(root, resolvedAncestor, requestedPath)
      return {
        projectRoot: root,
        absolutePath: lexicalTarget,
        relativePath: path.relative(root, lexicalTarget) || '.',
        exists: existingAncestor === lexicalTarget,
      }
    } catch (error) {
      if (error instanceof AgentCoreError) throw error
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw new AgentCoreError('TOOL_EXECUTION_FAILED', `Cannot resolve path: ${requestedPath}`, {
          retryable: true,
          details: { path: requestedPath },
          cause: error,
        })
      }
      const parent = path.dirname(existingAncestor)
      if (parent === existingAncestor) {
        throw new AgentCoreError('TOOL_EXECUTION_FAILED', `Cannot resolve path: ${requestedPath}`, {
          retryable: true,
          details: { path: requestedPath },
          cause: error,
        })
      }
      existingAncestor = parent
    }
  }
}

export function assertPathInside(projectRoot: string, targetPath: string, requestedPath = targetPath) {
  const relative = path.relative(projectRoot, targetPath)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new AgentCoreError('PATH_OUTSIDE_PROJECT', `Path escapes project root: ${requestedPath}`, {
      details: { path: requestedPath },
    })
  }
}
