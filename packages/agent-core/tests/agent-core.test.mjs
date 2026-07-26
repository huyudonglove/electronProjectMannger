import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AgentCoreError,
  FakeAgentRuntime,
  FakeModelProvider,
  clearPendingAction,
  completeLedger,
  createRunLedger,
  detectRepeatedFailure,
  evaluateCompletion,
  recordAcceptanceEvidence,
  recordChange,
  recordDiffSnapshot,
  recordApproval,
  recordToolRequest,
  recordToolResult,
  recordVerification,
  setPendingAction,
  sequenceAgentEvent,
  toAgentError,
  transitionLedger,
} from '../dist/index.js'

const at = (minute) => `2026-07-26T13:${String(minute).padStart(2, '0')}:00.000Z`

function input(overrides = {}) {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    taskShortId: 'T002',
    projectRoot: '/workspace/project',
    goal: 'Change one file safely',
    acceptanceCriteria: [{ id: 'acceptance-1', description: 'Requested behavior is implemented' }],
    constraints: ['Preserve unrelated changes'],
    workLevel: 'light',
    intent: 'change',
    verificationPlan: { checks: [{ id: 'unit', label: 'Unit tests' }] },
    limits: {
      maxSteps: 20,
      maxDurationMs: 60_000,
      maxInputTokens: 20_000,
      maxOutputTokens: 4_000,
      maxRepeatedFailures: 3,
    },
    ...overrides,
  }
}

function request(id, actionDigest = 'digest-1') {
  return {
    id,
    name: 'apply_patch',
    input: { patch: 'example' },
    requestedAt: at(Number(id.replace(/\D/g, '')) + 2),
    actionDigest,
  }
}

function failedResult(requestId, minute, code = 'PATCH_CONFLICT') {
  return {
    requestId,
    ok: false,
    summary: 'Patch did not apply',
    startedAt: at(minute - 1),
    completedAt: at(minute),
    error: { code, message: 'Patch context changed', retryable: true },
  }
}

test('light runs can skip planning while invalid phase transitions are rejected', () => {
  let ledger = createRunLedger(input(), at(0))
  ledger = transitionLedger(ledger, 'loading_context', at(1))
  ledger = transitionLedger(ledger, 'inspecting', at(2))
  ledger = transitionLedger(ledger, 'acting', at(3))
  assert.equal(ledger.phase, 'acting')

  assert.throws(
    () => transitionLedger(ledger, 'completed', at(4)),
    (error) => error instanceof AgentCoreError && error.code === 'INVALID_TRANSITION',
  )
})

test('standard runs require planning and deep runs require explicit plan approval', () => {
  let standard = createRunLedger(input({ workLevel: 'standard' }), at(0))
  standard = transitionLedger(standard, 'loading_context', at(1))
  standard = transitionLedger(standard, 'inspecting', at(2))
  assert.throws(() => transitionLedger(standard, 'acting', at(3)), /must enter planning/)
  standard = transitionLedger(standard, 'planning', at(3))
  assert.equal(transitionLedger(standard, 'acting', at(4)).phase, 'acting')

  let deep = createRunLedger(input({ workLevel: 'deep' }), at(0))
  deep = transitionLedger(deep, 'loading_context', at(1))
  deep = transitionLedger(deep, 'inspecting', at(2))
  deep = transitionLedger(deep, 'planning', at(3))
  assert.throws(
    () => transitionLedger(deep, 'acting', at(4)),
    (error) => error instanceof AgentCoreError && error.code === 'APPROVAL_REQUIRED',
  )
  deep = setPendingAction(deep, {
    id: 'plan-approval', kind: 'tool_approval', summary: 'Approve implementation plan', createdAt: at(4), actionDigest: 'plan-v1',
  }, at(4))
  deep = transitionLedger(deep, 'awaiting_approval', at(5))
  assert.throws(() => transitionLedger(deep, 'acting', at(6)), /must be resolved/)
  deep = recordApproval(deep, { actionDigest: 'plan-v1', scope: 'plan', decision: 'denied', decidedAt: at(6) })
  deep = clearPendingAction(deep, at(6))
  assert.throws(
    () => transitionLedger(deep, 'acting', at(7)),
    (error) => error instanceof AgentCoreError && error.code === 'APPROVAL_REQUIRED',
  )
  deep = recordApproval(deep, { actionDigest: 'plan-v1', scope: 'plan', decision: 'approved', decidedAt: at(7) })
  deep = transitionLedger(deep, 'acting', at(7))
  assert.equal(deep.phase, 'acting')
})

test('completion gate requires evidence, verification and a fresh diff', () => {
  let ledger = createRunLedger(input(), at(0))
  let evaluation = evaluateCompletion(ledger)
  assert.deepEqual(
    new Set(evaluation.blockers.map((item) => item.code)),
    new Set(['ACCEPTANCE_MISSING', 'VERIFICATION_MISSING', 'CHANGE_MISSING', 'DIFF_MISSING']),
  )

  ledger = recordChange(ledger, { path: 'src/example.ts', operation: 'modify', at: at(4) })
  ledger = recordDiffSnapshot(ledger, { capturedAt: at(3), changedFiles: ['src/example.ts'], summary: 'stale diff' })
  ledger = recordAcceptanceEvidence(ledger, { criterionId: 'acceptance-1', summary: 'Behavior covered', passed: true, at: at(5) })
  ledger = recordVerification(ledger, {
    checkId: 'unit',
    status: 'passed',
    summary: '1 test passed',
    startedAt: at(5),
    completedAt: at(6),
    exitCode: 0,
  })
  evaluation = evaluateCompletion(ledger)
  assert.equal(evaluation.blockers[0]?.code, 'DIFF_STALE')

  ledger = recordDiffSnapshot(ledger, { capturedAt: at(7), changedFiles: ['src/example.ts'], summary: 'fresh diff' })
  assert.equal(evaluateCompletion(ledger).eligible, true)
})

test('a run only completes from finalizing after the deterministic gate passes', () => {
  let ledger = createRunLedger(input(), at(0))
  ledger = recordChange(ledger, { path: 'src/example.ts', operation: 'modify', at: at(4) })
  ledger = recordDiffSnapshot(ledger, { capturedAt: at(5), changedFiles: ['src/example.ts'], summary: 'one file changed' })
  ledger = recordAcceptanceEvidence(ledger, { criterionId: 'acceptance-1', summary: 'Implemented', passed: true, at: at(6) })
  ledger = recordVerification(ledger, {
    checkId: 'unit', status: 'passed', summary: 'passed', startedAt: at(6), completedAt: at(7), exitCode: 0,
  })
  ledger = transitionLedger(ledger, 'loading_context', at(1))
  ledger = transitionLedger(ledger, 'inspecting', at(2))
  ledger = transitionLedger(ledger, 'acting', at(3))
  ledger = transitionLedger(ledger, 'verifying', at(8))
  ledger = transitionLedger(ledger, 'finalizing', at(9))
  ledger = completeLedger(ledger, at(10))
  assert.equal(ledger.status, 'completed')
})

test('pending approval blocks completion and survives until explicitly cleared', () => {
  let ledger = createRunLedger(input({ intent: 'analysis', acceptanceCriteria: [], verificationPlan: { checks: [] } }), at(0))
  ledger = setPendingAction(ledger, {
    id: 'approval-1',
    kind: 'tool_approval',
    summary: 'Approve dependency installation',
    createdAt: at(1),
    actionDigest: 'install-digest',
  }, at(1))
  assert.equal(evaluateCompletion(ledger).blockers[0]?.code, 'PENDING_ACTION')
  ledger = clearPendingAction(ledger, at(2))
  assert.equal(evaluateCompletion(ledger).eligible, true)
})

test('repeated identical tool failures trip a circuit breaker', () => {
  let ledger = createRunLedger(input({ intent: 'analysis', acceptanceCriteria: [], verificationPlan: { checks: [] } }), at(0))
  for (let index = 1; index <= 3; index += 1) {
    const toolRequest = request(`tool-${index}`)
    ledger = recordToolRequest(ledger, toolRequest)
    ledger = recordToolResult(ledger, failedResult(toolRequest.id, index + 5))
  }
  assert.deepEqual(detectRepeatedFailure(ledger), {
    fingerprint: 'apply_patch:digest-1:PATCH_CONFLICT',
    count: 3,
    tripped: true,
  })
  assert.equal(evaluateCompletion(ledger).blockers[0]?.code, 'REPEATED_FAILURE')
})

test('errors, fake model and fake runtime keep adapter behavior testable', async () => {
  const serialized = toAgentError(new AgentCoreError('PATCH_CONFLICT', 'Patch conflict', { retryable: true }))
  assert.deepEqual(serialized, { code: 'PATCH_CONFLICT', message: 'Patch conflict', retryable: true })

  const model = new FakeModelProvider([[
    { type: 'text_delta', text: 'Inspecting' },
    { type: 'completed', finishReason: 'stop' },
  ]])
  const events = []
  for await (const event of model.stream({ runId: 'run-1', messages: [], tools: [], maxOutputTokens: 100 })) events.push(event)
  assert.equal(events.length, 2)
  assert.equal(model.requests.length, 1)

  const runtime = new FakeAgentRuntime().on('read_file', (toolRequest) => ({
    requestId: toolRequest.id,
    ok: true,
    summary: 'Read 3 lines',
    output: 'one\ntwo\nthree',
    startedAt: at(1),
    completedAt: at(2),
  }))
  const result = await runtime.execute(
    { id: 'read-1', name: 'read_file', input: { path: 'src/a.ts' }, requestedAt: at(0), actionDigest: 'read-digest' },
    { runId: 'run-1', projectRoot: '/workspace/project', permission: { effect: 'allow', reason: 'read-only' } },
  )
  assert.equal(result.ok, true)
  assert.equal(runtime.calls.length, 1)
})

test('event sequencing is monotonic and independent from model history', () => {
  let ledger = createRunLedger(input(), at(0))
  const first = sequenceAgentEvent(ledger, 'run.started', 'Run started', at(1))
  ledger = first.ledger
  const second = sequenceAgentEvent(ledger, 'phase.changed', 'Loading context', at(2), { phase: 'loading_context' })
  assert.equal(first.event.id, 'run-1:1')
  assert.equal(second.event.sequence, 2)
  assert.equal(second.ledger.eventSequence, 2)
})
