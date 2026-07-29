import { createHash } from 'node:crypto'

import { runProcess } from './process-runner.js'

const MAX_GIT_EVIDENCE_CHARS = 1_000_000
const MAX_REPORTED_PATHS = 200

export interface GitWorktreeSnapshot {
  schemaVersion: 1
  available: boolean
  statusComplete: boolean
  diffComplete: boolean
  dirtyPathCount: number
  dirtyPaths: string[]
  pathsTruncated: boolean
  statusHash?: string
  diffHash?: string
  reason?: string
}

export interface CommandRepositoryEvidence {
  schemaVersion: 1
  available: boolean
  worktreeChanged: boolean
  introducedPaths: string[]
  removedPaths: string[]
  before: GitWorktreeSnapshot
  after: GitWorktreeSnapshot
}

export async function captureGitWorktreeSnapshot(
  projectRoot: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv,
): Promise<GitWorktreeSnapshot> {
  try {
    const status = await runProcess('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
      cwd: projectRoot,
      timeoutMs,
      maxOutputChars: MAX_GIT_EVIDENCE_CHARS,
      env,
    })
    if (status.exitCode !== 0 || status.timedOut) {
      return unavailableSnapshot(status.stderr || status.output || `git status exited with ${status.exitCode}`)
    }

    const diff = await runProcess('git', ['diff', '--no-ext-diff', '--binary', 'HEAD', '--'], {
      cwd: projectRoot,
      timeoutMs,
      maxOutputChars: MAX_GIT_EVIDENCE_CHARS,
      env,
    })
    const dirtyPaths = parsePorcelainPaths(status.stdout)
    const reportedPaths = dirtyPaths.slice(0, MAX_REPORTED_PATHS)
    const statusComplete = streamComplete(status.stdoutChars, status.truncated)
    const diffComplete = diff.exitCode === 0 && !diff.timedOut && streamComplete(diff.stdoutChars, diff.truncated)
    return {
      schemaVersion: 1,
      available: true,
      statusComplete,
      diffComplete,
      dirtyPathCount: dirtyPaths.length,
      dirtyPaths: reportedPaths,
      pathsTruncated: dirtyPaths.length > reportedPaths.length,
      ...(statusComplete ? { statusHash: hash(status.stdout) } : {}),
      ...(diffComplete ? { diffHash: hash(diff.stdout) } : {}),
      ...(!diffComplete && (diff.stderr || diff.output)
        ? { reason: limitedReason(diff.stderr || diff.output) }
        : {}),
    }
  } catch (error) {
    return unavailableSnapshot(error instanceof Error ? error.message : String(error))
  }
}

export function compareGitWorktreeSnapshots(
  before: GitWorktreeSnapshot,
  after: GitWorktreeSnapshot,
): CommandRepositoryEvidence {
  const beforePaths = new Set(before.dirtyPaths)
  const afterPaths = new Set(after.dirtyPaths)
  const comparable = before.available
    && after.available
    && before.statusComplete
    && after.statusComplete
    && before.diffComplete
    && after.diffComplete
    && !before.pathsTruncated
    && !after.pathsTruncated
  return {
    schemaVersion: 1,
    available: comparable,
    worktreeChanged: comparable
      ? before.statusHash !== after.statusHash || before.diffHash !== after.diffHash
      : false,
    introducedPaths: comparable ? [...afterPaths].filter((entry) => !beforePaths.has(entry)).sort() : [],
    removedPaths: comparable ? [...beforePaths].filter((entry) => !afterPaths.has(entry)).sort() : [],
    before,
    after,
  }
}

function unavailableSnapshot(reason: string): GitWorktreeSnapshot {
  return {
    schemaVersion: 1,
    available: false,
    statusComplete: false,
    diffComplete: false,
    dirtyPathCount: 0,
    dirtyPaths: [],
    pathsTruncated: false,
    reason: limitedReason(reason),
  }
}

function streamComplete(stdoutChars: number, truncated: boolean) {
  return !truncated && stdoutChars <= MAX_GIT_EVIDENCE_CHARS
}

function parsePorcelainPaths(output: string) {
  const fields = output.split('\0')
  const paths = new Set<string>()
  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index]
    if (!entry) continue
    const status = entry.slice(0, 2)
    const entryPath = entry.slice(3)
    if (entryPath) paths.add(entryPath)
    if ((status.includes('R') || status.includes('C')) && fields[index + 1]) {
      paths.add(fields[index + 1]!)
      index += 1
    }
  }
  return [...paths].sort()
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function limitedReason(value: string) {
  return value.slice(0, 1_000)
}
