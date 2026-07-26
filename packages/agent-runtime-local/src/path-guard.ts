import { lstat, realpath, stat } from 'node:fs/promises'
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

export async function resolveExistingWritablePath(projectRoot: string, requestedPath: string): Promise<ResolvedProjectPath> {
  const root = await realpath(projectRoot)
  const lexicalTarget = path.resolve(root, requestedPath)
  assertPathInside(root, lexicalTarget, requestedPath)
  assertWritableRelativePath(root, lexicalTarget, requestedPath)
  try {
    await lstat(lexicalTarget)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AgentCoreError('PATCH_CONFLICT', `Patch target does not exist: ${requestedPath}`, {
        retryable: true,
        details: { path: requestedPath },
      })
    }
    throw error
  }
  await assertNoSymlinkComponents(root, lexicalTarget, requestedPath)
  const target = await realpath(lexicalTarget)
  assertPathInside(root, target, requestedPath)
  const targetStat = await stat(target)
  if (!targetStat.isFile()) throw new AgentCoreError('INVALID_INPUT', `Writable target is not a file: ${requestedPath}`)
  return {
    projectRoot: root,
    absolutePath: target,
    relativePath: path.relative(root, target) || '.',
    exists: true,
  }
}

export async function resolveNewWritablePath(projectRoot: string, requestedPath: string): Promise<ResolvedProjectPath> {
  const root = await realpath(projectRoot)
  const lexicalTarget = path.resolve(root, requestedPath)
  assertPathInside(root, lexicalTarget, requestedPath)
  assertWritableRelativePath(root, lexicalTarget, requestedPath)
  if (lexicalTarget === root) throw new AgentCoreError('INVALID_INPUT', 'Cannot create a file over the project root')

  try {
    await lstat(lexicalTarget)
    throw new AgentCoreError('PATCH_CONFLICT', `Create target already exists: ${requestedPath}`, {
      retryable: true,
      details: { path: requestedPath },
    })
  } catch (error) {
    if (error instanceof AgentCoreError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new AgentCoreError('TOOL_EXECUTION_FAILED', `Cannot inspect create target: ${requestedPath}`, {
        retryable: true,
        cause: error,
      })
    }
  }

  const parent = path.dirname(lexicalTarget)
  await assertNoSymlinkComponents(root, parent, requestedPath)
  const resolvedParent = await realpath(parent)
  assertPathInside(root, resolvedParent, requestedPath)
  if (!(await stat(resolvedParent)).isDirectory()) {
    throw new AgentCoreError('INVALID_INPUT', `Create target parent is not a directory: ${requestedPath}`)
  }
  return {
    projectRoot: root,
    absolutePath: lexicalTarget,
    relativePath: path.relative(root, lexicalTarget),
    exists: false,
  }
}

function assertWritableRelativePath(projectRoot: string, targetPath: string, requestedPath: string) {
  const relative = path.relative(projectRoot, targetPath)
  if (relative === '.git' || relative.startsWith(`.git${path.sep}`)) {
    throw new AgentCoreError('PERMISSION_DENIED', `Writing Git internal files is not allowed: ${requestedPath}`, {
      details: { path: requestedPath },
    })
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

async function assertNoSymlinkComponents(projectRoot: string, targetPath: string, requestedPath: string) {
  const relative = path.relative(projectRoot, targetPath)
  let current = projectRoot
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    let entry
    try {
      entry = await lstat(current)
    } catch (error) {
      throw new AgentCoreError('TOOL_EXECUTION_FAILED', `Path component does not exist: ${requestedPath}`, {
        retryable: true,
        details: { path: requestedPath },
        cause: error,
      })
    }
    if (entry.isSymbolicLink()) {
      throw new AgentCoreError('PATH_OUTSIDE_PROJECT', `Writable paths cannot contain symbolic links: ${requestedPath}`, {
        details: { path: requestedPath },
      })
    }
  }
}
