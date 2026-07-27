import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AgentCoreError,
  InMemoryCheckpointStore,
  RUN_SNAPSHOT_SCHEMA_VERSION,
  createRunLedger,
  decideResume,
  recordModelAttempt,
  sequenceAgentEvent,
  setPendingAction,
} from '../dist/index.js'

const at = (minute) => `2026-07-27T02:${String(minute).padStart(2, '0')}:00.000Z`

function input(runId = 'run-checkpoint') {
  return {
    runId,
    projectRoot: '/workspace/project',
    goal: 'Persist one run',
    acceptanceCriteria: [],
    constraints: [],
    workLevel: 'light',
    intent: 'analysis',
    verificationPlan: { checks: [] },
    limits: {
      maxSteps: 10,
      maxDurationMs: 60_000,
      maxInputTokens: 10_000,
      maxOutputTokens: 2_000,
      maxRepeatedFailures: 3,
    },
  }
}

function preparedEffect(recovery = 'reconcile_then_resume') {
  return {
    runId: 'run-checkpoint',
    toolRequestId: 'tool-1',
    actionDigest: 'digest-1',
    attempt: 1,
    recovery,
    status: 'prepared',
    backend: 'native',
    inputHash: 'input-hash',
    expectedEffects: [{
      kind: 'file',
      path: 'src/example.ts',
      operation: 'modify',
      beforeHash: 'before-hash',
      afterHash: 'after-hash',
    }],
    preparedAt: at(2),
    updatedAt: at(2),
  }
}

function commit(ledger, overrides = {}) {
  return {
    schemaVersion: RUN_SNAPSHOT_SCHEMA_VERSION,
    runId: ledger.runId,
    expectedRevision: null,
    committedAt: at(1),
    ledger,
    events: [],
    effects: [],
    configSnapshot: { schemaVersion: 1, revision: 'config-v1', data: { mode: 'default' } },
    modelRouteSnapshot: { schemaVersion: 1, revision: 'route-v1', data: { primary: 'openai' } },
    toolRegistrySnapshot: { schemaVersion: 1, revision: 'tools-v1', data: { enabled: ['read_file'] } },
    memorySnapshot: { schemaVersion: 1, revision: 'memory-v1', data: { mode: 'minimal' } },
    ...overrides,
  }
}

test('checkpoint commits assign revisions, preserve events and return immutable copies', async () => {
  const store = new InMemoryCheckpointStore()
  let ledger = createRunLedger(input(), at(0))
  const first = await store.commit(commit(ledger))
  assert.equal(first.snapshot.revision, 1)
  assert.equal(first.snapshot.configSnapshot.revision, 'config-v1')

  const sequenced = sequenceAgentEvent(ledger, 'run.started', 'Run started', at(2))
  ledger = sequenced.ledger
  const second = await store.commit(commit(ledger, {
    expectedRevision: 1,
    committedAt: at(2),
    events: [sequenced.event],
  }))
  assert.equal(second.snapshot.revision, 2)
  assert.deepEqual(second.events.map((event) => event.sequence), [1])

  second.snapshot.ledger.objective = 'mutated outside store'
  const loaded = await store.load(ledger.runId)
  assert.equal(loaded.snapshot.ledger.objective, 'Persist one run')
  assert.deepEqual(await store.list(), [{
    runId: ledger.runId,
    revision: 2,
    status: 'running',
    phase: 'created',
    committedAt: at(2),
    lastEventSequence: 1,
  }])
})

test('checkpoint store rejects stale revisions and non-contiguous events', async () => {
  const store = new InMemoryCheckpointStore()
  const ledger = createRunLedger(input(), at(0))
  await store.commit(commit(ledger))

  await assert.rejects(
    store.commit(commit(ledger)),
    (error) => error instanceof AgentCoreError && error.code === 'CHECKPOINT_ERROR' && /revision conflict/.test(error.message),
  )

  const sequenced = sequenceAgentEvent(ledger, 'run.started', 'Run started', at(2))
  await assert.rejects(
    store.commit(commit({ ...sequenced.ledger, eventSequence: 2 }, {
      expectedRevision: 1,
      events: [{ ...sequenced.event, sequence: 2 }],
    })),
    (error) => error instanceof AgentCoreError && /contiguous/.test(error.message),
  )

  await assert.rejects(
    store.commit(commit(ledger, {
      expectedRevision: 1,
      configSnapshot: { schemaVersion: 1, revision: 'config-v2', data: { mode: 'changed' } },
    })),
    (error) => error instanceof AgentCoreError && /immutable after the run starts/.test(error.message),
  )
})

test('effect journal is append-only and completed effects are immutable', async () => {
  const store = new InMemoryCheckpointStore()
  const ledger = createRunLedger(input(), at(0))
  const prepared = preparedEffect()
  await store.commit(commit(ledger, { effects: [prepared] }))

  const completed = {
    ...prepared,
    status: 'completed',
    updatedAt: at(3),
    result: {
      requestId: prepared.toolRequestId,
      ok: true,
      summary: 'File updated',
      startedAt: at(2),
      completedAt: at(3),
    },
  }
  await store.commit(commit(ledger, { expectedRevision: 1, committedAt: at(3), effects: [completed] }))

  await assert.rejects(
    store.commit(commit(ledger, {
      expectedRevision: 2,
      committedAt: at(4),
      effects: [{ ...completed, backend: 'changed-after-completion' }],
    })),
    (error) => error instanceof AgentCoreError && /immutable/.test(error.message),
  )
})

test('model attempt history is append-only and persisted attempts are immutable', async () => {
  const store = new InMemoryCheckpointStore()
  let ledger = createRunLedger(input(), at(0))
  ledger = recordModelAttempt(ledger, {
    id: 'run-checkpoint:step:1:route.coding:attempt:1',
    routeId: 'route.coding',
    routeRevision: '1',
    attempt: 1,
    profileId: 'model.primary',
    profileRevision: '2',
    provider: 'fixture',
    model: 'fixture-coder',
    startedAt: at(1),
    completedAt: at(2),
    outcome: 'failed',
    acceptedAction: false,
    inputTokens: 100,
    outputTokens: 10,
    error: {
      category: 'rate_limit',
      message: 'Retry later',
      retryable: true,
      sourceCode: 'MODEL_ERROR',
    },
  })
  await store.commit(commit(ledger))

  await assert.rejects(
    store.commit(commit({ ...ledger, modelAttempts: [] }, { expectedRevision: 1 })),
    (error) => error instanceof AgentCoreError && /append-only/.test(error.message),
  )
  await assert.rejects(
    store.commit(commit({
      ...ledger,
      modelAttempts: [{ ...ledger.modelAttempts[0], outputTokens: 11 }],
    }, { expectedRevision: 1 })),
    (error) => error instanceof AgentCoreError && /immutable/.test(error.message),
  )
})

test('resume decisions preserve approvals and classify unresolved effects', () => {
  let ledger = createRunLedger(input(), at(0))
  ledger = setPendingAction(ledger, {
    id: 'approval-1',
    kind: 'tool_approval',
    summary: 'Approve patch',
    createdAt: at(1),
    actionDigest: 'digest-1',
    toolRequestId: 'tool-1',
    approvalScope: 'tool',
  }, at(1))

  const base = {
    schemaVersion: RUN_SNAPSHOT_SCHEMA_VERSION,
    runId: ledger.runId,
    revision: 1,
    committedAt: at(1),
    ledger,
    lastEventSequence: ledger.eventSequence,
    effects: [],
  }
  assert.equal(decideResume(base).kind, 'awaiting_approval')

  const activeLedger = createRunLedger(input(), at(0))
  assert.equal(decideResume({ ...base, ledger: activeLedger, effects: [preparedEffect('safe_replay')] }).kind, 'replay')
  assert.equal(decideResume({ ...base, ledger: activeLedger, effects: [preparedEffect('reconcile_then_resume')] }).kind, 'reconcile')
  assert.equal(decideResume({ ...base, ledger: activeLedger, effects: [preparedEffect('never_auto_replay')] }).kind, 'blocked')
})
