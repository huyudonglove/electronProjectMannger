import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AgentCoreError,
  AgentStepper,
  FakeAgentRuntime,
  FakeModelProvider,
  FakePermissionPolicy,
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
    verificationPlan: { checks: [{ id: 'unit', label: 'Unit tests', command: ['pnpm', 'test'] }] },
    limits: {
      maxSteps: 20,
      maxDurationMs: 3_600_000,
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

const tools = [
  { name: 'read_file', description: 'Read file', risk: 'read', inputSchema: { type: 'object' } },
  { name: 'apply_patch', description: 'Patch file', risk: 'project_write', inputSchema: { type: 'object' } },
  { name: 'exec_command', description: 'Run verification', risk: 'process', inputSchema: { type: 'object' } },
  { name: 'git_diff', description: 'Read diff', risk: 'read', inputSchema: { type: 'object' } },
]

function toolRequest(id, name, input = {}, actionDigest = `${id}-digest`, minute = 3) {
  return { id, name, input, requestedAt: at(minute), actionDigest }
}

function modelTurn(action) {
  return [
    { type: 'action', action },
    { type: 'completed', finishReason: action.kind === 'tool' || action.kind === 'inspect' || action.kind === 'verify' ? 'tool_calls' : 'stop' },
  ]
}

function advancingClock(start = 1) {
  let minute = start
  return () => at(minute++)
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

test('AgentStepper completes a light change from ledger-backed tool and verification evidence', async () => {
  const provider = new FakeModelProvider([
    modelTurn({ kind: 'inspect', request: toolRequest('read-1', 'read_file', { path: 'src/example.ts' }, 'read-digest', 3) }),
    modelTurn({ kind: 'tool', request: toolRequest('patch-1', 'apply_patch', { operations: [] }, 'patch-digest', 6) }),
    modelTurn({ kind: 'verify', checkId: 'unit', request: toolRequest('verify-1', 'exec_command', { command: 'pnpm', args: ['test'] }, 'verify-digest', 9) }),
    modelTurn({ kind: 'tool', request: toolRequest('diff-1', 'git_diff', {}, 'diff-digest', 12) }),
    modelTurn({
      kind: 'finish',
      summary: 'Implemented and verified',
      acceptanceEvidence: [{ criterionId: 'acceptance-1', summary: 'Patch and tests passed', refs: ['patch-1', 'unit'] }],
      diff: { toolRequestId: 'diff-1', changedFiles: ['src/example.ts', 'src/second.ts'], summary: 'Two files changed' },
    }),
  ])
  const runtime = new FakeAgentRuntime()
    .on('read_file', (tool) => ({ requestId: tool.id, ok: true, summary: 'Read file', output: 'before', startedAt: at(3), completedAt: at(4) }))
    .on('apply_patch', (tool) => ({
      requestId: tool.id,
      ok: true,
      summary: 'Patched files',
      changedPaths: ['src/example.ts', 'src/second.ts'],
      startedAt: at(6),
      completedAt: at(7),
      metadata: { files: [
        { path: 'src/example.ts', beforeHash: 'before-a', afterHash: 'after-a' },
        { path: 'src/second.ts', beforeHash: 'before-b', afterHash: 'after-b' },
      ] },
    }))
    .on('exec_command', (tool) => ({ requestId: tool.id, ok: true, summary: 'Tests passed', exitCode: 0, startedAt: at(9), completedAt: at(10) }))
    .on('git_diff', (tool) => ({ requestId: tool.id, ok: true, summary: 'Read final diff', outputRef: 'diff-output', startedAt: at(12), completedAt: at(13) }))
  const stepper = new AgentStepper({
    provider,
    runtime,
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'fixture allow' }),
    tools,
    clock: advancingClock(1),
  })

  const result = await stepper.runUntilPause(createRunLedger(input(), at(0)))
  assert.equal(result.disposition, 'completed', result.summary)
  assert.equal(result.ledger.status, 'completed')
  assert.deepEqual(result.ledger.changes.map((change) => change.path), ['src/example.ts', 'src/second.ts'])
  assert.equal(result.ledger.changes[1]?.afterHash, 'after-b')
  assert.equal(result.ledger.verifications[0]?.status, 'passed')
  assert.equal(result.ledger.diffSnapshot?.outputRef, 'diff-output')
  assert.equal(runtime.calls.length, 4)
  assert.equal(provider.requests.length, 5)
  assert.deepEqual(result.events.map((event) => event.sequence), result.events.map((_, index) => index + 1))
  assert.match(provider.requests.at(-1).messages[1].content, /"phase":"verifying"/)
})

test('deep plan and tool approvals pause and resume without repeating side effects', async () => {
  const write = toolRequest('approved-write', 'apply_patch', { operations: [] }, 'approved-write-digest', 8)
  const provider = new FakeModelProvider([
    modelTurn({ kind: 'plan', id: 'plan-1', summary: 'Modify one file', rationale: 'Required by deep task', actionDigest: 'plan-digest' }),
    modelTurn({ kind: 'tool', request: write }),
  ])
  const runtime = new FakeAgentRuntime().on('apply_patch', (tool) => ({
    requestId: tool.id,
    ok: true,
    summary: 'Patched once',
    changedPaths: ['src/example.ts'],
    startedAt: at(9),
    completedAt: at(10),
  }))
  const policy = new FakePermissionPolicy((tool) => tool.id === write.id
    ? { effect: 'ask', reason: 'Approve exact write' }
    : { effect: 'allow', reason: 'Read only' })
  const stepper = new AgentStepper({ provider, runtime, permissionPolicy: policy, tools, clock: advancingClock(1) })
  let ledger = createRunLedger(input({ workLevel: 'deep' }), at(0))

  const planPause = await stepper.step(ledger)
  assert.equal(planPause.disposition, 'awaiting_approval', planPause.summary)
  assert.equal(planPause.ledger.pendingAction?.kind, 'plan_approval')
  ledger = (await stepper.resolveApproval(planPause.ledger, { decision: 'approved', decidedAt: at(6) })).ledger
  assert.equal(ledger.phase, 'acting')

  const toolPause = await stepper.step(ledger)
  assert.equal(toolPause.disposition, 'awaiting_approval')
  assert.equal(runtime.calls.length, 0)
  const resumed = await stepper.resolveApproval(toolPause.ledger, { decision: 'approved', decidedAt: at(9) })
  assert.equal(resumed.disposition, 'continue')
  assert.equal(resumed.ledger.toolExecutions.length, 1)
  assert.equal(resumed.ledger.toolExecutions[0].result?.ok, true)
  assert.equal(runtime.calls.length, 1)
})

test('AgentStepper enters repair after a tool failure and blocks repeated identical failures', async () => {
  const provider = new FakeModelProvider([1, 2, 3].map((index) => modelTurn({
    kind: 'tool',
    request: toolRequest(`patch-${index}`, 'apply_patch', { operations: [] }, 'same-patch-digest', index * 3),
  })))
  const runtime = new FakeAgentRuntime().on('apply_patch', (tool) => failedResult(tool.id, Number(tool.id.at(-1)) + 10))
  const stepper = new AgentStepper({
    provider,
    runtime,
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'fixture allow' }),
    tools,
    clock: advancingClock(1),
  })

  const firstFailure = await stepper.step(createRunLedger(input(), at(0)))
  assert.equal(firstFailure.disposition, 'continue')
  assert.equal(firstFailure.ledger.phase, 'repairing')
  const result = await stepper.runUntilPause(firstFailure.ledger)
  assert.equal(result.disposition, 'blocked', result.summary)
  assert.equal(result.ledger.status, 'blocked')
  assert.equal(result.ledger.failures.length, 3)
  assert.equal(runtime.calls.length, 3)
  assert.equal(result.events.at(-1).type, 'run.blocked')
})

test('model finish cannot bypass a failed required verification', async () => {
  const provider = new FakeModelProvider([
    modelTurn({ kind: 'tool', request: toolRequest('patch-1', 'apply_patch', {}, 'patch-digest', 3) }),
    modelTurn({ kind: 'verify', checkId: 'unit', request: toolRequest('verify-1', 'exec_command', { command: 'pnpm', args: ['test'] }, 'verify-digest', 6) }),
    modelTurn({ kind: 'tool', request: toolRequest('diff-1', 'git_diff', {}, 'diff-digest', 9) }),
    modelTurn({
      kind: 'finish',
      summary: 'Claimed complete',
      acceptanceEvidence: [{ criterionId: 'acceptance-1', summary: 'Patch applied', refs: ['patch-1'] }],
      diff: { toolRequestId: 'diff-1', changedFiles: ['src/example.ts'], summary: 'One file changed' },
    }),
  ])
  const runtime = new FakeAgentRuntime()
    .on('apply_patch', (tool) => ({ requestId: tool.id, ok: true, summary: 'Patched', changedPaths: ['src/example.ts'], startedAt: at(3), completedAt: at(4) }))
    .on('exec_command', (tool) => ({ requestId: tool.id, ok: false, summary: 'Tests failed', exitCode: 1, startedAt: at(6), completedAt: at(7), error: { code: 'VERIFICATION_FAILED', message: 'Tests failed', retryable: true } }))
    .on('git_diff', (tool) => ({ requestId: tool.id, ok: true, summary: 'Diff read', startedAt: at(9), completedAt: at(10) }))
  const stepper = new AgentStepper({
    provider,
    runtime,
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'fixture allow' }),
    tools,
    clock: advancingClock(1),
  })
  let ledger = createRunLedger(input(), at(0))
  for (let index = 0; index < 3; index += 1) ledger = (await stepper.step(ledger)).ledger
  const finish = await stepper.step(ledger)

  assert.equal(finish.disposition, 'continue', finish.summary)
  assert.equal(finish.ledger.phase, 'repairing')
  assert.equal(finish.ledger.status, 'running')
  assert.match(finish.summary, /VERIFICATION_FAILED/)
})

test('each model turn is projected from RunLedger instead of replaying assistant history', async () => {
  const provider = new FakeModelProvider([
    modelTurn({ kind: 'inspect', request: toolRequest('read-1', 'read_file', {}, 'read-digest', 3) }),
    modelTurn({ kind: 'blocked', summary: 'Need unsupported context', reason: 'fixture stop' }),
  ])
  const runtime = new FakeAgentRuntime().on('read_file', (tool) => ({
    requestId: tool.id,
    ok: true,
    summary: 'Read fixture',
    output: 'fixture output',
    startedAt: at(3),
    completedAt: at(4),
  }))
  const stepper = new AgentStepper({
    provider,
    runtime,
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'read' }),
    tools,
    clock: advancingClock(1),
  })
  const result = await stepper.runUntilPause(createRunLedger(input(), at(0)))

  assert.equal(result.disposition, 'blocked', result.summary)
  assert.equal(provider.requests.length, 2)
  assert.equal(provider.requests[1].messages.some((message) => message.role === 'assistant'), false)
  assert.equal(provider.requests[1].messages.some((message) => message.role === 'tool' && message.toolRequestId === 'read-1'), true)
})

test('verification actions cannot substitute a different command from the required plan', async () => {
  const provider = new FakeModelProvider([
    modelTurn({
      kind: 'verify',
      checkId: 'unit',
      request: toolRequest('fake-verification', 'read_file', { path: 'package.json' }, 'fake-digest', 3),
    }),
  ])
  const runtime = new FakeAgentRuntime().on('read_file', (tool) => ({
    requestId: tool.id,
    ok: true,
    summary: 'Read file',
    startedAt: at(3),
    completedAt: at(4),
  }))
  const stepper = new AgentStepper({
    provider,
    runtime,
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'read' }),
    tools,
    clock: advancingClock(1),
  })
  let ledger = createRunLedger(input(), at(0))
  ledger = transitionLedger(ledger, 'loading_context', at(1))
  ledger = transitionLedger(ledger, 'inspecting', at(2))
  ledger = transitionLedger(ledger, 'acting', at(3))

  const result = await stepper.step(ledger)
  assert.equal(result.disposition, 'failed')
  assert.match(result.summary, /does not match the required command/)
  assert.equal(runtime.calls.length, 0)
})

test('model turns are bounded even when no new tool request is executed', async () => {
  const provider = new FakeModelProvider([
    modelTurn({ kind: 'inspect', request: toolRequest('read-1', 'read_file', {}, 'read-digest', 3) }),
    modelTurn({ kind: 'blocked', summary: 'Should not be reached', reason: 'step limit' }),
  ])
  const runtime = new FakeAgentRuntime().on('read_file', (tool) => ({
    requestId: tool.id,
    ok: true,
    summary: 'Read once',
    startedAt: at(3),
    completedAt: at(4),
  }))
  const base = input()
  const ledger = createRunLedger(input({ limits: { ...base.limits, maxSteps: 1 } }), at(0))
  const stepper = new AgentStepper({
    provider,
    runtime,
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'read' }),
    tools,
    clock: advancingClock(1),
  })

  const result = await stepper.runUntilPause(ledger)
  assert.equal(result.disposition, 'failed')
  assert.match(result.summary, /step limit/)
  assert.equal(provider.requests.length, 1)
  assert.equal(result.ledger.stepCount, 1)
})

test('an aborted run cancels before requesting another model action', async () => {
  const provider = new FakeModelProvider([
    modelTurn({ kind: 'blocked', summary: 'Should not run', reason: 'cancelled' }),
  ])
  const stepper = new AgentStepper({
    provider,
    runtime: new FakeAgentRuntime(),
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'fixture allow' }),
    tools,
    clock: advancingClock(1),
  })
  const controller = new AbortController()
  controller.abort('user cancelled')

  const result = await stepper.step(createRunLedger(input(), at(0)), controller.signal)
  assert.equal(result.disposition, 'cancelled')
  assert.equal(result.ledger.status, 'cancelled')
  assert.equal(provider.requests.length, 0)
  assert.equal(result.events.at(-1).type, 'run.cancelled')
})
