import { AgentCoreError } from './errors.js'
import { detectRepeatedFailure, transitionLedger } from './ledger.js'
import type { AgentRunResult, RunLedger, SerializedAgentError } from './protocol.js'

export interface CompletionBlocker {
  code:
    | 'RUN_TERMINAL'
    | 'PENDING_ACTION'
    | 'TOOL_IN_FLIGHT'
    | 'ACCEPTANCE_MISSING'
    | 'VERIFICATION_MISSING'
    | 'VERIFICATION_FAILED'
    | 'CHANGE_MISSING'
    | 'DIFF_MISSING'
    | 'DIFF_INCOMPLETE'
    | 'DIFF_STALE'
    | 'REPEATED_FAILURE'
  message: string
  ref?: string
}

export interface CompletionEvaluation {
  eligible: boolean
  blockers: CompletionBlocker[]
}

export function evaluateCompletion(ledger: RunLedger): CompletionEvaluation {
  const blockers: CompletionBlocker[] = []

  if (['blocked', 'failed', 'cancelled'].includes(ledger.phase)) {
    blockers.push({ code: 'RUN_TERMINAL', message: `Run is already ${ledger.phase}` })
  }
  if (ledger.pendingAction) {
    blockers.push({ code: 'PENDING_ACTION', message: ledger.pendingAction.summary, ref: ledger.pendingAction.id })
  }

  for (const execution of ledger.toolExecutions.filter((item) => !item.result)) {
    blockers.push({ code: 'TOOL_IN_FLIGHT', message: `Tool request ${execution.request.name} has not completed`, ref: execution.request.id })
  }

  for (const criterion of ledger.acceptanceCriteria.filter((item) => item.required !== false)) {
    const evidence = ledger.acceptanceEvidence.find((item) => item.criterionId === criterion.id)
    if (!evidence?.passed) {
      blockers.push({ code: 'ACCEPTANCE_MISSING', message: `Acceptance criterion is not satisfied: ${criterion.description}`, ref: criterion.id })
    }
  }

  for (const check of ledger.verificationPlan.checks.filter((item) => item.required !== false)) {
    const result = ledger.verifications.find((item) => item.checkId === check.id)
    if (!result) blockers.push({ code: 'VERIFICATION_MISSING', message: `Required verification has not run: ${check.label}`, ref: check.id })
    else if (result.status !== 'passed') blockers.push({ code: 'VERIFICATION_FAILED', message: `Required verification did not pass: ${check.label}`, ref: check.id })
  }

  if (ledger.intent === 'change') {
    if (!ledger.changes.length) blockers.push({ code: 'CHANGE_MISSING', message: 'A change run must record at least one changed file' })
    if (!ledger.diffSnapshot) blockers.push({ code: 'DIFF_MISSING', message: 'A change run must capture a final diff' })
    else {
      const latestChangeAt = ledger.changes.reduce((latest, change) => change.at > latest ? change.at : latest, '')
      if (latestChangeAt && ledger.diffSnapshot.capturedAt < latestChangeAt) {
        blockers.push({ code: 'DIFF_STALE', message: 'The final diff was captured before the latest file change' })
      }
      const diffPaths = new Set(ledger.diffSnapshot.changedFiles)
      for (const change of ledger.changes.filter((item) => !diffPaths.has(item.path))) {
        blockers.push({ code: 'DIFF_INCOMPLETE', message: `Final diff does not include changed file: ${change.path}`, ref: change.path })
      }
    }
  }

  const repeated = detectRepeatedFailure(ledger)
  if (repeated.tripped) {
    blockers.push({ code: 'REPEATED_FAILURE', message: `Repeated tool failure circuit breaker tripped after ${repeated.count} attempts`, ref: repeated.fingerprint })
  }

  return { eligible: blockers.length === 0, blockers }
}

export function completeLedger(ledger: RunLedger, at: string): RunLedger {
  if (ledger.phase !== 'finalizing') {
    throw new AgentCoreError('INVALID_TRANSITION', 'Run must be in finalizing phase before completion', {
      details: { phase: ledger.phase },
    })
  }
  const evaluation = evaluateCompletion(ledger)
  if (!evaluation.eligible) {
    throw new AgentCoreError('VERIFICATION_FAILED', 'Run completion gate rejected the result', {
      details: { blockers: evaluation.blockers.map((item) => `${item.code}:${item.ref || ''}`) },
    })
  }
  return transitionLedger(ledger, 'completed', at)
}

export function buildRunResult(
  ledger: RunLedger,
  summary: string,
  completedAt: string,
  error?: SerializedAgentError,
): AgentRunResult {
  if (!['completed', 'blocked', 'failed', 'cancelled'].includes(ledger.status)) {
    throw new AgentCoreError('INVALID_TRANSITION', 'Cannot build a result for an active run', {
      details: { status: ledger.status },
    })
  }
  return {
    runId: ledger.runId,
    status: ledger.status as AgentRunResult['status'],
    summary,
    changedFiles: ledger.changes.map((change) => ({ ...change })),
    verifications: ledger.verifications.map((verification) => ({ ...verification })),
    completedAt,
    ...(error ? { error } : {}),
  }
}
