import { chmod, lstat, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'

import { AgentCoreError } from '@electron-manager/agent-core'

export const FILE_TRANSACTION_SCHEMA_VERSION = 1
export const FILE_TRANSACTION_MANIFEST_PREFIX = '.electron-manager-agent-transaction-'

export interface PreparedFileChange {
  absolutePath: string
  relativePath: string
  beforeContent: string
  afterContent: string
  beforeHash: string
  afterHash: string
  mode: number
}

export interface FileTransactionRecoveryEntry {
  transactionId: string
  outcome: 'committed' | 'rolled_back'
  paths: string[]
}

export interface FileTransactionRecoveryReport {
  scanned: number
  recovered: FileTransactionRecoveryEntry[]
}

type TransactionPhase = 'preparing' | 'replacing' | 'committed'

interface StoredTransactionFile {
  relativePath: string
  beforeHash: string
  afterHash: string
  mode: number
}

interface FileTransactionManifest {
  schemaVersion: typeof FILE_TRANSACTION_SCHEMA_VERSION
  transactionId: string
  phase: TransactionPhase
  files: StoredTransactionFile[]
}

interface TransactionFile extends PreparedFileChange {
  temporaryPath: string
  backupPath: string
}

interface InspectedPath {
  exists: boolean
  hash?: string
}

export async function commitFileTransaction(projectRoot: string, changes: PreparedFileChange[]) {
  if (!changes.length) throw new AgentCoreError('INVALID_INPUT', 'File transaction requires at least one change')
  const root = await realpath(projectRoot)
  const transactionId = randomUUID()
  const files = transactionFiles(root, changes, transactionId)
  const manifest: FileTransactionManifest = {
    schemaVersion: FILE_TRANSACTION_SCHEMA_VERSION,
    transactionId,
    phase: 'preparing',
    files: files.map(({ relativePath, beforeHash, afterHash, mode }) => ({
      relativePath,
      beforeHash,
      afterHash,
      mode,
    })),
  }
  const manifestPath = fileTransactionManifestPath(root, transactionId)
  let manifestWritten = false

  try {
    await writeManifest(root, manifest)
    manifestWritten = true
    for (const file of files) {
      await writeDurableFile(file.temporaryPath, file.afterContent, file.mode)
    }

    manifest.phase = 'replacing'
    await writeManifest(root, manifest)
    for (const file of files) {
      await assertFileUnchanged(file)
      await rename(file.absolutePath, file.backupPath)
      await syncDirectory(path.dirname(file.absolutePath))
      await rename(file.temporaryPath, file.absolutePath)
      await syncDirectory(path.dirname(file.absolutePath))
    }

    manifest.phase = 'committed'
    await writeManifest(root, manifest)
    await finalizeCommittedTransaction(root, manifestPath, manifest)
  } catch (error) {
    if (!manifestWritten) {
      await rm(`${manifestPath}.next`, { force: true })
      throw transactionFailure(error)
    }
    try {
      const recovered = await recoverManifest(root, manifestPath, manifest)
      if (recovered.outcome === 'committed') return
    } catch (recoveryError) {
      throw new AgentCoreError('TOOL_EXECUTION_FAILED', 'File transaction failed and crash recovery was incomplete', {
        details: {
          transactionId,
          recoveryError: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
        },
        cause: error,
      })
    }
    throw transactionFailure(error)
  }
}

export async function recoverFileTransactions(projectRoot: string): Promise<FileTransactionRecoveryReport> {
  const root = await realpath(projectRoot)
  const names = await readdir(root)
  const manifests = names
    .filter((name) => name.startsWith(FILE_TRANSACTION_MANIFEST_PREFIX) && name.endsWith('.json'))
    .sort()
  if (manifests.length > 100) {
    throw new AgentCoreError('LIMIT_EXCEEDED', 'Too many pending file transaction manifests', {
      details: { count: manifests.length },
    })
  }

  const manifestSet = new Set(manifests)
  await Promise.all(names
    .filter((name) => name.startsWith(FILE_TRANSACTION_MANIFEST_PREFIX) && name.endsWith('.json.next'))
    .filter((name) => !manifestSet.has(name.slice(0, -'.next'.length)))
    .map((name) => rm(path.join(root, name), { force: true })))

  const recovered: FileTransactionRecoveryEntry[] = []
  for (const name of manifests) {
    const manifestPath = path.join(root, name)
    const manifest = await readManifest(manifestPath, name)
    recovered.push(await recoverManifest(root, manifestPath, manifest))
  }
  if (names.some((name) => name.endsWith('.json.next'))) await syncDirectory(root)
  return { scanned: manifests.length, recovered }
}

export function fileTransactionManifestPath(projectRoot: string, transactionId: string) {
  assertTransactionId(transactionId)
  return path.join(projectRoot, `${FILE_TRANSACTION_MANIFEST_PREFIX}${transactionId}.json`)
}

export async function preparedFileChange(absolutePath: string, relativePath: string, afterContent: string): Promise<PreparedFileChange> {
  const beforeContent = await readFile(absolutePath, 'utf8')
  if (beforeContent.includes('\0')) throw new AgentCoreError('PATCH_CONFLICT', `Binary files cannot be patched: ${relativePath}`)
  const fileStat = await lstat(absolutePath)
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

function transactionFiles(projectRoot: string, changes: PreparedFileChange[], transactionId: string): TransactionFile[] {
  const paths = new Set<string>()
  return changes.map((change) => {
    const absolutePath = path.resolve(change.absolutePath)
    const relativePath = checkedRelativePath(projectRoot, absolutePath, change.relativePath)
    if (paths.has(absolutePath)) throw new AgentCoreError('INVALID_INPUT', `Duplicate file transaction target: ${relativePath}`)
    paths.add(absolutePath)
    validateHash(change.beforeHash, relativePath, 'before')
    validateHash(change.afterHash, relativePath, 'after')
    if (contentHash(change.beforeContent) !== change.beforeHash || contentHash(change.afterContent) !== change.afterHash) {
      throw new AgentCoreError('INVALID_INPUT', `File transaction content hash mismatch: ${relativePath}`)
    }
    if (!Number.isInteger(change.mode) || change.mode < 0 || change.mode > 0o777) {
      throw new AgentCoreError('INVALID_INPUT', `File transaction mode is invalid: ${relativePath}`)
    }
    return {
      ...change,
      absolutePath,
      relativePath,
      temporaryPath: artifactPath(absolutePath, 'tmp', transactionId),
      backupPath: artifactPath(absolutePath, 'backup', transactionId),
    }
  })
}

async function recoverManifest(
  projectRoot: string,
  manifestPath: string,
  manifest: FileTransactionManifest,
): Promise<FileTransactionRecoveryEntry> {
  const files = await recoveryFiles(projectRoot, manifest)
  const states = await Promise.all(files.map(async (file) => ({
    file,
    target: await inspectPath(file.absolutePath),
    temporary: await inspectPath(file.temporaryPath),
    backup: await inspectPath(file.backupPath),
  })))
  const allTargetsAfter = states.every(({ file, target }) => target.exists && target.hash === file.afterHash)
  if (manifest.phase === 'committed' && !allTargetsAfter) {
    throw recoveryConflict(manifest.transactionId, 'Committed transaction target does not match its after hash')
  }
  if (allTargetsAfter) {
    await assertRecoveryArtifacts(states)
    await finalizeCommittedTransaction(projectRoot, manifestPath, manifest)
    return recoveryEntry(manifest, 'committed')
  }

  await assertRollbackSafe(manifest, states)
  for (const { file, backup } of [...states].reverse()) {
    if (backup.exists) {
      await rm(file.absolutePath, { force: true })
      await rename(file.backupPath, file.absolutePath)
      await chmod(file.absolutePath, file.mode)
      await syncDirectory(path.dirname(file.absolutePath))
    }
    await rm(file.temporaryPath, { force: true })
  }
  await removeManifest(projectRoot, manifestPath)
  return recoveryEntry(manifest, 'rolled_back')
}

async function finalizeCommittedTransaction(
  projectRoot: string,
  manifestPath: string,
  manifest: FileTransactionManifest,
) {
  const files = await recoveryFiles(projectRoot, manifest)
  for (const file of files) {
    const target = await inspectPath(file.absolutePath)
    if (!target.exists || target.hash !== file.afterHash) {
      throw recoveryConflict(manifest.transactionId, `Committed target is not recoverable: ${file.relativePath}`)
    }
    const backup = await inspectPath(file.backupPath)
    const temporary = await inspectPath(file.temporaryPath)
    if (backup.exists && backup.hash !== file.beforeHash) {
      throw recoveryConflict(manifest.transactionId, `Backup hash is invalid: ${file.relativePath}`)
    }
    if (temporary.exists && temporary.hash !== file.afterHash) {
      throw recoveryConflict(manifest.transactionId, `Temporary file hash is invalid: ${file.relativePath}`)
    }
    await rm(file.backupPath, { force: true })
    await rm(file.temporaryPath, { force: true })
    await syncDirectory(path.dirname(file.absolutePath))
  }
  await removeManifest(projectRoot, manifestPath)
}

async function assertRecoveryArtifacts(states: Array<{
  file: TransactionFile
  temporary: InspectedPath
  backup: InspectedPath
}>) {
  for (const { file, temporary, backup } of states) {
    if (temporary.exists && temporary.hash !== file.afterHash) {
      throw recoveryConflict('', `Temporary file hash is invalid: ${file.relativePath}`)
    }
    if (backup.exists && backup.hash !== file.beforeHash) {
      throw recoveryConflict('', `Backup hash is invalid: ${file.relativePath}`)
    }
  }
}

async function assertRollbackSafe(
  manifest: FileTransactionManifest,
  states: Array<{
    file: TransactionFile
    target: InspectedPath
    temporary: InspectedPath
    backup: InspectedPath
  }>,
) {
  for (const { file, target, temporary, backup } of states) {
    if (temporary.exists && temporary.hash !== file.afterHash) {
      throw recoveryConflict(manifest.transactionId, `Temporary file was modified externally: ${file.relativePath}`)
    }
    if (backup.exists && backup.hash !== file.beforeHash) {
      throw recoveryConflict(manifest.transactionId, `Backup file was modified externally: ${file.relativePath}`)
    }
    if (backup.exists) {
      if (target.exists && target.hash !== file.beforeHash && target.hash !== file.afterHash) {
        throw recoveryConflict(manifest.transactionId, `Transaction target was modified externally: ${file.relativePath}`)
      }
      continue
    }
    if (!target.exists || target.hash === file.afterHash) {
      throw recoveryConflict(manifest.transactionId, `Original file cannot be recovered safely: ${file.relativePath}`)
    }
  }
}

async function recoveryFiles(projectRoot: string, manifest: FileTransactionManifest): Promise<TransactionFile[]> {
  const paths = new Set<string>()
  return await Promise.all(manifest.files.map(async (stored) => {
    const absolutePath = path.resolve(projectRoot, stored.relativePath)
    const relativePath = checkedRelativePath(projectRoot, absolutePath, stored.relativePath)
    if (paths.has(absolutePath)) throw recoveryConflict(manifest.transactionId, `Duplicate recovery target: ${relativePath}`)
    paths.add(absolutePath)
    const parent = path.dirname(absolutePath)
    const resolvedParent = await realpath(parent)
    if (resolvedParent !== parent) throw recoveryConflict(manifest.transactionId, `Recovery path contains a symbolic link: ${relativePath}`)
    return {
      absolutePath,
      relativePath,
      beforeContent: '',
      afterContent: '',
      beforeHash: stored.beforeHash,
      afterHash: stored.afterHash,
      mode: stored.mode,
      temporaryPath: artifactPath(absolutePath, 'tmp', manifest.transactionId),
      backupPath: artifactPath(absolutePath, 'backup', manifest.transactionId),
    }
  }))
}

async function readManifest(manifestPath: string, manifestName: string): Promise<FileTransactionManifest> {
  let value: unknown
  try {
    value = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    throw new AgentCoreError('TOOL_EXECUTION_FAILED', `File transaction manifest cannot be read: ${manifestName}`, {
      cause: error,
    })
  }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw invalidManifest(manifestName)
  const record = value as Record<string, unknown>
  const transactionId = record.transactionId
  const phase = record.phase
  const files = record.files
  if (record.schemaVersion !== FILE_TRANSACTION_SCHEMA_VERSION
    || typeof transactionId !== 'string'
    || !['preparing', 'replacing', 'committed'].includes(String(phase))
    || !Array.isArray(files)
    || files.length < 1
    || files.length > 100) {
    throw invalidManifest(manifestName)
  }
  assertTransactionId(transactionId)
  if (path.basename(fileTransactionManifestPath('.', transactionId)) !== manifestName) throw invalidManifest(manifestName)
  const normalizedFiles = files.map((item) => validateStoredFile(item, manifestName))
  return {
    schemaVersion: FILE_TRANSACTION_SCHEMA_VERSION,
    transactionId,
    phase: phase as TransactionPhase,
    files: normalizedFiles,
  }
}

function validateStoredFile(value: unknown, manifestName: string): StoredTransactionFile {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw invalidManifest(manifestName)
  const record = value as Record<string, unknown>
  const relativePath = record.relativePath
  const beforeHash = record.beforeHash
  const afterHash = record.afterHash
  const mode = record.mode
  if (typeof relativePath !== 'string'
    || typeof beforeHash !== 'string'
    || typeof afterHash !== 'string'
    || !Number.isInteger(mode)
    || Number(mode) < 0
    || Number(mode) > 0o777) {
    throw invalidManifest(manifestName)
  }
  validateHash(beforeHash, relativePath, 'before')
  validateHash(afterHash, relativePath, 'after')
  return { relativePath, beforeHash, afterHash, mode: Number(mode) }
}

async function writeManifest(projectRoot: string, manifest: FileTransactionManifest) {
  const manifestPath = fileTransactionManifestPath(projectRoot, manifest.transactionId)
  const nextPath = `${manifestPath}.next`
  await rm(nextPath, { force: true })
  await writeDurableFile(nextPath, `${JSON.stringify(manifest)}\n`, 0o600)
  await rename(nextPath, manifestPath)
  await syncDirectory(projectRoot)
}

async function removeManifest(projectRoot: string, manifestPath: string) {
  await rm(`${manifestPath}.next`, { force: true })
  await rm(manifestPath, { force: true })
  await syncDirectory(projectRoot)
}

async function writeDurableFile(filePath: string, content: string, mode: number) {
  const handle = await open(filePath, 'wx', mode)
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await chmod(filePath, mode)
}

async function syncDirectory(directory: string) {
  let handle
  try {
    handle = await open(directory, 'r')
    await handle.sync()
  } catch (error) {
    if (process.platform !== 'win32') throw error
    const code = (error as NodeJS.ErrnoException).code
    if (!['EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR'].includes(String(code))) throw error
  } finally {
    await handle?.close()
  }
}

async function inspectPath(filePath: string): Promise<InspectedPath> {
  try {
    const entry = await lstat(filePath)
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new AgentCoreError('TOOL_EXECUTION_FAILED', 'File transaction artifact is not a regular file')
    }
    return { exists: true, hash: contentHash(await readFile(filePath, 'utf8')) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false }
    throw error
  }
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

function checkedRelativePath(projectRoot: string, absolutePath: string, requestedPath: string) {
  const relativePath = path.relative(projectRoot, absolutePath)
  if (!relativePath
    || relativePath === '..'
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath)
    || relativePath.includes('\0')) {
    throw new AgentCoreError('PATH_OUTSIDE_PROJECT', `File transaction path escapes the project: ${requestedPath}`)
  }
  if (relativePath === '.git' || relativePath.startsWith(`.git${path.sep}`)) {
    throw new AgentCoreError('PERMISSION_DENIED', `File transaction cannot modify Git internals: ${requestedPath}`)
  }
  return relativePath
}

function artifactPath(absolutePath: string, kind: 'tmp' | 'backup', transactionId: string) {
  return path.join(path.dirname(absolutePath), `.${path.basename(absolutePath)}.agent-${kind}-${transactionId}`)
}

function validateHash(value: string, relativePath: string, kind: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new AgentCoreError('INVALID_INPUT', `File transaction ${kind} hash is invalid: ${relativePath}`)
  }
}

function assertTransactionId(transactionId: string) {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(transactionId)) {
    throw new AgentCoreError('INVALID_INPUT', 'File transaction id is invalid')
  }
}

function invalidManifest(manifestName: string) {
  return new AgentCoreError('TOOL_EXECUTION_FAILED', `File transaction manifest is invalid: ${manifestName}`)
}

function recoveryConflict(transactionId: string, message: string) {
  return new AgentCoreError('TOOL_EXECUTION_FAILED', message, {
    details: transactionId ? { transactionId } : undefined,
  })
}

function recoveryEntry(manifest: FileTransactionManifest, outcome: FileTransactionRecoveryEntry['outcome']) {
  return {
    transactionId: manifest.transactionId,
    outcome,
    paths: manifest.files.map((file) => file.relativePath),
  }
}

function transactionFailure(error: unknown) {
  if (error instanceof AgentCoreError) return error
  return new AgentCoreError('TOOL_EXECUTION_FAILED', 'File transaction failed and was rolled back', {
    retryable: true,
    cause: error,
  })
}
