import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AgentCoreError,
  AgentStepper,
  FakeAgentRuntime,
  FakeModelProvider,
  FakePermissionPolicy,
  InMemoryCheckpointStore,
  PersistedRunCoordinator,
  RUN_SNAPSHOT_SCHEMA_VERSION,
  recordToolRequest,
  transitionLedger,
} from '../dist/index.js'

const at = (minute) => `2026-07-27T04:${String(minute).padStart(2, '0')}:00.000Z`

function input() {
  return {
    runId: 'run-coordinator',
    projectRoot: '/workspace/project',
    goal: 'Persist around tool execution',
    acceptanceCriteria: [],
    constraints: [],
    workLevel: 'light',
    intent: 'analysis',
    verificationPlan: { checks: [] },
    limits: {
      maxSteps: 10,
      maxDurationMs: 3_600_000,
      maxInputTokens: 10_000,
      maxOutputTokens: 2_000,
      maxRepeatedFailures: 3,
    },
  }
}

const readTool = {
  name: 'read_file',
  description: 'Read a project file',
  risk: 'read',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
    additionalProperties: false,
  },
}

function toolRequest() {
  return {
    id: 'read-1',
    name: 'read_file',
    input: { path: 'src/example.ts' },
    requestedAt: at(2),
    actionDigest: 'read-digest',
  }
}

function modelTurn(action) {
  return [
    { type: 'action', action },
    { type: 'completed', finishReason: action.kind === 'blocked' ? 'stop' : 'tool_calls' },
  ]
}

function clock(start = 1) {
  let minute = start
  return () => at(minute++)
}

test('coordinator commits prepared effect before runtime and publishes only committed events', async () => {
  const store = new InMemoryCheckpointStore()
  const publications = []
  const runtime = new FakeAgentRuntime().on('read_file', async (request) => {
    const duringExecution = await store.load('run-coordinator')
    assert.equal(duringExecution.snapshot.effects[0].status, 'prepared')
    assert.equal(duringExecution.snapshot.ledger.toolExecutions[0].request.id, request.id)
    return {
      requestId: request.id,
      ok: true,
      summary: 'Read file',
      output: 'content',
      startedAt: at(8),
      completedAt: at(9),
    }
  })
  const stepper = new AgentStepper({
    provider: new FakeModelProvider([
      modelTurn({ kind: 'inspect', request: toolRequest() }),
      modelTurn({ kind: 'blocked', summary: 'Fixture complete', reason: 'stop' }),
    ]),
    runtime,
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'read-only' }),
    tools: [readTool],
    clock: clock(2),
  })
  const coordinator = new PersistedRunCoordinator({
    stepper,
    store,
    clock: clock(0),
    onCommitted: async (checkpoint, events) => {
      const persisted = await store.load(checkpoint.snapshot.runId)
      assert.equal(persisted.snapshot.revision, checkpoint.snapshot.revision)
      publications.push(events.map((event) => event.sequence))
    },
  })

  await coordinator.create(input(), {
    configSnapshot: { schemaVersion: 1, revision: 'config-v1', data: {} },
  })
  const first = await coordinator.advance('run-coordinator')
  assert.equal(first.step.disposition, 'continue', first.step.summary)
  assert.equal(first.checkpoint.snapshot.revision, 3)
  assert.equal(first.checkpoint.snapshot.effects[0].status, 'completed')
  assert.equal(runtime.calls.length, 1)
  assert.deepEqual(publications[0], [])
  assert.ok(publications[1].length > 0)
  assert.ok(publications[2].length > 0)

  const restarted = new PersistedRunCoordinator({ stepper, store, clock: clock(20) })
  const second = await restarted.advance('run-coordinator')
  assert.equal(second.step.disposition, 'blocked')
  assert.equal(runtime.calls.length, 1)
})

test('pending approval survives coordinator recreation and executes the exact recorded request once', async () => {
  const store = new InMemoryCheckpointStore()
  const runtime = new FakeAgentRuntime().on('read_file', (request) => ({
    requestId: request.id,
    ok: true,
    summary: 'Approved read',
    startedAt: at(10),
    completedAt: at(11),
  }))
  const stepper = new AgentStepper({
    provider: new FakeModelProvider([modelTurn({ kind: 'inspect', request: toolRequest() })]),
    runtime,
    permissionPolicy: new FakePermissionPolicy({ effect: 'ask', reason: 'Confirm read' }),
    tools: [readTool],
    clock: clock(2),
  })
  let coordinator = new PersistedRunCoordinator({ stepper, store, clock: clock(0) })
  await coordinator.create(input())
  const paused = await coordinator.advance('run-coordinator')
  assert.equal(paused.decision.kind, 'awaiting_approval', paused.step?.summary)
  assert.equal(runtime.calls.length, 0)

  coordinator = new PersistedRunCoordinator({ stepper, store, clock: clock(20) })
  const resumed = await coordinator.resolveApproval('run-coordinator', {
    decision: 'approved',
    decidedAt: at(20),
  })
  assert.equal(resumed.step.disposition, 'continue')
  assert.equal(resumed.checkpoint.snapshot.effects[0].status, 'completed')
  assert.equal(runtime.calls.length, 1)
  assert.equal(runtime.calls[0].request.actionDigest, 'read-digest')
})

test('unknown never-replay effect blocks coordinator before model or runtime execution', async () => {
  const store = new InMemoryCheckpointStore()
  const provider = new FakeModelProvider([modelTurn({ kind: 'blocked', summary: 'Must not run', reason: 'unknown effect' })])
  const runtime = new FakeAgentRuntime()
  const stepper = new AgentStepper({
    provider,
    runtime,
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'fixture' }),
    tools: [readTool],
  })
  const coordinator = new PersistedRunCoordinator({ stepper, store, clock: clock(0) })
  const created = await coordinator.create(input())
  await store.commit({
    schemaVersion: RUN_SNAPSHOT_SCHEMA_VERSION,
    runId: 'run-coordinator',
    expectedRevision: created.snapshot.revision,
    committedAt: at(2),
    ledger: created.snapshot.ledger,
    events: [],
    effects: [{
      runId: 'run-coordinator',
      toolRequestId: 'exec-1',
      actionDigest: 'exec-digest',
      attempt: 1,
      recovery: 'never_auto_replay',
      status: 'unknown',
      backend: 'runtime',
      inputHash: 'exec-digest',
      expectedEffects: [],
      preparedAt: at(1),
      updatedAt: at(2),
    }],
  })

  const result = await coordinator.advance('run-coordinator')
  assert.equal(result.decision.kind, 'blocked')
  assert.equal(provider.requests.length, 0)
  assert.equal(runtime.calls.length, 0)
})

test('safe read effect replays after restart without requesting another model action', async () => {
  const store = new InMemoryCheckpointStore()
  const provider = new FakeModelProvider([])
  const runtime = new FakeAgentRuntime().on('read_file', (request) => ({
    requestId: request.id,
    ok: true,
    summary: 'Recovered read',
    output: 'content',
    startedAt: at(5),
    completedAt: at(6),
  }))
  const stepper = new AgentStepper({
    provider,
    runtime,
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'fixture' }),
    tools: [readTool],
  })
  const coordinator = new PersistedRunCoordinator({ stepper, store, clock: clock(0) })
  const created = await coordinator.create(input())
  const request = toolRequest()
  const ledger = recordToolRequest(created.snapshot.ledger, request)
  await store.commit({
    schemaVersion: RUN_SNAPSHOT_SCHEMA_VERSION,
    runId: ledger.runId,
    expectedRevision: created.snapshot.revision,
    committedAt: at(2),
    ledger,
    events: [],
    effects: [{
      runId: ledger.runId,
      toolRequestId: request.id,
      actionDigest: request.actionDigest,
      attempt: 1,
      recovery: 'safe_replay',
      status: 'prepared',
      backend: 'runtime',
      inputHash: request.actionDigest,
      expectedEffects: [],
      preparedAt: at(1),
      updatedAt: at(2),
    }],
  })

  const resumed = await coordinator.advance(ledger.runId)
  assert.equal(resumed.step.disposition, 'continue')
  assert.equal(resumed.checkpoint.snapshot.effects[0].status, 'completed')
  assert.equal(resumed.checkpoint.snapshot.ledger.toolExecutions[0].result.summary, 'Recovered read')
  assert.equal(provider.requests.length, 0)
  assert.equal(runtime.calls.length, 1)
})

test('checkpoint failure prevents runtime execution and does not persist a failed business state', async () => {
  const delegate = new InMemoryCheckpointStore()
  let commitCount = 0
  const store = {
    load: (runId) => delegate.load(runId),
    list: () => delegate.list(),
    commit: async (value) => {
      commitCount += 1
      if (commitCount === 2) throw new AgentCoreError('CHECKPOINT_ERROR', 'Injected commit failure')
      return await delegate.commit(value)
    },
  }
  const runtime = new FakeAgentRuntime().on('read_file', () => {
    throw new Error('Runtime must not start')
  })
  const stepper = new AgentStepper({
    provider: new FakeModelProvider([modelTurn({ kind: 'inspect', request: toolRequest() })]),
    runtime,
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'fixture' }),
    tools: [readTool],
    clock: clock(2),
  })
  const coordinator = new PersistedRunCoordinator({ stepper, store, clock: clock(0) })
  await coordinator.create(input())
  await assert.rejects(coordinator.advance('run-coordinator'), /Injected commit failure/)
  assert.equal(runtime.calls.length, 0)
  const persisted = await delegate.load('run-coordinator')
  assert.equal(persisted.snapshot.ledger.status, 'running')
  assert.equal(persisted.snapshot.ledger.toolExecutions.length, 0)
})

test('UI publication failure does not fail the run or prevent tool execution', async () => {
  const store = new InMemoryCheckpointStore()
  const publishErrors = []
  const runtime = new FakeAgentRuntime().on('read_file', (request) => ({
    requestId: request.id,
    ok: true,
    summary: 'Read despite subscriber failure',
    startedAt: at(8),
    completedAt: at(9),
  }))
  const stepper = new AgentStepper({
    provider: new FakeModelProvider([modelTurn({ kind: 'inspect', request: toolRequest() })]),
    runtime,
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'fixture' }),
    tools: [readTool],
    clock: clock(2),
  })
  const coordinator = new PersistedRunCoordinator({
    stepper,
    store,
    clock: clock(0),
    onCommitted: async () => { throw new Error('subscriber offline') },
    onPublishError: (error) => { publishErrors.push(error) },
  })
  await coordinator.create(input())
  const result = await coordinator.advance('run-coordinator')
  assert.equal(result.step.disposition, 'continue')
  assert.equal(result.checkpoint.snapshot.effects[0].status, 'completed')
  assert.equal(runtime.calls.length, 1)
  assert.equal(publishErrors.length, 3)
})

test('coordinator freezes the runtime tool snapshot when a run is created', async () => {
  const store = new InMemoryCheckpointStore()
  const runtime = new FakeAgentRuntime()
  runtime.snapshotTools = async () => ({
    schemaVersion: 1,
    revision: 'registry-v1',
    data: { tools: [{ name: 'read_file', available: true }] },
  })
  const stepper = new AgentStepper({
    provider: new FakeModelProvider([]),
    runtime,
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'fixture' }),
    tools: [readTool],
  })
  const coordinator = new PersistedRunCoordinator({ stepper, store, clock: clock(0) })
  const created = await coordinator.create(input())

  assert.equal(created.snapshot.toolRegistrySnapshot.revision, 'registry-v1')
  assert.equal(created.snapshot.toolRegistrySnapshot.data.tools[0].name, 'read_file')
})

test('coordinator persists reconcile completion, not-applied failure and blocked ambiguity', async () => {
  for (const outcome of ['completed', 'not_applied', 'blocked']) {
    const store = new InMemoryCheckpointStore()
    const runtime = new FakeAgentRuntime()
    runtime.reconcileEffect = async (request) => {
      if (outcome === 'blocked') return { outcome, summary: 'File state is ambiguous' }
      const atValue = at(outcome === 'completed' ? 8 : 9)
      return {
        outcome,
        summary: outcome,
        result: {
          requestId: request.id,
          ok: outcome === 'completed',
          summary: outcome,
          startedAt: atValue,
          completedAt: atValue,
          ...(outcome === 'not_applied' ? {
            error: { code: 'TOOL_EXECUTION_FAILED', message: 'not applied', retryable: true },
          } : {}),
        },
      }
    }
    const stepper = new AgentStepper({
      provider: new FakeModelProvider([]),
      runtime,
      permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'fixture' }),
      tools: [{ ...readTool, name: 'write_fixture', risk: 'project_write', recovery: 'reconcile_then_resume' }],
    })
    const coordinator = new PersistedRunCoordinator({ stepper, store, clock: clock(0) })
    const runInput = { ...input(), runId: `run-${outcome}` }
    const created = await coordinator.create(runInput)
    const request = { ...toolRequest(), id: `tool-${outcome}`, name: 'write_fixture' }
    let ledger = transitionLedger(created.snapshot.ledger, 'loading_context', at(1))
    ledger = transitionLedger(ledger, 'inspecting', at(1))
    ledger = transitionLedger(ledger, 'acting', at(1))
    ledger = recordToolRequest(ledger, request)
    await store.commit({
      schemaVersion: RUN_SNAPSHOT_SCHEMA_VERSION,
      runId: runInput.runId,
      expectedRevision: created.snapshot.revision,
      committedAt: at(2),
      ledger,
      events: [],
      effects: [{
        runId: runInput.runId,
        toolRequestId: request.id,
        actionDigest: request.actionDigest,
        attempt: 1,
        recovery: 'reconcile_then_resume',
        status: 'unknown',
        backend: 'fixture',
        inputHash: request.actionDigest,
        expectedEffects: [{
          kind: 'file',
          path: 'src/example.ts',
          operation: 'modify',
          beforeHash: 'before',
          afterHash: 'after',
        }],
        preparedAt: at(1),
        updatedAt: at(2),
      }],
    })

    const resumed = await coordinator.advance(runInput.runId)
    if (outcome === 'blocked') {
      assert.equal(resumed.decision.kind, 'terminal')
      assert.equal(resumed.checkpoint.snapshot.ledger.status, 'blocked')
    } else {
      assert.equal(resumed.checkpoint.snapshot.effects[0].status, outcome === 'completed' ? 'completed' : 'failed')
      assert.equal(resumed.checkpoint.snapshot.ledger.toolExecutions[0].result.ok, outcome === 'completed')
    }
  }
})
