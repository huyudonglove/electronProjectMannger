import { randomUUID } from 'node:crypto'

import type { AgentEvent, LoadedCheckpoint, RunLedger } from '@electron-manager/agent-core'
import {
  applyPreparedProjectRunStart,
  applyProjectRunUpdatePlan,
  planProjectRunCompletion,
  planProjectRunSettlement,
  prepareProjectTaskRun,
} from '@electron-manager/agent-project-adapter'
import { getDashboard, type Dashboard } from '@electron-manager/project-core'

import { DesktopAgentCoordinatorError } from './errors.js'
import type {
  AdvanceProjectRunInput,
  DesktopAgentBackend,
  DesktopAgentRunner,
  DesktopRunDetail,
  DesktopRunListener,
  ResolveProjectRunApprovalInput,
  StartProjectTaskRunInput,
  StartProjectTaskRunResult,
} from './types.js'
import { toDesktopRunDetail, toDesktopRunEvent, toDesktopRunView } from './view.js'

export interface DesktopAgentCoordinatorOptions {
  managerDataRoot: string
  backend: DesktopAgentBackend
  createRunId?: () => string
  clock?: () => string
}

export class DesktopAgentCoordinator {
  readonly #managerDataRoot: string
  readonly #backend: DesktopAgentBackend
  readonly #createRunId: () => string
  readonly #clock: () => string
  readonly #listeners = new Set<DesktopRunListener>()
  readonly #active = new Map<string, {
    projectRoot: string
    runId: string
    controller: AbortController
  }>()

  constructor(options: DesktopAgentCoordinatorOptions) {
    if (!options.managerDataRoot.trim()) throw new Error('Manager data root is required')
    this.#managerDataRoot = options.managerDataRoot
    this.#backend = options.backend
    this.#createRunId = options.createRunId || (() => `run-${randomUUID()}`)
    this.#clock = options.clock || (() => new Date().toISOString())
  }

  subscribe(listener: DesktopRunListener) {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async startTask(input: StartProjectTaskRunInput): Promise<StartProjectTaskRunResult> {
    const dashboard = await getDashboard(this.#managerDataRoot, input.projectRoot)
    const prepared = prepareProjectTaskRun(dashboard, {
      runId: input.runId || this.#createRunId(),
      taskId: input.taskId,
      ...(input.intent ? { intent: input.intent } : {}),
      ...(input.verificationPlan ? { verificationPlan: input.verificationPlan } : {}),
    })
    if (!prepared.ok) {
      throw new DesktopAgentCoordinatorError('PROJECT_TASK_INVALID', 'Project task cannot start an Agent Run', prepared.issues)
    }

    const existing = await this.#load(input.projectRoot, prepared.value.runInput.runId)
    if (existing) assertRunIdentity(existing.snapshot.ledger, prepared.value.projectRoot, prepared.value.runInput.taskId, prepared.value.workLevel)
    const runner = await this.#openRunner(prepared.value.projectRoot, prepared.value.workLevel)
    try {
      await applyPreparedProjectRunStart(this.#managerDataRoot, prepared.value)
      const checkpoint = existing || await runner.createRun(prepared.value.runInput)
      const latest = await getDashboard(this.#managerDataRoot, input.projectRoot)
      const detail = toDesktopRunDetail(checkpoint, latest)
      if (existing) await this.#notify(input.projectRoot, checkpoint, [], latest)
      return { ...detail, warnings: prepared.warnings }
    } finally {
      runner.close()
    }
  }

  async advanceRun(input: AdvanceProjectRunInput): Promise<DesktopRunDetail> {
    return await this.#operate(input.projectRoot, input.runId, input.signal, async (runner, signal) =>
      input.untilPause === false
        ? await runner.advance(input.runId, signal)
        : await runner.runUntilPause(input.runId, signal))
  }

  async resolveApproval(input: ResolveProjectRunApprovalInput): Promise<DesktopRunDetail> {
    return await this.#operate(input.projectRoot, input.runId, input.signal, async (runner, signal) => {
      let result = await runner.resolveApproval(input.runId, {
        decision: input.decision,
        decidedAt: this.#clock(),
        ...(input.reason ? { reason: input.reason } : {}),
      }, signal)
      if (input.continueUntilPause && result.decision.kind === 'continue') {
        result = await runner.runUntilPause(input.runId, signal)
      }
      return result
    })
  }

  cancelActiveRun(runId: string, projectRoot?: string) {
    let cancelled = false
    for (const operation of this.#active.values()) {
      if (operation.runId !== runId || (projectRoot && operation.projectRoot !== projectRoot)) continue
      operation.controller.abort()
      cancelled = true
    }
    return cancelled
  }

  cancelAllActiveRuns() {
    let cancelled = 0
    for (const operation of this.#active.values()) {
      operation.controller.abort()
      cancelled += 1
    }
    return cancelled
  }

  async getRun(projectRoot: string, runId: string): Promise<DesktopRunDetail | null> {
    const checkpoint = await this.#load(projectRoot, runId)
    if (!checkpoint) return null
    return toDesktopRunDetail(checkpoint, await getDashboard(this.#managerDataRoot, projectRoot))
  }

  async listRuns(projectRoot: string) {
    const repository = await this.#backend.openRepository(projectRoot)
    try {
      const summaries = await repository.list()
      const dashboard = await getDashboard(this.#managerDataRoot, projectRoot)
      const views = []
      for (const summary of summaries) {
        const checkpoint = await repository.load(summary.runId)
        if (checkpoint) views.push(toDesktopRunView(checkpoint, dashboard))
      }
      return views
    } finally {
      repository.close()
    }
  }

  async readOutput(projectRoot: string, ref: string) {
    const repository = await this.#backend.openRepository(projectRoot)
    try {
      return await repository.readOutput(ref)
    } finally {
      repository.close()
    }
  }

  async #operate(
    projectRoot: string,
    runId: string,
    externalSignal: AbortSignal | undefined,
    action: (runner: DesktopAgentRunner, signal: AbortSignal) => Promise<{ checkpoint: LoadedCheckpoint }>,
  ) {
    const operationKey = activeOperationKey(projectRoot, runId)
    if (this.#active.has(operationKey)) throw new DesktopAgentCoordinatorError('RUN_OPERATION_ACTIVE', `Run already has an active operation: ${runId}`)
    const linked = linkedAbortController(externalSignal)
    const operation = { projectRoot, runId, controller: linked.controller }
    this.#active.set(operationKey, operation)
    let runner: DesktopAgentRunner | undefined
    try {
      const current = await this.#load(projectRoot, runId)
      if (!current) throw new DesktopAgentCoordinatorError('RUN_NOT_FOUND', `Agent Run does not exist: ${runId}`)
      assertRunIdentity(current.snapshot.ledger, projectRoot, current.snapshot.ledger.taskId, current.snapshot.ledger.workLevel)
      runner = await this.#openRunner(projectRoot, current.snapshot.ledger.workLevel)
      const result = await action(runner, linked.controller.signal)
      const settled = await this.#settle(projectRoot, result.checkpoint.snapshot.ledger)
      const detail = toDesktopRunDetail(result.checkpoint, settled.dashboard)
      if (settled.projectChanged) await this.#notify(projectRoot, result.checkpoint, [], settled.dashboard)
      return detail
    } finally {
      runner?.close()
      linked.dispose()
      if (this.#active.get(operationKey) === operation) this.#active.delete(operationKey)
    }
  }

  async #settle(projectRoot: string, ledger: RunLedger): Promise<{ dashboard: Dashboard; projectChanged: boolean }> {
    if (!['completed', 'blocked', 'failed', 'cancelled'].includes(ledger.status)) {
      return { dashboard: await getDashboard(this.#managerDataRoot, projectRoot), projectChanged: false }
    }
    const dashboard = await getDashboard(this.#managerDataRoot, projectRoot)
    const planned = ledger.status === 'completed'
      ? planProjectRunCompletion(dashboard, { taskId: ledger.taskId || ledger.taskShortId || '', ledger })
      : planProjectRunSettlement(dashboard, { taskId: ledger.taskId || ledger.taskShortId || '', ledger })
    if (!planned.ok) {
      throw new DesktopAgentCoordinatorError('PROJECT_SYNC_FAILED', 'Terminal Agent Run could not be synchronized to the project', planned.issues)
    }
    if (planned.value.outcome !== 'ready') return { dashboard, projectChanged: false }
    const applied = await applyProjectRunUpdatePlan(this.#managerDataRoot, projectRoot, planned.value)
    return { dashboard: applied.dashboard, projectChanged: applied.applied }
  }

  async #load(projectRoot: string, runId: string) {
    const repository = await this.#backend.openRepository(projectRoot)
    try {
      return await repository.load(runId)
    } finally {
      repository.close()
    }
  }

  async #openRunner(projectRoot: string, workLevel: RunLedger['workLevel']) {
    return await this.#backend.openRunner({
      projectRoot,
      workLevel,
      onCommitted: async (checkpoint, events) => {
        await this.#notify(projectRoot, checkpoint, events)
      },
      onPublishError: async () => {
        // Persisted checkpoints remain authoritative; the renderer can reload after reconnect.
      },
    })
  }

  async #notify(projectRoot: string, checkpoint: LoadedCheckpoint, events: AgentEvent[], dashboard?: Dashboard) {
    if (!this.#listeners.size) return
    const notification = {
      projectRoot,
      run: toDesktopRunView(checkpoint, dashboard || await getDashboard(this.#managerDataRoot, projectRoot)),
      events: events.map(toDesktopRunEvent),
    }
    for (const listener of this.#listeners) {
      try {
        await listener(structuredClone(notification))
      } catch {
        // Notifications are projections of persisted state and can be replayed by reloading the run.
      }
    }
  }
}

function activeOperationKey(projectRoot: string, runId: string) {
  return JSON.stringify([projectRoot, runId])
}

function assertRunIdentity(ledger: RunLedger, projectRoot: string, taskId: string | undefined, workLevel: RunLedger['workLevel']) {
  if (
    ledger.projectRoot !== projectRoot
    || (taskId && ledger.taskId !== taskId)
    || ledger.workLevel !== workLevel
  ) {
    throw new DesktopAgentCoordinatorError('RUN_IDENTITY_MISMATCH', `Agent Run identity does not match the project task: ${ledger.runId}`)
  }
}

function linkedAbortController(signal?: AbortSignal) {
  const controller = new AbortController()
  if (!signal) return { controller, dispose: () => undefined }
  const abort = () => controller.abort(signal.reason)
  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })
  return {
    controller,
    dispose: () => signal.removeEventListener('abort', abort),
  }
}
