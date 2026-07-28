import { completeLedger, evaluateCompletion } from './completion.js'
import {
  CODER_LEDGER_FALLBACK_PROMPT,
  renderCompletionRepairPrompt,
  renderInvalidEvidenceRepairPrompt,
  renderInvalidPhaseActionRepairPrompt,
} from '@electron-manager/agent-prompts'
import { AgentCoreError, toAgentError } from './errors.js'
import { assertJsonSchemaValue, parseAgentTurnAction } from './schema.js'
import {
  clearPendingAction,
  detectRepeatedFailure,
  isTerminalLedger,
  recordAcceptanceEvidence,
  recordAgentStep,
  recordApproval,
  recordChange,
  recordCompaction,
  recordContextEnvelope,
  recordDecision,
  recordDiffSnapshot,
  recordInspection,
  recordModelAttempt,
  recordToolRequest,
  recordToolResult,
  recordVerification,
  sequenceAgentEvent,
  setNextAction,
  setPendingAction,
  transitionLedger,
} from './ledger.js'
import type {
  AgentEvent,
  AgentRuntime,
  AgentTurnAction,
  ApprovalRecord,
  JsonValue,
  ModelMessage,
  ModelContextAssembler,
  ModelProvider,
  PendingAction,
  PermissionDecision,
  PermissionPolicy,
  PromptCachePolicyTemplate,
  ProposedAcceptanceEvidence,
  RunLedger,
  RunPhase,
  ToolDefinition,
  ToolRequest,
  ToolResult,
} from './protocol.js'

export type AgentStepDisposition = 'continue' | 'awaiting_approval' | 'completed' | 'blocked' | 'failed' | 'cancelled'

export interface AgentStepResult {
  ledger: RunLedger
  events: AgentEvent[]
  disposition: AgentStepDisposition
  summary: string
}

export interface AgentStepperOptions {
  provider: ModelProvider
  runtime: AgentRuntime
  permissionPolicy: PermissionPolicy
  tools: ToolDefinition[]
  contextAssembler?: ModelContextAssembler
  promptCachePolicy?: PromptCachePolicyTemplate
  clock?: () => string
}

export interface PreparedToolExecution {
  ledger: RunLedger
  events: AgentEvent[]
  request: ToolRequest
  tool: ToolDefinition
  permission: PermissionDecision
  verificationCheckId?: string
}

export interface AgentStepHooks {
  beforeToolExecution?(execution: PreparedToolExecution): Promise<ToolResult | void>
}

export interface ApprovalResolution {
  decision: 'approved' | 'denied'
  decidedAt: string
  reason?: string
}

export class AgentStepper {
  readonly provider: ModelProvider
  readonly runtime: AgentRuntime
  readonly permissionPolicy: PermissionPolicy
  readonly tools: ToolDefinition[]
  readonly #toolsByName: Map<string, ToolDefinition>
  readonly #contextAssembler?: ModelContextAssembler
  readonly #promptCachePolicy?: PromptCachePolicyTemplate
  readonly #clock: () => string

  constructor(options: AgentStepperOptions) {
    this.provider = options.provider
    this.runtime = options.runtime
    this.permissionPolicy = options.permissionPolicy
    this.tools = options.tools.map((tool) => structuredClone(tool))
    this.#toolsByName = new Map(this.tools.map((tool) => [tool.name, tool]))
    this.#contextAssembler = options.contextAssembler
    this.#promptCachePolicy = options.promptCachePolicy ? structuredClone(options.promptCachePolicy) : undefined
    if (this.#toolsByName.size !== this.tools.length) throw new AgentCoreError('INVALID_INPUT', 'Tool names must be unique')
    this.#clock = options.clock || (() => new Date().toISOString())
  }

  async runUntilPause(initialLedger: RunLedger, signal?: AbortSignal, hooks?: AgentStepHooks): Promise<AgentStepResult> {
    let ledger = initialLedger
    const events: AgentEvent[] = []
    let summary = 'Run is ready'
    while (!isTerminalLedger(ledger) && ledger.phase !== 'awaiting_approval') {
      const result = await this.step(ledger, signal, hooks)
      ledger = result.ledger
      events.push(...result.events)
      summary = result.summary
      if (result.disposition !== 'continue') return { ledger, events, disposition: result.disposition, summary }
    }
    return {
      ledger,
      events,
      disposition: dispositionForLedger(ledger),
      summary: ledger.pendingAction?.summary || summary,
    }
  }

  async step(initialLedger: RunLedger, signal?: AbortSignal, hooks?: AgentStepHooks): Promise<AgentStepResult> {
    const state = new StepState(initialLedger)
    let selectedAction: AgentTurnAction | undefined
    try {
      if (signal?.aborted) throw new AgentCoreError('CANCELLED', 'Agent run was cancelled')
      if (isTerminalLedger(state.ledger)) {
        return state.result(dispositionForLedger(state.ledger), `Run is already ${state.ledger.status}`)
      }
      if (state.ledger.phase === 'awaiting_approval') {
        return state.result('awaiting_approval', state.ledger.pendingAction?.summary || 'Approval is required')
      }
      this.#assertDuration(state.ledger)
      this.#bootstrap(state)

      state.ledger = recordAgentStep(state.ledger, this.#clock())
      state.event('model.started', 'Model turn started', this.#clock())
      selectedAction = await this.#requestAction(state, signal)
      state.event('model.completed', `Model selected ${selectedAction.kind}`, this.#clock(), { action: selectedAction.kind })
      return await this.#applyAction(state, selectedAction, signal, hooks)
    } catch (error) {
      if (error instanceof AgentCoreError && error.code === 'CHECKPOINT_ERROR') throw error
      if (selectedAction && error instanceof AgentCoreError && error.code === 'INVALID_TRANSITION') {
        const summary = renderInvalidPhaseActionRepairPrompt({
          actionKind: selectedAction.kind,
          phase: state.ledger.phase,
          workLevel: state.ledger.workLevel,
          reason: error.message,
        })
        state.ledger = setNextAction(state.ledger, summary, this.#clock())
        state.event('model.rejected', summary, this.#clock(), {
          action: selectedAction.kind,
          errorCode: error.code,
        })
        return state.result('continue', summary)
      }
      const serialized = toAgentError(error, 'INTERNAL_ERROR')
      if (serialized.code === 'CANCELLED') {
        this.#terminalTransition(state, 'cancelled', 'run.cancelled', serialized.message)
        return state.result('cancelled', serialized.message)
      }
      this.#terminalTransition(state, 'failed', 'run.failed', serialized.message, {
        errorCode: serialized.code,
        retryable: serialized.retryable,
      })
      return state.result('failed', serialized.message)
    }
  }

  async resolveApproval(initialLedger: RunLedger, resolution: ApprovalResolution, signal?: AbortSignal, hooks?: AgentStepHooks): Promise<AgentStepResult> {
    const state = new StepState(initialLedger)
    try {
      const pending = state.ledger.pendingAction
      if (state.ledger.phase !== 'awaiting_approval' || !pending?.actionDigest || !pending.approvalScope) {
        throw new AgentCoreError('INVALID_TRANSITION', 'Run has no resolvable approval action')
      }
      const approval: ApprovalRecord = {
        actionDigest: pending.actionDigest,
        scope: pending.approvalScope,
        decision: resolution.decision,
        decidedAt: resolution.decidedAt,
        ...(resolution.reason ? { reason: resolution.reason } : {}),
      }
      state.ledger = recordApproval(state.ledger, approval)
      state.ledger = clearPendingAction(state.ledger, resolution.decidedAt)
      state.event('approval.completed', `Approval ${resolution.decision}`, resolution.decidedAt, {
        decision: resolution.decision,
        actionDigest: approval.actionDigest,
      })

      if (pending.approvalScope === 'plan') {
        this.#phase(state, resolution.decision === 'approved' ? 'acting' : 'planning')
        return state.result('continue', resolution.decision === 'approved' ? 'Plan approved' : 'Plan denied')
      }

      const execution = state.ledger.toolExecutions.find((item) => item.request.id === pending.toolRequestId)
      if (!execution || execution.result) throw new AgentCoreError('INVALID_INPUT', 'Pending tool request is missing or already completed')
      if (execution.request.actionDigest !== pending.actionDigest) {
        throw new AgentCoreError('ACTION_DIGEST_MISMATCH', 'Pending approval no longer matches the recorded tool request')
      }
      this.#phase(state, pending.resumePhase || 'acting')
      if (resolution.decision === 'denied') {
        const result = deniedToolResult(execution.request, resolution.decidedAt, resolution.reason || 'User denied the action')
        return this.#completeTool(state, execution.request, result, pending.verificationCheckId)
      }
      return await this.#executeRecordedTool(
        state,
        execution.request,
        { effect: 'allow', reason: resolution.reason || 'User approved the exact action' },
        pending.verificationCheckId,
        signal,
        hooks,
      )
    } catch (error) {
      if (error instanceof AgentCoreError && error.code === 'CHECKPOINT_ERROR') throw error
      const serialized = toAgentError(error, 'INTERNAL_ERROR')
      this.#terminalTransition(state, serialized.code === 'CANCELLED' ? 'cancelled' : 'failed', serialized.code === 'CANCELLED' ? 'run.cancelled' : 'run.failed', serialized.message)
      return state.result(serialized.code === 'CANCELLED' ? 'cancelled' : 'failed', serialized.message)
    }
  }

  async replayPreparedTool(
    initialLedger: RunLedger,
    toolRequestId: string,
    verificationCheckId?: string,
    signal?: AbortSignal,
  ): Promise<AgentStepResult> {
    const state = new StepState(initialLedger)
    try {
      const execution = state.ledger.toolExecutions.find((item) => item.request.id === toolRequestId)
      if (!execution || execution.result) {
        throw new AgentCoreError('CHECKPOINT_ERROR', 'Prepared tool request is missing or already completed')
      }
      const tool = this.#tool(execution.request.name)
      if (tool.risk !== 'read') {
        throw new AgentCoreError('CHECKPOINT_ERROR', 'Only read tools can be replayed without reconciliation')
      }
      return await this.#executeRecordedTool(
        state,
        execution.request,
        { effect: 'allow', reason: 'Checkpoint recovery declared this read safe to replay' },
        verificationCheckId,
        signal,
      )
    } catch (error) {
      if (error instanceof AgentCoreError && error.code === 'CHECKPOINT_ERROR') throw error
      const serialized = toAgentError(error, 'CHECKPOINT_ERROR')
      this.#terminalTransition(
        state,
        serialized.code === 'CANCELLED' ? 'cancelled' : 'failed',
        serialized.code === 'CANCELLED' ? 'run.cancelled' : 'run.failed',
        serialized.message,
      )
      return state.result(serialized.code === 'CANCELLED' ? 'cancelled' : 'failed', serialized.message)
    }
  }

  completePreparedTool(
    initialLedger: RunLedger,
    toolRequestId: string,
    result: ToolResult,
    verificationCheckId?: string,
  ): AgentStepResult {
    const state = new StepState(initialLedger)
    const execution = state.ledger.toolExecutions.find((item) => item.request.id === toolRequestId)
    if (!execution || execution.result) {
      throw new AgentCoreError('CHECKPOINT_ERROR', 'Prepared tool request is missing or already completed')
    }
    if (result.requestId !== toolRequestId) {
      throw new AgentCoreError('CHECKPOINT_ERROR', 'Reconciled result does not match the prepared tool request')
    }
    return this.#completeTool(state, execution.request, result, verificationCheckId)
  }

  #bootstrap(state: StepState) {
    if (state.ledger.phase !== 'created') return
    state.event('run.started', 'Run started', this.#clock())
    this.#phase(state, 'loading_context')
    this.#phase(state, 'inspecting')
  }

  async #requestAction(state: StepState, signal?: AbortSignal): Promise<AgentTurnAction> {
    let action: AgentTurnAction | undefined
    let completed = false
    const turnId = `${state.ledger.runId}:step:${state.ledger.stepCount}`
    const context = this.#contextAssembler
      ? await this.#contextAssembler.assemble({
        runId: state.ledger.runId,
        ledger: structuredClone(state.ledger),
        tools: this.tools.map((tool) => structuredClone(tool)),
      })
      : {
        revision: `${turnId}:default-context`,
        messages: projectLedgerMessages(state.ledger),
      }
    if (!context.revision.trim()) throw new AgentCoreError('INVALID_INPUT', 'Context revision is required')
    if (context.compaction) {
      if (context.snapshot?.compactionRevision !== context.compaction.revision) {
        throw new AgentCoreError('INVALID_INPUT', 'Context snapshot does not reference its compaction record')
      }
      state.ledger = recordCompaction(state.ledger, context.compaction)
      state.event('context.compacted', 'Session context compacted', context.compaction.createdAt, {
        revision: context.compaction.revision,
        strategy: context.compaction.strategy,
        trigger: context.compaction.trigger,
        beforeTokens: context.compaction.beforeTokens,
        afterTokens: context.compaction.afterTokens,
        replacedFragments: context.compaction.replacedFragmentIds.length,
      })
    }
    if (context.snapshot) {
      if (context.snapshot.revision !== context.revision) {
        throw new AgentCoreError('INVALID_INPUT', 'Context snapshot revision does not match assembled messages')
      }
      const assembledAt = this.#clock()
      state.ledger = recordContextEnvelope(state.ledger, { ...structuredClone(context.snapshot), assembledAt })
      state.event('context.assembled', 'Model context assembled', assembledAt, {
        revision: context.snapshot.revision,
        stablePrefixRevision: context.snapshot.stablePrefixRevision,
        estimatedInputTokens: context.snapshot.estimatedInputTokens,
        droppedFragments: context.snapshot.droppedFragments,
        ...(context.snapshot.localArtifactCacheHit !== undefined ? { localArtifactCacheHit: context.snapshot.localArtifactCacheHit } : {}),
      })
    }
    if (this.#promptCachePolicy && this.#promptCachePolicy.mode !== 'none' && !context.snapshot) {
      throw new AgentCoreError('INVALID_INPUT', 'Prompt caching requires an assembled context snapshot')
    }
    const request = {
      runId: state.ledger.runId,
      turnId,
      contextRevision: context.revision,
      messages: structuredClone(context.messages),
      tools: this.tools.map((tool) => structuredClone(tool)),
      maxOutputTokens: Math.min(state.ledger.limits.maxOutputTokens, this.provider.profile.maxOutputTokens),
      ...(this.#promptCachePolicy && context.snapshot ? {
        promptCache: {
          ...structuredClone(this.#promptCachePolicy),
          stablePrefixRevision: context.snapshot.stablePrefixRevision,
        },
      } : {}),
    }
    for await (const event of this.provider.stream(request, signal)) {
      if (event.type === 'action') {
        if (action) throw new AgentCoreError('MODEL_ERROR', 'Model returned more than one action in a single turn')
        action = parseAgentTurnAction(event.action)
      } else if (event.type === 'model_attempt') {
        state.ledger = recordModelAttempt(state.ledger, event.attempt)
        state.event('model.attempted', `${event.attempt.profileId} ${event.attempt.outcome}`, event.attempt.completedAt, {
          attemptId: event.attempt.id,
          attempt: event.attempt.attempt,
          profileId: event.attempt.profileId,
          outcome: event.attempt.outcome,
          acceptedAction: event.attempt.acceptedAction,
          inputTokens: event.attempt.inputTokens,
          outputTokens: event.attempt.outputTokens,
          ...(event.attempt.cachedInputTokens !== undefined ? { cachedInputTokens: event.attempt.cachedInputTokens } : {}),
          ...(event.attempt.cacheWriteTokens !== undefined ? { cacheWriteTokens: event.attempt.cacheWriteTokens } : {}),
          ...(event.attempt.reasoningTokens !== undefined ? { reasoningTokens: event.attempt.reasoningTokens } : {}),
          ...(event.attempt.cacheCapability ? { cacheCapability: event.attempt.cacheCapability } : {}),
          ...(event.attempt.cacheKey ? { cacheKey: event.attempt.cacheKey } : {}),
          ...(event.attempt.error ? { errorCategory: event.attempt.error.category } : {}),
        })
      } else if (event.type === 'tool_request') {
        throw new AgentCoreError('MODEL_ERROR', 'Provider returned a legacy tool_request instead of a structured action')
      } else if (event.type === 'error') {
        throw new AgentCoreError(event.error.code, event.error.message, { retryable: event.error.retryable, details: event.error.details })
      } else if (event.type === 'completed') {
        completed = true
      }
    }
    if (!completed) throw new AgentCoreError('MODEL_ERROR', 'Model stream ended without a completed event')
    if (!action) throw new AgentCoreError('MODEL_ERROR', 'Model completed without selecting an action')
    return action
  }

  async #applyAction(state: StepState, action: AgentTurnAction, signal?: AbortSignal, hooks?: AgentStepHooks): Promise<AgentStepResult> {
    if (action.kind === 'blocked') {
      this.#terminalTransition(state, 'blocked', 'run.blocked', action.summary, { reason: action.reason })
      return state.result('blocked', action.summary)
    }
    if (action.kind === 'plan') return this.#applyPlan(state, action)
    if (action.kind === 'finish') return this.#applyFinish(state, action)
    if (action.kind === 'inspect') {
      if (state.ledger.phase !== 'inspecting') throw new AgentCoreError('INVALID_TRANSITION', 'Inspect actions are only valid during inspection')
      const tool = this.#tool(action.request.name)
      if (tool.risk !== 'read') throw new AgentCoreError('PERMISSION_DENIED', 'Inspect actions can only use read tools')
      return await this.#prepareTool(state, action.request, undefined, signal, hooks)
    }
    if (action.kind === 'verify') {
      const check = state.ledger.verificationPlan.checks.find((item) => item.id === action.checkId)
      if (!check) {
        throw new AgentCoreError('INVALID_INPUT', `Unknown verification check: ${action.checkId}`)
      }
      assertVerificationRequest(check.command, action.request)
      if (state.ledger.phase === 'acting' || state.ledger.phase === 'repairing') this.#phase(state, 'verifying')
      else if (state.ledger.phase !== 'verifying') throw new AgentCoreError('INVALID_TRANSITION', 'Verification is not valid in the current phase')
      return await this.#prepareTool(state, action.request, action.checkId, signal, hooks)
    }

    if (state.ledger.phase === 'inspecting') {
      if (state.ledger.workLevel !== 'light') throw new AgentCoreError('INVALID_TRANSITION', `${state.ledger.workLevel} runs must plan before tool actions`)
      this.#phase(state, 'acting')
    } else if (state.ledger.phase === 'verifying') {
      if (this.#tool(action.request.name).risk !== 'read') {
        throw new AgentCoreError('INVALID_TRANSITION', 'Only read tools are allowed while final verification is being assembled')
      }
    } else if (state.ledger.phase !== 'acting' && state.ledger.phase !== 'repairing') {
      throw new AgentCoreError('INVALID_TRANSITION', 'Tool action is not valid in the current phase')
    }
    return await this.#prepareTool(state, action.request, undefined, signal, hooks)
  }

  #applyPlan(state: StepState, action: Extract<AgentTurnAction, { kind: 'plan' }>): AgentStepResult {
    if (state.ledger.phase === 'inspecting') this.#phase(state, 'planning')
    else if (!['planning', 'acting', 'repairing'].includes(state.ledger.phase)) throw new AgentCoreError('INVALID_TRANSITION', 'Plan action is not valid in the current phase')
    state.ledger = recordDecision(state.ledger, {
      id: action.id,
      summary: action.summary,
      rationale: action.rationale,
      at: this.#clock(),
    })
    if (state.ledger.workLevel !== 'deep') {
      if (state.ledger.phase !== 'acting') this.#phase(state, 'acting')
      return state.result('continue', action.summary)
    }
    const at = this.#clock()
    state.ledger = setPendingAction(state.ledger, {
      id: `plan-approval:${action.id}`,
      kind: 'plan_approval',
      summary: `Approve plan: ${action.summary}`,
      createdAt: at,
      actionDigest: action.actionDigest,
      approvalScope: 'plan',
      resumePhase: 'planning',
    }, at)
    this.#phase(state, 'awaiting_approval')
    state.event('approval.requested', state.ledger.pendingAction!.summary, this.#clock(), { actionDigest: action.actionDigest, scope: 'plan' })
    return state.result('awaiting_approval', state.ledger.pendingAction!.summary)
  }

  async #prepareTool(
    state: StepState,
    request: ToolRequest,
    verificationCheckId: string | undefined,
    signal?: AbortSignal,
    hooks?: AgentStepHooks,
  ): Promise<AgentStepResult> {
    const normalizedRequest = { ...request, input: structuredClone(request.input), requestedAt: this.#clock() }
    const tool = this.#tool(normalizedRequest.name)
    assertJsonSchemaValue(normalizedRequest.input, tool.inputSchema, `${normalizedRequest.name}.input`)
    const permission = await this.permissionPolicy.decide(structuredClone(normalizedRequest), structuredClone(tool), structuredClone(state.ledger))
    state.ledger = recordToolRequest(state.ledger, normalizedRequest)
    state.event('tool.requested', `Requested ${normalizedRequest.name}`, normalizedRequest.requestedAt, {
      requestId: normalizedRequest.id,
      tool: normalizedRequest.name,
      risk: tool.riskCategory || tool.risk,
      ...(tool.baseRiskLevel ? { riskLevel: tool.baseRiskLevel } : {}),
      permission: permission.effect,
    })
    if (permission.effect === 'ask') {
      const at = this.#clock()
      const pending: PendingAction = {
        id: `tool-approval:${normalizedRequest.id}`,
        kind: 'tool_approval',
        summary: permission.reason,
        createdAt: at,
        actionDigest: normalizedRequest.actionDigest,
        toolRequestId: normalizedRequest.id,
        approvalScope: 'tool',
        resumePhase: state.ledger.phase,
        ...(verificationCheckId ? { verificationCheckId } : {}),
      }
      state.ledger = setPendingAction(state.ledger, pending, at)
      this.#phase(state, 'awaiting_approval')
      state.event('approval.requested', permission.reason, this.#clock(), { requestId: normalizedRequest.id, actionDigest: normalizedRequest.actionDigest, scope: 'tool' })
      return state.result('awaiting_approval', permission.reason)
    }
    if (permission.effect === 'deny') {
      return this.#completeTool(state, normalizedRequest, deniedToolResult(normalizedRequest, this.#clock(), permission.reason), verificationCheckId)
    }
    return await this.#executeRecordedTool(state, normalizedRequest, permission, verificationCheckId, signal, hooks)
  }

  async #executeRecordedTool(
    state: StepState,
    request: ToolRequest,
    permission: PermissionDecision,
    verificationCheckId: string | undefined,
    signal?: AbortSignal,
    hooks?: AgentStepHooks,
  ): Promise<AgentStepResult> {
    if (signal?.aborted) throw new AgentCoreError('CANCELLED', 'Agent run was cancelled')
    if (hooks?.beforeToolExecution) {
      const intercepted = await hooks.beforeToolExecution({
        ledger: structuredClone(state.ledger),
        events: structuredClone(state.events),
        request: structuredClone(request),
        tool: structuredClone(this.#tool(request.name)),
        permission: structuredClone(permission),
        ...(verificationCheckId ? { verificationCheckId } : {}),
      })
      if (intercepted) return this.#completeTool(state, request, intercepted, verificationCheckId)
    }
    let result: ToolResult
    try {
      result = await this.runtime.execute(request, {
        runId: state.ledger.runId,
        projectRoot: state.ledger.projectRoot,
        permission,
      }, signal)
    } catch (error) {
      if (signal?.aborted) throw new AgentCoreError('CANCELLED', 'Agent run was cancelled', { cause: signal.reason })
      const at = this.#clock()
      result = {
        requestId: request.id,
        ok: false,
        summary: error instanceof Error ? error.message : String(error),
        startedAt: at,
        completedAt: at,
        error: toAgentError(error, 'TOOL_EXECUTION_FAILED'),
      }
    }
    return this.#completeTool(state, request, result, verificationCheckId)
  }

  #completeTool(
    state: StepState,
    request: ToolRequest,
    result: ToolResult,
    verificationCheckId?: string,
  ): AgentStepResult {
    state.ledger = recordToolResult(state.ledger, result)
    const inspectedPath = result.metadata?.path
    const inspectedHash = result.metadata?.contentHash
    if (result.ok && request.name === 'read_file' && typeof inspectedPath === 'string' && typeof inspectedHash === 'string') {
      state.ledger = recordInspection(state.ledger, {
        path: inspectedPath,
        hash: inspectedHash,
        reason: result.summary,
        inspectedAt: result.completedAt,
      })
    }
    state.event('tool.completed', result.summary, result.completedAt, {
      requestId: request.id,
      tool: request.name,
      ok: result.ok,
      ...(result.error ? { errorCode: result.error.code } : {}),
    })
    for (const path of result.changedPaths || []) {
      const metadata = changeMetadata(result.metadata, path)
      state.ledger = recordChange(state.ledger, {
        path,
        operation: request.name === 'create_file' ? 'create' : 'modify',
        at: result.completedAt,
        ...(typeof metadata.beforeHash === 'string' ? { beforeHash: metadata.beforeHash } : {}),
        ...(typeof metadata.afterHash === 'string' ? { afterHash: metadata.afterHash } : {}),
      })
    }
    if (result.changedPaths?.length) {
      state.event('files.changed', `${result.changedPaths.length} file(s) changed`, result.completedAt, { paths: result.changedPaths })
    }
    if (verificationCheckId) {
      state.ledger = recordVerification(state.ledger, {
        checkId: verificationCheckId,
        status: result.ok ? 'passed' : 'failed',
        summary: result.summary,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
        ...(result.outputRef ? { outputRef: result.outputRef } : {}),
      })
      state.event('verification.completed', result.summary, result.completedAt, { checkId: verificationCheckId, passed: result.ok })
    }

    const repeated = detectRepeatedFailure(state.ledger)
    if (repeated.tripped) {
      this.#terminalTransition(state, 'blocked', 'run.blocked', `Repeated failure: ${repeated.fingerprint}`, { count: repeated.count })
      return state.result('blocked', 'Repeated tool failure circuit breaker tripped')
    }
    if (!result.ok) {
      if (state.ledger.phase === 'acting' || state.ledger.phase === 'verifying') this.#phase(state, 'repairing')
      return state.result('continue', result.summary)
    }
    return state.result('continue', result.summary)
  }

  #applyFinish(state: StepState, action: Extract<AgentTurnAction, { kind: 'finish' }>): AgentStepResult {
    if (state.ledger.phase === 'inspecting') {
      if (state.ledger.workLevel !== 'light') throw new AgentCoreError('INVALID_TRANSITION', `${state.ledger.workLevel} runs must plan before finishing`)
      this.#phase(state, 'acting')
    }
    if (state.ledger.phase === 'planning') this.#phase(state, 'acting')
    if (state.ledger.phase === 'acting' || state.ledger.phase === 'repairing') this.#phase(state, 'verifying')
    if (state.ledger.phase !== 'verifying' && state.ledger.phase !== 'finalizing') {
      throw new AgentCoreError('INVALID_TRANSITION', 'Finish action is not valid in the current phase')
    }
    try {
      for (const evidence of action.acceptanceEvidence) this.#recordProposedEvidence(state, evidence)
    } catch (error) {
      if (!(error instanceof AgentCoreError) || error.code !== 'MODEL_ERROR') throw error
      const validRefs = successfulEvidenceRefs(state.ledger)
      const summary = renderInvalidEvidenceRepairPrompt(error.message, validRefs)
      state.ledger = setNextAction(state.ledger, summary, this.#clock())
      this.#phase(state, 'repairing')
      return state.result('continue', summary)
    }
    if (action.diff) {
      const execution = state.ledger.toolExecutions.find((item) => item.request.id === action.diff!.toolRequestId)
      if (!execution?.result?.ok || execution.request.name !== 'git_diff') {
        throw new AgentCoreError('MODEL_ERROR', 'Final diff must reference a successful git_diff tool result')
      }
      state.ledger = recordDiffSnapshot(state.ledger, {
        capturedAt: execution.result.completedAt,
        changedFiles: [...new Set(action.diff.changedFiles)],
        summary: action.diff.summary,
        outputRef: execution.result.outputRef || execution.request.id,
      })
    }
    if (state.ledger.phase !== 'finalizing') this.#phase(state, 'finalizing')
    const evaluation = evaluateCompletion(state.ledger)
    if (!evaluation.eligible) {
      const blockers = evaluation.blockers.map((item) => item.code).join(', ')
      state.ledger = setNextAction(state.ledger, renderCompletionRepairPrompt(evaluation.blockers), this.#clock())
      this.#phase(state, 'repairing')
      return state.result('continue', `完成门禁未通过：${blockers}`)
    }
    state.ledger = completeLedger(state.ledger, this.#clock())
    state.event('run.completed', action.summary, this.#clock())
    return state.result('completed', action.summary)
  }

  #recordProposedEvidence(state: StepState, evidence: ProposedAcceptanceEvidence) {
    if (!state.ledger.acceptanceCriteria.some((criterion) => criterion.id === evidence.criterionId)) {
      throw new AgentCoreError('MODEL_ERROR', `Unknown acceptance criterion: ${evidence.criterionId}`)
    }
    if (!evidence.refs.length || !evidence.refs.every((ref) => evidenceRefPassed(state.ledger, ref))) {
      throw new AgentCoreError('MODEL_ERROR', `Acceptance evidence must reference successful recorded work: ${evidence.criterionId}`)
    }
    state.ledger = recordAcceptanceEvidence(state.ledger, {
      criterionId: evidence.criterionId,
      summary: evidence.summary,
      passed: true,
      at: this.#clock(),
      refs: [...evidence.refs],
    })
  }

  #tool(name: string) {
    const tool = this.#toolsByName.get(name)
    if (!tool) throw new AgentCoreError('TOOL_NOT_FOUND', `Model requested unknown tool: ${name}`)
    return tool
  }

  #assertDuration(ledger: RunLedger) {
    const elapsed = Date.parse(this.#clock()) - Date.parse(ledger.startedAt)
    if (Number.isFinite(elapsed) && elapsed > ledger.limits.maxDurationMs) {
      throw new AgentCoreError('LIMIT_EXCEEDED', 'Run duration limit reached', { details: { maxDurationMs: ledger.limits.maxDurationMs } })
    }
  }

  #phase(state: StepState, phase: RunPhase) {
    if (state.ledger.phase === phase) return
    state.ledger = transitionLedger(state.ledger, phase, this.#clock())
    state.event('phase.changed', `Phase changed to ${phase}`, this.#clock(), { phase })
  }

  #terminalTransition(
    state: StepState,
    phase: Extract<RunPhase, 'blocked' | 'failed' | 'cancelled'>,
    event: Extract<AgentEvent['type'], 'run.blocked' | 'run.failed' | 'run.cancelled'>,
    summary: string,
    payload?: Record<string, JsonValue>,
  ) {
    if (!isTerminalLedger(state.ledger)) this.#phase(state, phase)
    state.event(event, summary, this.#clock(), payload)
  }
}

class StepState {
  ledger: RunLedger
  readonly events: AgentEvent[] = []

  constructor(ledger: RunLedger) {
    this.ledger = structuredClone(ledger)
  }

  event(type: AgentEvent['type'], summary: string, at: string, payload?: Record<string, JsonValue>) {
    const sequenced = sequenceAgentEvent(this.ledger, type, summary, at, payload)
    this.ledger = sequenced.ledger
    this.events.push(sequenced.event)
  }

  result(disposition: AgentStepDisposition, summary: string): AgentStepResult {
    return { ledger: this.ledger, events: [...this.events], disposition, summary }
  }
}

export function projectLedgerMessages(ledger: RunLedger): ModelMessage[] {
  const snapshot = {
    runId: ledger.runId,
    phase: ledger.phase,
    objective: ledger.objective,
    constraints: ledger.constraints,
    workLevel: ledger.workLevel,
    intent: ledger.intent,
    acceptanceCriteria: ledger.acceptanceCriteria,
    verificationPlan: ledger.verificationPlan,
    inspectedFiles: ledger.inspectedFiles,
    decisions: ledger.decisions.slice(-12),
    changes: ledger.changes,
    verifications: ledger.verifications,
    failures: ledger.failures,
    successfulEvidenceRefs: successfulEvidenceRefs(ledger),
    nextAction: ledger.nextAction,
  }
  const messages: ModelMessage[] = [
    {
      role: 'system',
      content: CODER_LEDGER_FALLBACK_PROMPT.text,
    },
    { role: 'user', content: JSON.stringify(snapshot) },
  ]
  for (const execution of ledger.toolExecutions.filter((item) => item.result).slice(-12)) {
    messages.push({
      role: 'tool',
      toolRequestId: execution.request.id,
      content: JSON.stringify({
        tool: execution.request.name,
        ok: execution.result!.ok,
        summary: execution.result!.summary,
        output: execution.result!.output,
        error: execution.result!.error,
      }),
    })
  }
  return messages
}

function evidenceRefPassed(ledger: RunLedger, ref: string) {
  const execution = ledger.toolExecutions.find((item) => item.request.id === ref)
  if (execution) return execution.result?.ok === true
  return ledger.verifications.some((verification) => verification.checkId === ref && verification.status === 'passed')
}

function successfulEvidenceRefs(ledger: RunLedger) {
  return [
    ...ledger.toolExecutions
      .filter((execution) => execution.result?.ok)
      .map((execution) => execution.request.id),
    ...ledger.verifications
      .filter((verification) => verification.status === 'passed')
      .map((verification) => verification.checkId),
  ]
}

function deniedToolResult(request: ToolRequest, at: string, reason: string): ToolResult {
  return {
    requestId: request.id,
    ok: false,
    summary: reason,
    startedAt: at,
    completedAt: at,
    error: { code: 'PERMISSION_DENIED', message: reason, retryable: false },
  }
}

function dispositionForLedger(ledger: RunLedger): AgentStepDisposition {
  if (ledger.phase === 'awaiting_approval') return 'awaiting_approval'
  if (ledger.status === 'completed') return 'completed'
  if (ledger.status === 'blocked') return 'blocked'
  if (ledger.status === 'failed') return 'failed'
  if (ledger.status === 'cancelled') return 'cancelled'
  return 'continue'
}

function assertVerificationRequest(expectedCommand: string[] | undefined, request: ToolRequest) {
  if (!expectedCommand?.length) return
  const command = request.input.command
  const args = request.input.args
  if (
    request.name !== 'exec_command'
    || typeof command !== 'string'
    || !Array.isArray(args)
    || args.some((item) => typeof item !== 'string')
    || command !== expectedCommand[0]
    || JSON.stringify(args) !== JSON.stringify(expectedCommand.slice(1))
  ) {
    throw new AgentCoreError('VERIFICATION_FAILED', 'Verification tool request does not match the required command', {
      details: { checkCommand: expectedCommand },
    })
  }
}

function changeMetadata(metadata: ToolResult['metadata'], path: string): Record<string, JsonValue> {
  if (!metadata) return {}
  const files = metadata.files
  if (Array.isArray(files)) {
    const file = files.find((item) => item && !Array.isArray(item) && typeof item === 'object' && item.path === path)
    if (file && !Array.isArray(file) && typeof file === 'object') return file
  }
  return metadata
}
