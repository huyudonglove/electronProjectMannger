import {
  AgentCoreError,
  AgentStepper,
  PersistedRunCoordinator,
  type ApprovalResolution,
  type LoadedCheckpoint,
  type PersistedStepResult,
  type RunCheckpointSummary,
  type VersionedRunComponentSnapshot,
} from '@electron-manager/agent-core'
import { SqliteCheckpointStore } from '@electron-manager/agent-checkpoint-sqlite'
import { LEGACY_PROJECT_MEMORY_RETRIEVAL_REVISION } from '@electron-manager/agent-memory'

import { composeHeadlessAgent, type HeadlessComposition } from './composition.js'
import { decodeProjectMemorySnapshot } from './project-memory-snapshot.js'
import type { HeadlessAgentRunnerOptions, HeadlessAgentRunInput } from './types.js'

export class HeadlessAgentRunner {
  readonly projectRoot: string
  readonly config: HeadlessComposition['config']
  readonly runtime: HeadlessComposition['runtime']
  readonly localRuntime: HeadlessComposition['localRuntime']
  readonly outputStore: HeadlessComposition['outputStore']
  readonly repoMap: HeadlessComposition['repoMap']
  readonly repoMapOutputRef: HeadlessComposition['repoMapOutputRef']
  readonly projectMemorySnapshotRef: HeadlessComposition['projectMemorySnapshotRef']
  readonly router: HeadlessComposition['router']
  readonly snapshots: HeadlessComposition['snapshots']
  readonly #options: HeadlessAgentRunnerOptions
  readonly #store: SqliteCheckpointStore
  readonly #coordinator: PersistedRunCoordinator
  readonly #legacyRuns = new Map<string, {
    composition: HeadlessComposition
    coordinator: PersistedRunCoordinator
  }>()
  #closed = false

  private constructor(composition: HeadlessComposition, options: HeadlessAgentRunnerOptions) {
    this.projectRoot = composition.projectRoot
    this.config = structuredClone(composition.config)
    this.runtime = composition.runtime
    this.localRuntime = composition.localRuntime
    this.outputStore = composition.outputStore
    this.repoMap = composition.repoMap ? structuredClone(composition.repoMap) : undefined
    this.repoMapOutputRef = composition.repoMapOutputRef
    this.projectMemorySnapshotRef = composition.projectMemorySnapshotRef
    this.router = composition.router
    this.snapshots = structuredClone(composition.snapshots)
    this.#options = options
    this.#store = new SqliteCheckpointStore(options.checkpointPath)
    this.#coordinator = this.#createCoordinator(composition)
  }

  #createCoordinator(composition: HeadlessComposition) {
    const stepper = new AgentStepper({
      provider: composition.router,
      runtime: composition.runtime,
      permissionPolicy: this.#options.permissionPolicy,
      tools: composition.tools,
      contextAssembler: composition.contextAssembler,
      promptCachePolicy: composition.promptCachePolicy,
      clock: composition.clock,
    })
    return new PersistedRunCoordinator({
      stepper,
      store: this.#store,
      clock: composition.clock,
      onCommitted: this.#options.onCommitted,
      onPublishError: this.#options.onPublishError,
    })
  }

  static async create(options: HeadlessAgentRunnerOptions) {
    validateOptions(options)
    return new HeadlessAgentRunner(await composeHeadlessAgent(options), options)
  }

  async createRun(input: HeadlessAgentRunInput): Promise<LoadedCheckpoint> {
    this.#assertOpen()
    return await this.#coordinator.create({
      ...structuredClone(input),
      projectRoot: this.projectRoot,
      workLevel: this.config.workLevel,
      limits: structuredClone(this.config.workflow.limits),
    }, structuredClone(this.snapshots))
  }

  async advance(runId: string, signal?: AbortSignal): Promise<PersistedStepResult> {
    this.#assertOpen()
    const coordinator = await this.#compatibleCoordinator(runId)
    return await coordinator.advance(runId, signal)
  }

  async runUntilPause(runId: string, signal?: AbortSignal): Promise<PersistedStepResult> {
    let result = await this.advance(runId, signal)
    while (result.decision.kind === 'continue') result = await this.advance(runId, signal)
    return result
  }

  async resolveApproval(runId: string, resolution: ApprovalResolution, signal?: AbortSignal): Promise<PersistedStepResult> {
    this.#assertOpen()
    const coordinator = await this.#compatibleCoordinator(runId)
    return await coordinator.resolveApproval(runId, resolution, signal)
  }

  async cancel(runId: string, reason?: string): Promise<PersistedStepResult> {
    this.#assertOpen()
    return await this.#coordinator.cancel(runId, reason)
  }

  async load(runId: string): Promise<LoadedCheckpoint | null> {
    this.#assertOpen()
    return await this.#store.load(runId)
  }

  async list(): Promise<RunCheckpointSummary[]> {
    this.#assertOpen()
    return await this.#store.list()
  }

  async readOutput(ref: string) {
    this.#assertOpen()
    return await this.outputStore.read(ref)
  }

  close() {
    if (this.#closed) return
    this.#closed = true
    this.#store.close()
  }

  async #compatibleCoordinator(runId: string) {
    const loaded = await this.#store.load(runId)
    if (!loaded) throw new AgentCoreError('CHECKPOINT_ERROR', `Run checkpoint does not exist: ${runId}`)
    const legacyMemory = legacyProjectMemorySnapshot(loaded.snapshot.memorySnapshot)
    const legacyRun = legacyMemory ? await this.#legacyRun(runId, legacyMemory) : undefined
    const legacyComposition = legacyRun?.composition
    const snapshots = legacyComposition?.snapshots ?? this.snapshots
    const pairs = [
      ['config', loaded.snapshot.configSnapshot, snapshots.configSnapshot],
      ['model route', loaded.snapshot.modelRouteSnapshot, snapshots.modelRouteSnapshot],
      ['tool registry', loaded.snapshot.toolRegistrySnapshot, snapshots.toolRegistrySnapshot],
      ['memory', loaded.snapshot.memorySnapshot, snapshots.memorySnapshot],
    ] as const
    for (const [name, saved, current] of pairs) assertRevision(name, saved, current)
    return legacyRun?.coordinator ?? this.#coordinator
  }

  async #legacyRun(
    runId: string,
    memory: { revision: string; snapshotRef: string },
  ) {
    const cached = this.#legacyRuns.get(runId)
    if (cached) return cached
    const artifact = await this.outputStore.read(memory.snapshotRef)
    const documents = decodeProjectMemorySnapshot(artifact.content, memory.revision)
    const composition = await composeHeadlessAgent({
      ...this.#options,
      projectMemoryDocuments: documents,
      projectMemoryRetrievalRevision: LEGACY_PROJECT_MEMORY_RETRIEVAL_REVISION,
    })
    const legacyRun = { composition, coordinator: this.#createCoordinator(composition) }
    this.#legacyRuns.set(runId, legacyRun)
    return legacyRun
  }

  #assertOpen() {
    if (this.#closed) throw new AgentCoreError('CHECKPOINT_ERROR', 'HeadlessAgentRunner is closed')
  }
}

function legacyProjectMemorySnapshot(snapshot: VersionedRunComponentSnapshot | undefined) {
  const data = snapshot?.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
  const record = data as Record<string, unknown>
  if (record.retrievalRevision !== undefined
    || typeof record.projectMemoryRevision !== 'string'
    || typeof record.projectMemorySnapshotRef !== 'string') return undefined
  return {
    revision: record.projectMemoryRevision,
    snapshotRef: record.projectMemorySnapshotRef,
  }
}

function validateOptions(options: HeadlessAgentRunnerOptions) {
  if (!options.projectRoot.trim()) throw new AgentCoreError('INVALID_INPUT', 'Project root is required')
  if (!options.checkpointPath.trim()) throw new AgentCoreError('INVALID_INPUT', 'Checkpoint path is required')
  if (options.outputDirectory !== undefined && !options.outputDirectory.trim()) {
    throw new AgentCoreError('INVALID_INPUT', 'Output directory must not be empty')
  }
}

function assertRevision(
  name: string,
  saved: VersionedRunComponentSnapshot | undefined,
  current: VersionedRunComponentSnapshot,
) {
  if (!saved || saved.schemaVersion !== current.schemaVersion || saved.revision !== current.revision) {
    throw new AgentCoreError('CHECKPOINT_ERROR', `Current ${name} does not match the run snapshot`, {
      details: {
        component: name,
        savedRevision: saved?.revision ?? 'missing',
        currentRevision: current.revision,
      },
    })
  }
}

export async function createHeadlessAgentRunner(options: HeadlessAgentRunnerOptions) {
  return await HeadlessAgentRunner.create(options)
}
