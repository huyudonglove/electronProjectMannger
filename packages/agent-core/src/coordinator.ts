import { AgentCoreError, toAgentError } from './errors.js'
import { createRunLedger, sequenceAgentEvent, transitionLedger } from './ledger.js'
import {
  RUN_SNAPSHOT_SCHEMA_VERSION,
  decideResume,
  type CheckpointStore,
  type EffectRecord,
  type EffectRecovery,
  type LoadedCheckpoint,
  type ResumeDecision,
  type VersionedRunComponentSnapshot,
} from './checkpoint.js'
import type {
  AgentEvent,
  AgentRunInput,
  ToolDefinition,
} from './protocol.js'
import type {
  AgentStepHooks,
  AgentStepResult,
  AgentStepper,
  ApprovalResolution,
  PreparedToolExecution,
} from './stepper.js'

export interface RunComponentSnapshots {
  configSnapshot?: VersionedRunComponentSnapshot
  modelRouteSnapshot?: VersionedRunComponentSnapshot
  toolRegistrySnapshot?: VersionedRunComponentSnapshot
  memorySnapshot?: VersionedRunComponentSnapshot
}

export interface PersistedRunCoordinatorOptions {
  stepper: AgentStepper
  store: CheckpointStore
  clock?: () => string
  onCommitted?: (checkpoint: LoadedCheckpoint, events: AgentEvent[]) => void | Promise<void>
  onPublishError?: (error: unknown, checkpoint: LoadedCheckpoint) => void | Promise<void>
  backendForTool?: (tool: ToolDefinition) => string
}

export interface PersistedStepResult {
  checkpoint: LoadedCheckpoint
  decision: ResumeDecision
  step?: AgentStepResult
}

export class PersistedRunCoordinator {
  readonly #stepper: AgentStepper
  readonly #store: CheckpointStore
  readonly #clock: () => string
  readonly #onCommitted?: PersistedRunCoordinatorOptions['onCommitted']
  readonly #onPublishError?: PersistedRunCoordinatorOptions['onPublishError']
  readonly #backendForTool: NonNullable<PersistedRunCoordinatorOptions['backendForTool']>
  readonly #activeRuns = new Set<string>()

  constructor(options: PersistedRunCoordinatorOptions) {
    this.#stepper = options.stepper
    this.#store = options.store
    this.#clock = options.clock || (() => new Date().toISOString())
    this.#onCommitted = options.onCommitted
    this.#onPublishError = options.onPublishError
    this.#backendForTool = options.backendForTool || (() => 'runtime')
  }

  async create(input: AgentRunInput, components: RunComponentSnapshots = {}): Promise<LoadedCheckpoint> {
    return await this.#exclusive(input.runId, async () => {
      if (await this.#store.load(input.runId)) {
        throw new AgentCoreError('CHECKPOINT_ERROR', `Run already exists: ${input.runId}`)
      }
      const ledger = createRunLedger(input, this.#clock())
      const resolvedComponents = cloneComponents(components)
      if (!resolvedComponents.toolRegistrySnapshot && this.#stepper.runtime.snapshotTools) {
        resolvedComponents.toolRegistrySnapshot = structuredClone(await this.#stepper.runtime.snapshotTools())
      }
      const checkpoint = await this.#store.commit({
        schemaVersion: RUN_SNAPSHOT_SCHEMA_VERSION,
        runId: input.runId,
        expectedRevision: null,
        committedAt: this.#clock(),
        ledger,
        events: [],
        effects: [],
        ...resolvedComponents,
      })
      await this.#publish(checkpoint, [])
      return checkpoint
    })
  }

  async advance(runId: string, signal?: AbortSignal): Promise<PersistedStepResult> {
    return await this.#exclusive(runId, async () => {
      let current = await this.#require(runId)
      const decision = decideResume(current.snapshot)
      if (decision.kind === 'replay') {
        const step = await this.#stepper.replayPreparedTool(
          current.snapshot.ledger,
          decision.effect.toolRequestId,
          decision.effect.verificationCheckId,
          signal,
        )
        current = await this.#commitStep(current, step)
        return { checkpoint: current, decision: decideResume(current.snapshot), step }
      }
      if (decision.kind === 'reconcile') {
        current = await this.#reconcile(current, decision.effect)
        return { checkpoint: current, decision: decideResume(current.snapshot) }
      }
      if (decision.kind !== 'continue') return { checkpoint: current, decision }

      const hooks = this.#hooks(() => current, (checkpoint) => { current = checkpoint })
      const step = await this.#stepper.step(current.snapshot.ledger, signal, hooks)
      current = await this.#commitStep(current, step)
      return { checkpoint: current, decision: decideResume(current.snapshot), step }
    })
  }

  async resolveApproval(runId: string, resolution: ApprovalResolution, signal?: AbortSignal): Promise<PersistedStepResult> {
    return await this.#exclusive(runId, async () => {
      let current = await this.#require(runId)
      const decision = decideResume(current.snapshot)
      if (decision.kind !== 'awaiting_approval') return { checkpoint: current, decision }

      const hooks = this.#hooks(() => current, (checkpoint) => { current = checkpoint })
      const step = await this.#stepper.resolveApproval(current.snapshot.ledger, resolution, signal, hooks)
      current = await this.#commitStep(current, step)
      return { checkpoint: current, decision: decideResume(current.snapshot), step }
    })
  }

  #hooks(current: () => LoadedCheckpoint, update: (checkpoint: LoadedCheckpoint) => void): AgentStepHooks {
    return {
      beforeToolExecution: async (execution) => {
        const checkpoint = current()
        let effect: EffectRecord
        try {
          effect = await this.#preparedEffect(execution, checkpoint.snapshot.effects)
        } catch (error) {
          const at = this.#clock()
          return {
            requestId: execution.request.id,
            ok: false,
            summary: error instanceof Error ? error.message : String(error),
            startedAt: at,
            completedAt: at,
            error: toAgentError(error, 'TOOL_EXECUTION_FAILED'),
          }
        }
        const committed = await this.#store.commit({
          schemaVersion: RUN_SNAPSHOT_SCHEMA_VERSION,
          runId: checkpoint.snapshot.runId,
          expectedRevision: checkpoint.snapshot.revision,
          committedAt: this.#clock(),
          ledger: execution.ledger,
          events: eventsAfter(execution.events, checkpoint.snapshot.lastEventSequence),
          effects: [...checkpoint.snapshot.effects, effect],
          ...componentsFrom(checkpoint),
        })
        update(committed)
        await this.#publish(committed, eventsAfter(execution.events, checkpoint.snapshot.lastEventSequence))
      },
    }
  }

  async #preparedEffect(execution: PreparedToolExecution, existing: EffectRecord[]): Promise<EffectRecord> {
    const plan = this.#stepper.runtime.prepareEffect
      ? await this.#stepper.runtime.prepareEffect(execution.request, {
        runId: execution.ledger.runId,
        projectRoot: execution.ledger.projectRoot,
        permission: execution.permission,
      })
      : {
        backend: this.#backendForTool(execution.tool),
        inputHash: execution.request.actionDigest,
        expectedEffects: [],
      }
    const attempts = existing.filter((effect) => effect.toolRequestId === execution.request.id).map((effect) => effect.attempt)
    const at = this.#clock()
    return {
      runId: execution.ledger.runId,
      toolRequestId: execution.request.id,
      actionDigest: execution.request.actionDigest,
      attempt: Math.max(0, ...attempts) + 1,
      recovery: recoveryFor(execution.tool),
      status: 'prepared',
      backend: plan.backend,
      inputHash: plan.inputHash,
      expectedEffects: structuredClone(plan.expectedEffects),
      ...(execution.verificationCheckId ? { verificationCheckId: execution.verificationCheckId } : {}),
      preparedAt: at,
      updatedAt: at,
    }
  }

  async #reconcile(current: LoadedCheckpoint, effect: EffectRecord): Promise<LoadedCheckpoint> {
    const execution = current.snapshot.ledger.toolExecutions.find((item) => item.request.id === effect.toolRequestId)
    if (!execution || execution.result) {
      throw new AgentCoreError('CHECKPOINT_ERROR', 'Reconcile effect does not match an incomplete tool request')
    }
    if (!this.#stepper.runtime.reconcileEffect) {
      return await this.#blockReconcile(current, 'Runtime does not provide a reconciler for this effect')
    }
    let reconciled
    try {
      reconciled = await this.#stepper.runtime.reconcileEffect(
        execution.request,
        structuredClone(effect.expectedEffects),
        {
          runId: current.snapshot.runId,
          projectRoot: current.snapshot.ledger.projectRoot,
          permission: { effect: 'allow', reason: 'Read-only checkpoint reconciliation' },
        },
      )
    } catch (error) {
      return await this.#blockReconcile(current, error instanceof Error ? error.message : String(error))
    }
    if (reconciled.outcome === 'blocked') return await this.#blockReconcile(current, reconciled.summary)
    if (!reconciled.result) throw new AgentCoreError('CHECKPOINT_ERROR', 'Reconcile result is missing its ToolResult')
    if (reconciled.outcome === 'completed' && !reconciled.result.ok) {
      throw new AgentCoreError('CHECKPOINT_ERROR', 'Completed reconcile result must be successful')
    }
    if (reconciled.outcome === 'not_applied' && reconciled.result.ok) {
      throw new AgentCoreError('CHECKPOINT_ERROR', 'Not-applied reconcile result must be unsuccessful')
    }
    const step = this.#stepper.completePreparedTool(
      current.snapshot.ledger,
      effect.toolRequestId,
      reconciled.result,
      effect.verificationCheckId,
    )
    return await this.#commitStep(current, step)
  }

  async #blockReconcile(current: LoadedCheckpoint, summary: string) {
    let ledger = transitionLedger(current.snapshot.ledger, 'blocked', this.#clock())
    const phase = sequenceAgentEvent(ledger, 'phase.changed', 'Phase changed to blocked', this.#clock(), { phase: 'blocked' })
    ledger = phase.ledger
    const blocked = sequenceAgentEvent(ledger, 'run.blocked', summary, this.#clock(), { reason: 'effect_reconcile' })
    ledger = blocked.ledger
    const events = [phase.event, blocked.event]
    const committed = await this.#store.commit({
      schemaVersion: RUN_SNAPSHOT_SCHEMA_VERSION,
      runId: current.snapshot.runId,
      expectedRevision: current.snapshot.revision,
      committedAt: this.#clock(),
      ledger,
      events,
      effects: current.snapshot.effects,
      ...componentsFrom(current),
    })
    await this.#publish(committed, events)
    return committed
  }

  async #commitStep(current: LoadedCheckpoint, step: AgentStepResult) {
    const effects = current.snapshot.effects.map((effect) => settleEffect(effect, step))
    const events = eventsAfter(step.events, current.snapshot.lastEventSequence)
    const committed = await this.#store.commit({
      schemaVersion: RUN_SNAPSHOT_SCHEMA_VERSION,
      runId: current.snapshot.runId,
      expectedRevision: current.snapshot.revision,
      committedAt: this.#clock(),
      ledger: step.ledger,
      events,
      effects,
      ...componentsFrom(current),
    })
    await this.#publish(committed, events)
    return committed
  }

  async #publish(checkpoint: LoadedCheckpoint, events: AgentEvent[]) {
    if (!this.#onCommitted) return
    try {
      await this.#onCommitted(structuredClone(checkpoint), structuredClone(events))
    } catch (error) {
      if (this.#onPublishError) {
        try {
          await this.#onPublishError(error, structuredClone(checkpoint))
        } catch {
          // Publishing is outside the checkpoint transaction; reconnect can replay committed events.
        }
      }
    }
  }

  async #require(runId: string) {
    const checkpoint = await this.#store.load(runId)
    if (!checkpoint) throw new AgentCoreError('CHECKPOINT_ERROR', `Run checkpoint not found: ${runId}`)
    return checkpoint
  }

  async #exclusive<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    if (this.#activeRuns.has(runId)) {
      throw new AgentCoreError('CHECKPOINT_ERROR', `Run already has an active coordinator operation: ${runId}`)
    }
    this.#activeRuns.add(runId)
    try {
      return await operation()
    } finally {
      this.#activeRuns.delete(runId)
    }
  }
}

function settleEffect(effect: EffectRecord, step: AgentStepResult): EffectRecord {
  if (effect.status !== 'prepared' && effect.status !== 'unknown') return effect
  const execution = step.ledger.toolExecutions.find((item) => item.request.id === effect.toolRequestId)
  if (execution?.result) {
    return {
      ...effect,
      status: execution.result.ok ? 'completed' : 'failed',
      updatedAt: execution.result.completedAt,
      result: structuredClone(execution.result),
    }
  }
  return { ...effect, status: 'unknown', updatedAt: step.ledger.updatedAt }
}

function recoveryFor(tool: ToolDefinition): EffectRecovery {
  if (tool.recovery) return tool.recovery
  if (tool.risk === 'read') return 'safe_replay'
  if (tool.risk === 'project_write') return 'reconcile_then_resume'
  return 'never_auto_replay'
}

function eventsAfter(events: AgentEvent[], sequence: number) {
  return events.filter((event) => event.sequence > sequence).map((event) => structuredClone(event))
}

function componentsFrom(checkpoint: LoadedCheckpoint): RunComponentSnapshots {
  const snapshot = checkpoint.snapshot
  return cloneComponents({
    ...(snapshot.configSnapshot ? { configSnapshot: snapshot.configSnapshot } : {}),
    ...(snapshot.modelRouteSnapshot ? { modelRouteSnapshot: snapshot.modelRouteSnapshot } : {}),
    ...(snapshot.toolRegistrySnapshot ? { toolRegistrySnapshot: snapshot.toolRegistrySnapshot } : {}),
    ...(snapshot.memorySnapshot ? { memorySnapshot: snapshot.memorySnapshot } : {}),
  })
}

function cloneComponents(components: RunComponentSnapshots): RunComponentSnapshots {
  return structuredClone(components)
}
