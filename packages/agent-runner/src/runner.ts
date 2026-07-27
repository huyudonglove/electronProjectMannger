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

import { composeHeadlessAgent, type HeadlessComposition } from './composition.js'
import type { HeadlessAgentRunnerOptions, HeadlessAgentRunInput } from './types.js'

export class HeadlessAgentRunner {
  readonly projectRoot: string
  readonly config: HeadlessComposition['config']
  readonly runtime: HeadlessComposition['runtime']
  readonly localRuntime: HeadlessComposition['localRuntime']
  readonly outputStore: HeadlessComposition['outputStore']
  readonly repoMap: HeadlessComposition['repoMap']
  readonly repoMapOutputRef: HeadlessComposition['repoMapOutputRef']
  readonly router: HeadlessComposition['router']
  readonly snapshots: HeadlessComposition['snapshots']
  readonly #store: SqliteCheckpointStore
  readonly #coordinator: PersistedRunCoordinator
  #closed = false

  private constructor(composition: HeadlessComposition, options: HeadlessAgentRunnerOptions) {
    this.projectRoot = composition.projectRoot
    this.config = structuredClone(composition.config)
    this.runtime = composition.runtime
    this.localRuntime = composition.localRuntime
    this.outputStore = composition.outputStore
    this.repoMap = composition.repoMap ? structuredClone(composition.repoMap) : undefined
    this.repoMapOutputRef = composition.repoMapOutputRef
    this.router = composition.router
    this.snapshots = structuredClone(composition.snapshots)
    this.#store = new SqliteCheckpointStore(options.checkpointPath)
    const stepper = new AgentStepper({
      provider: composition.router,
      runtime: composition.runtime,
      permissionPolicy: options.permissionPolicy,
      tools: composition.tools,
      contextAssembler: composition.contextAssembler,
      promptCachePolicy: composition.promptCachePolicy,
      clock: composition.clock,
    })
    this.#coordinator = new PersistedRunCoordinator({
      stepper,
      store: this.#store,
      clock: composition.clock,
      onCommitted: options.onCommitted,
      onPublishError: options.onPublishError,
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
    await this.#assertCompatible(runId)
    return await this.#coordinator.advance(runId, signal)
  }

  async runUntilPause(runId: string, signal?: AbortSignal): Promise<PersistedStepResult> {
    let result = await this.advance(runId, signal)
    while (result.decision.kind === 'continue') result = await this.advance(runId, signal)
    return result
  }

  async resolveApproval(runId: string, resolution: ApprovalResolution, signal?: AbortSignal): Promise<PersistedStepResult> {
    this.#assertOpen()
    await this.#assertCompatible(runId)
    return await this.#coordinator.resolveApproval(runId, resolution, signal)
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

  async #assertCompatible(runId: string) {
    const loaded = await this.#store.load(runId)
    if (!loaded) throw new AgentCoreError('CHECKPOINT_ERROR', `Run checkpoint does not exist: ${runId}`)
    const pairs = [
      ['config', loaded.snapshot.configSnapshot, this.snapshots.configSnapshot],
      ['model route', loaded.snapshot.modelRouteSnapshot, this.snapshots.modelRouteSnapshot],
      ['tool registry', loaded.snapshot.toolRegistrySnapshot, this.snapshots.toolRegistrySnapshot],
      ['memory', loaded.snapshot.memorySnapshot, this.snapshots.memorySnapshot],
    ] as const
    for (const [name, saved, current] of pairs) assertRevision(name, saved, current)
  }

  #assertOpen() {
    if (this.#closed) throw new AgentCoreError('CHECKPOINT_ERROR', 'HeadlessAgentRunner is closed')
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
