import { AgentCoreError } from './errors.js'
import type {
  AcceptanceEvidence,
  AgentEventType,
  AgentRunInput,
  ApprovalRecord,
  ChangedFileRecord,
  CompactionRecord,
  ContextEnvelopeRecord,
  DecisionRecord,
  DiffSnapshot,
  FailureRecord,
  InspectionRecord,
  JsonValue,
  ModelAttemptRecord,
  PendingAction,
  RunLedger,
  RunPhase,
  RunStatus,
  SequencedAgentEvent,
  ToolRequest,
  ToolResult,
  VerificationResult,
} from './protocol.js'

const terminalPhases = new Set<RunPhase>(['completed', 'blocked', 'failed', 'cancelled'])

const allowedTransitions: Record<RunPhase, RunPhase[]> = {
  created: ['loading_context', 'failed', 'cancelled'],
  loading_context: ['inspecting', 'blocked', 'failed', 'cancelled'],
  inspecting: ['planning', 'acting', 'awaiting_approval', 'blocked', 'failed', 'cancelled'],
  planning: ['acting', 'awaiting_approval', 'blocked', 'failed', 'cancelled'],
  acting: ['awaiting_approval', 'verifying', 'repairing', 'blocked', 'failed', 'cancelled'],
  awaiting_approval: ['inspecting', 'planning', 'acting', 'verifying', 'repairing', 'blocked', 'failed', 'cancelled'],
  verifying: ['repairing', 'finalizing', 'blocked', 'failed', 'cancelled'],
  repairing: ['acting', 'awaiting_approval', 'verifying', 'blocked', 'failed', 'cancelled'],
  finalizing: ['completed', 'repairing', 'blocked', 'failed', 'cancelled'],
  completed: [],
  blocked: [],
  failed: [],
  cancelled: [],
}

export function createRunLedger(input: AgentRunInput, at: string): RunLedger {
  validateInput(input)
  return {
    schemaVersion: 1,
    runId: input.runId,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.taskShortId ? { taskShortId: input.taskShortId } : {}),
    projectRoot: input.projectRoot,
    objective: input.goal,
    constraints: [...input.constraints],
    workLevel: input.workLevel,
    intent: input.intent,
    acceptanceCriteria: input.acceptanceCriteria.map((criterion) => ({ ...criterion })),
    verificationPlan: { checks: input.verificationPlan.checks.map((check) => ({ ...check })) },
    limits: { ...input.limits },
    phase: 'created',
    status: 'running',
    startedAt: at,
    updatedAt: at,
    eventSequence: 0,
    stepCount: 0,
    inspectedFiles: [],
    decisions: [],
    toolExecutions: [],
    changes: [],
    acceptanceEvidence: [],
    verifications: [],
    approvals: [],
    failures: [],
    modelAttempts: [],
    contextEnvelopes: [],
    compactions: [],
    ...(input.metadata ? { metadata: { ...input.metadata } } : {}),
  }
}

export function transitionLedger(ledger: RunLedger, nextPhase: RunPhase, at: string): RunLedger {
  if (ledger.phase === nextPhase) return { ...ledger, updatedAt: at }
  if (!allowedTransitions[ledger.phase].includes(nextPhase)) {
    throw new AgentCoreError('INVALID_TRANSITION', `Cannot transition run from ${ledger.phase} to ${nextPhase}`, {
      details: { from: ledger.phase, to: nextPhase },
    })
  }
  if (ledger.phase === 'inspecting' && nextPhase === 'acting' && ledger.workLevel !== 'light') {
    throw new AgentCoreError('INVALID_TRANSITION', `${ledger.workLevel} runs must enter planning before acting`, {
      details: { workLevel: ledger.workLevel },
    })
  }
  if (nextPhase === 'awaiting_approval' && !ledger.pendingAction) {
    throw new AgentCoreError('INVALID_TRANSITION', 'A pending action is required before awaiting approval')
  }
  if (ledger.phase === 'awaiting_approval' && !terminalPhases.has(nextPhase) && ledger.pendingAction) {
    throw new AgentCoreError('INVALID_TRANSITION', 'Pending action must be resolved before leaving approval state')
  }
  if (nextPhase === 'acting' && ledger.workLevel === 'deep' && !hasApprovedPlan(ledger)) {
    throw new AgentCoreError('APPROVAL_REQUIRED', 'Deep runs require an approved plan before acting')
  }
  return {
    ...ledger,
    phase: nextPhase,
    status: statusForPhase(nextPhase),
    updatedAt: at,
  }
}

export function recordInspection(ledger: RunLedger, inspection: InspectionRecord): RunLedger {
  const inspectedFiles = ledger.inspectedFiles.filter((item) => item.path !== inspection.path)
  return update(ledger, inspection.inspectedAt, { inspectedFiles: [...inspectedFiles, { ...inspection }] })
}

export function recordDecision(ledger: RunLedger, decision: DecisionRecord): RunLedger {
  return update(ledger, decision.at, { decisions: [...ledger.decisions, { ...decision }] })
}

export function recordToolRequest(ledger: RunLedger, request: ToolRequest): RunLedger {
  if (ledger.toolExecutions.some((item) => item.request.id === request.id)) {
    throw new AgentCoreError('INVALID_INPUT', `Duplicate tool request id: ${request.id}`)
  }
  return update(ledger, request.requestedAt, {
    toolExecutions: [...ledger.toolExecutions, { request: { ...request, input: { ...request.input } } }],
  })
}

export function recordAgentStep(ledger: RunLedger, at: string): RunLedger {
  if (ledger.stepCount >= ledger.limits.maxSteps) {
    throw new AgentCoreError('LIMIT_EXCEEDED', 'Run step limit reached', {
      details: { maxSteps: ledger.limits.maxSteps },
    })
  }
  return update(ledger, at, { stepCount: ledger.stepCount + 1 })
}

export function recordModelAttempt(ledger: RunLedger, attempt: ModelAttemptRecord): RunLedger {
  if (ledger.modelAttempts.some((item) => item.id === attempt.id)) {
    throw new AgentCoreError('INVALID_INPUT', `Duplicate model attempt id: ${attempt.id}`)
  }
  return update(ledger, attempt.completedAt, {
    modelAttempts: [...ledger.modelAttempts, structuredClone(attempt)],
  })
}

export function recordContextEnvelope(ledger: RunLedger, envelope: ContextEnvelopeRecord): RunLedger {
  if (ledger.contextEnvelopes.some((item) => item.revision === envelope.revision)) return ledger
  return update(ledger, envelope.assembledAt, {
    contextEnvelopes: [...ledger.contextEnvelopes, structuredClone(envelope)],
  })
}

export function recordCompaction(ledger: RunLedger, compaction: CompactionRecord): RunLedger {
  if (ledger.compactions.some((item) => item.revision === compaction.revision)) return ledger
  if (ledger.compactions.some((item) => item.id === compaction.id)) {
    throw new AgentCoreError('INVALID_INPUT', `Duplicate compaction id: ${compaction.id}`)
  }
  return update(ledger, compaction.createdAt, {
    compactions: [...ledger.compactions, structuredClone(compaction)],
  })
}

export function recordToolResult(ledger: RunLedger, result: ToolResult): RunLedger {
  let found = false
  const toolExecutions = ledger.toolExecutions.map((execution) => {
    if (execution.request.id !== result.requestId) return execution
    if (execution.result) throw new AgentCoreError('INVALID_INPUT', `Tool request already completed: ${result.requestId}`)
    found = true
    return { ...execution, result: { ...result } }
  })
  if (!found) throw new AgentCoreError('INVALID_INPUT', `Unknown tool request: ${result.requestId}`)

  const request = toolExecutions.find((item) => item.request.id === result.requestId)?.request
  const failures = !result.ok && result.error && request
    ? [...ledger.failures, failureFrom(request, result)]
    : ledger.failures

  return update(ledger, result.completedAt, { toolExecutions, failures })
}

export function recordChange(ledger: RunLedger, change: ChangedFileRecord): RunLedger {
  const changes = ledger.changes.filter((item) => item.path !== change.path)
  return update(ledger, change.at, { changes: [...changes, { ...change }] })
}

export function recordVerification(ledger: RunLedger, verification: VerificationResult): RunLedger {
  const verifications = ledger.verifications.filter((item) => item.checkId !== verification.checkId)
  return update(ledger, verification.completedAt, { verifications: [...verifications, { ...verification }] })
}

export function recordAcceptanceEvidence(ledger: RunLedger, evidence: AcceptanceEvidence): RunLedger {
  const acceptanceEvidence = ledger.acceptanceEvidence.filter((item) => item.criterionId !== evidence.criterionId)
  return update(ledger, evidence.at, { acceptanceEvidence: [...acceptanceEvidence, { ...evidence }] })
}

export function recordApproval(ledger: RunLedger, approval: ApprovalRecord): RunLedger {
  const approvals = ledger.approvals.filter((item) => item.actionDigest !== approval.actionDigest)
  return update(ledger, approval.decidedAt, { approvals: [...approvals, { ...approval }] })
}

export function setPendingAction(ledger: RunLedger, action: PendingAction, at: string): RunLedger {
  return update(ledger, at, { pendingAction: { ...action } })
}

export function clearPendingAction(ledger: RunLedger, at: string): RunLedger {
  const next = { ...ledger, updatedAt: at }
  delete next.pendingAction
  return next
}

export function setNextAction(ledger: RunLedger, nextAction: string | undefined, at: string): RunLedger {
  const next = { ...ledger, updatedAt: at }
  if (nextAction) next.nextAction = nextAction
  else delete next.nextAction
  return next
}

export function recordDiffSnapshot(ledger: RunLedger, diffSnapshot: DiffSnapshot): RunLedger {
  return update(ledger, diffSnapshot.capturedAt, { diffSnapshot: { ...diffSnapshot, changedFiles: [...diffSnapshot.changedFiles] } })
}

export function sequenceAgentEvent(
  ledger: RunLedger,
  type: AgentEventType,
  summary: string,
  at: string,
  payload?: Record<string, JsonValue>,
): SequencedAgentEvent {
  const sequence = ledger.eventSequence + 1
  return {
    ledger: { ...ledger, eventSequence: sequence, updatedAt: at },
    event: {
      id: `${ledger.runId}:${sequence}`,
      runId: ledger.runId,
      sequence,
      at,
      type,
      phase: ledger.phase,
      summary,
      ...(payload ? { payload: { ...payload } } : {}),
    },
  }
}

export function detectRepeatedFailure(ledger: RunLedger, threshold = ledger.limits.maxRepeatedFailures) {
  const completed = ledger.toolExecutions.filter((item) => item.result)
  let fingerprint = ''
  let count = 0

  for (let index = completed.length - 1; index >= 0; index -= 1) {
    const execution = completed[index]
    if (!execution?.result || execution.result.ok || !execution.result.error) break
    const current = `${execution.request.name}:${execution.request.actionDigest}:${execution.result.error.code}`
    if (!fingerprint) fingerprint = current
    if (current !== fingerprint) break
    count += 1
  }

  return { fingerprint, count, tripped: count >= threshold }
}

export function isTerminalLedger(ledger: RunLedger) {
  return terminalPhases.has(ledger.phase)
}

function validateInput(input: AgentRunInput) {
  if (!input.runId.trim()) throw new AgentCoreError('INVALID_INPUT', 'runId is required')
  if (!input.projectRoot.trim()) throw new AgentCoreError('INVALID_INPUT', 'projectRoot is required')
  if (!input.goal.trim()) throw new AgentCoreError('INVALID_INPUT', 'goal is required')
  ensureUniqueIds(input.acceptanceCriteria.map((item) => item.id), 'acceptance criterion')
  ensureUniqueIds(input.verificationPlan.checks.map((item) => item.id), 'verification check')
  const limits = input.limits
  if ([limits.maxSteps, limits.maxDurationMs, limits.maxInputTokens, limits.maxOutputTokens, limits.maxRepeatedFailures]
    .some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new AgentCoreError('INVALID_INPUT', 'All run limits must be positive finite numbers')
  }
}

function ensureUniqueIds(ids: string[], label: string) {
  if (ids.some((id) => !id.trim())) throw new AgentCoreError('INVALID_INPUT', `${label} ids cannot be empty`)
  if (new Set(ids).size !== ids.length) throw new AgentCoreError('INVALID_INPUT', `${label} ids must be unique`)
}

function hasApprovedPlan(ledger: RunLedger) {
  return ledger.approvals.some((approval) => approval.scope === 'plan' && approval.decision === 'approved')
}

function statusForPhase(phase: RunPhase): RunStatus {
  if (phase === 'awaiting_approval') return 'awaiting_approval'
  if (phase === 'completed') return 'completed'
  if (phase === 'blocked') return 'blocked'
  if (phase === 'failed') return 'failed'
  if (phase === 'cancelled') return 'cancelled'
  return 'running'
}

function failureFrom(request: ToolRequest, result: ToolResult): FailureRecord {
  const error = result.error!
  return {
    fingerprint: `${request.name}:${request.actionDigest}:${error.code}`,
    toolRequestId: request.id,
    error,
    at: result.completedAt,
  }
}

function update<T extends Partial<RunLedger>>(ledger: RunLedger, at: string, patch: T): RunLedger {
  return { ...ledger, ...patch, updatedAt: at }
}
