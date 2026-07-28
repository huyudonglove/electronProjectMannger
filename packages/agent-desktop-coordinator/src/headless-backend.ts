import { AgentCoreError, type WorkLevel } from '@electron-manager/agent-core'
import {
  HeadlessAgentRunRepository,
  MAX_PROJECT_MEMORY_SNAPSHOT_BYTES,
  createHeadlessAgentRunner,
  decodeProjectMemorySnapshot,
  type HeadlessAgentRunnerOptions,
} from '@electron-manager/agent-runner'

import type { DesktopAgentBackend } from './types.js'

export interface HeadlessDesktopStorageOptions {
  checkpointPath: string
  outputDirectory?: string
  maxOutputArtifactBytes?: number
}

export interface HeadlessDesktopAgentBackendOptions {
  storageFor(projectRoot: string): HeadlessDesktopStorageOptions | Promise<HeadlessDesktopStorageOptions>
  runnerOptionsFor(input: {
    projectRoot: string
    runId: string
    workLevel: WorkLevel
  }): Promise<Omit<
    HeadlessAgentRunnerOptions,
    | 'projectRoot'
    | 'workLevel'
    | 'checkpointPath'
    | 'outputDirectory'
    | 'maxOutputArtifactBytes'
    | 'onCommitted'
    | 'onPublishError'
  >> | Omit<
    HeadlessAgentRunnerOptions,
    | 'projectRoot'
    | 'workLevel'
    | 'checkpointPath'
    | 'outputDirectory'
    | 'maxOutputArtifactBytes'
    | 'onCommitted'
    | 'onPublishError'
  >
}

export function createHeadlessDesktopAgentBackend(options: HeadlessDesktopAgentBackendOptions): DesktopAgentBackend {
  return {
    async openRunner(input) {
      const [storage, currentConfigured] = await Promise.all([
        options.storageFor(input.projectRoot),
        options.runnerOptionsFor({ projectRoot: input.projectRoot, runId: input.runId, workLevel: input.workLevel }),
      ])
      const configured = await restoreProjectMemorySnapshot(storage, input.runId, currentConfigured)
      return await createHeadlessAgentRunner({
        ...configured,
        ...storage,
        projectRoot: input.projectRoot,
        workLevel: input.workLevel,
        onCommitted: input.onCommitted,
        onPublishError: input.onPublishError,
      })
    },
    async openRepository(projectRoot) {
      return new HeadlessAgentRunRepository(await options.storageFor(projectRoot))
    },
  }
}

async function restoreProjectMemorySnapshot(
  storage: HeadlessDesktopStorageOptions,
  runId: string,
  configured: Awaited<ReturnType<HeadlessDesktopAgentBackendOptions['runnerOptionsFor']>>,
) {
  const repository = new HeadlessAgentRunRepository(storage)
  try {
    const checkpoint = await repository.load(runId)
    if (!checkpoint) return configured
    const data = checkpoint.snapshot.memorySnapshot?.data as Record<string, unknown> | undefined
    const revision = typeof data?.projectMemoryRevision === 'string' ? data.projectMemoryRevision : ''
    const ref = typeof data?.projectMemorySnapshotRef === 'string' ? data.projectMemorySnapshotRef : ''
    if (!revision && !ref) return { ...configured, projectMemoryDocuments: [] }
    if (!revision || !/^output:sha256:[a-f0-9]{64}$/.test(ref)) {
      throw new AgentCoreError('CHECKPOINT_ERROR', 'Run Project Memory snapshot reference is missing or invalid')
    }
    const stored = await repository.readOutput(ref)
    if (stored.artifact.bytes > MAX_PROJECT_MEMORY_SNAPSHOT_BYTES) {
      throw new AgentCoreError('CHECKPOINT_ERROR', 'Run Project Memory snapshot exceeds its byte limit')
    }
    return {
      ...configured,
      projectMemoryDocuments: decodeProjectMemorySnapshot(stored.content, revision),
    }
  } finally {
    repository.close()
  }
}
