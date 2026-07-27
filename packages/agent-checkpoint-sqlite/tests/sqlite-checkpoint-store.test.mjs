import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'

import {
  AgentCoreError,
  AgentStepper,
  FakeAgentRuntime,
  FakeModelProvider,
  FakePermissionPolicy,
  PersistedRunCoordinator,
  RUN_SNAPSHOT_SCHEMA_VERSION,
  createRunLedger,
  recordModelAttempt,
  sequenceAgentEvent,
} from '@electron-manager/agent-core'
import { SqliteCheckpointStore } from '../dist/index.js'

const at = (minute) => `2026-07-27T03:${String(minute).padStart(2, '0')}:00.000Z`

function input() {
  return {
    runId: 'run-sqlite',
    projectRoot: '/workspace/project',
    goal: 'Persist across process restarts',
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

function commit(ledger, overrides = {}) {
  return {
    schemaVersion: RUN_SNAPSHOT_SCHEMA_VERSION,
    runId: ledger.runId,
    expectedRevision: null,
    committedAt: at(1),
    ledger,
    events: [],
    effects: [],
    configSnapshot: { schemaVersion: 1, revision: 'config-v1', data: {} },
    modelRouteSnapshot: { schemaVersion: 1, revision: 'route-v1', data: {} },
    toolRegistrySnapshot: { schemaVersion: 1, revision: 'tools-v1', data: {} },
    memorySnapshot: { schemaVersion: 1, revision: 'memory-v1', data: {} },
    ...overrides,
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

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-checkpoint-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return path.join(directory, 'runs.sqlite')
}

test('SQLite checkpoint survives reopen with revisions and events intact', async (t) => {
  const databasePath = await fixture(t)
  let ledger = createRunLedger(input(), at(0))
  ledger = recordModelAttempt(ledger, {
    id: 'run-sqlite:step:1:route.coding:attempt:1',
    routeId: 'route.coding',
    routeRevision: '1',
    attempt: 1,
    profileId: 'model.primary',
    profileRevision: '1',
    provider: 'fixture',
    model: 'fixture-coder',
    startedAt: at(0),
    completedAt: at(1),
    outcome: 'succeeded',
    acceptedAction: true,
    inputTokens: 120,
    outputTokens: 20,
    finishReason: 'stop',
  })
  let store = new SqliteCheckpointStore(databasePath)
  await store.commit(commit(ledger))
  const sequenced = sequenceAgentEvent(ledger, 'run.started', 'Run started', at(2))
  ledger = sequenced.ledger
  await store.commit(commit(ledger, { expectedRevision: 1, committedAt: at(2), events: [sequenced.event] }))
  store.close()

  store = new SqliteCheckpointStore(databasePath)
  const loaded = await store.load(ledger.runId)
  assert.equal(loaded.snapshot.revision, 2)
  assert.equal(loaded.snapshot.ledger.objective, 'Persist across process restarts')
  assert.equal(loaded.snapshot.ledger.modelAttempts[0].profileId, 'model.primary')
  assert.deepEqual(loaded.events.map((event) => event.sequence), [1])
  assert.equal((await store.list())[0].lastEventSequence, 1)
  store.close()
})

test('SQLite transaction rolls back a stale revision without appending data', async (t) => {
  const databasePath = await fixture(t)
  const ledger = createRunLedger(input(), at(0))
  const store = new SqliteCheckpointStore(databasePath)
  await store.commit(commit(ledger))
  await assert.rejects(
    store.commit(commit(ledger)),
    (error) => error instanceof AgentCoreError && /revision conflict/.test(error.message),
  )
  const loaded = await store.load(ledger.runId)
  assert.equal(loaded.snapshot.revision, 1)
  assert.equal(loaded.events.length, 0)
  store.close()
})

test('SQLite checkpoint rejects payload corruption and unsupported database schema', async (t) => {
  const databasePath = await fixture(t)
  const ledger = createRunLedger(input(), at(0))
  let store = new SqliteCheckpointStore(databasePath)
  await store.commit(commit(ledger))
  store.close()

  let database = new DatabaseSync(databasePath)
  database.prepare("UPDATE runs SET snapshot_json = '{}' WHERE run_id = ?").run(ledger.runId)
  database.close()
  store = new SqliteCheckpointStore(databasePath)
  await assert.rejects(store.load(ledger.runId), /hash mismatch/)
  store.close()

  database = new DatabaseSync(databasePath)
  database.exec('PRAGMA user_version = 99')
  database.close()
  assert.throws(() => new SqliteCheckpointStore(databasePath), /Unsupported SQLite checkpoint schema version/)
})

test('coordinator resumes approval after SQLite reopen and never repeats the completed tool', async (t) => {
  const databasePath = await fixture(t)
  const request = {
    id: 'read-after-restart',
    name: 'read_file',
    input: { path: 'src/example.ts' },
    requestedAt: at(2),
    actionDigest: 'restart-digest',
  }
  const runtime = new FakeAgentRuntime().on('read_file', (toolRequest) => ({
    requestId: toolRequest.id,
    ok: true,
    summary: 'Read after restart',
    output: 'content',
    startedAt: at(20),
    completedAt: at(21),
  }))
  const askingStepper = new AgentStepper({
    provider: new FakeModelProvider([modelTurn({ kind: 'inspect', request })]),
    runtime,
    permissionPolicy: new FakePermissionPolicy({ effect: 'ask', reason: 'Confirm persisted request' }),
    tools: [readTool],
    clock: clock(2),
  })

  let store = new SqliteCheckpointStore(databasePath)
  let coordinator = new PersistedRunCoordinator({ stepper: askingStepper, store, clock: clock(0) })
  await coordinator.create(input())
  const paused = await coordinator.advance('run-sqlite')
  assert.equal(paused.decision.kind, 'awaiting_approval')
  assert.equal(runtime.calls.length, 0)
  store.close()

  store = new SqliteCheckpointStore(databasePath)
  coordinator = new PersistedRunCoordinator({ stepper: askingStepper, store, clock: clock(30) })
  const resumed = await coordinator.resolveApproval('run-sqlite', { decision: 'approved', decidedAt: at(30) })
  assert.equal(resumed.checkpoint.snapshot.effects[0].status, 'completed')
  assert.equal(runtime.calls.length, 1)
  store.close()

  const stoppingProvider = new FakeModelProvider([modelTurn({ kind: 'blocked', summary: 'Fixture complete', reason: 'stop' })])
  const stoppingStepper = new AgentStepper({
    provider: stoppingProvider,
    runtime,
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'fixture' }),
    tools: [readTool],
    clock: clock(40),
  })
  store = new SqliteCheckpointStore(databasePath)
  coordinator = new PersistedRunCoordinator({ stepper: stoppingStepper, store, clock: clock(40) })
  const stopped = await coordinator.advance('run-sqlite')
  assert.equal(stopped.step.disposition, 'blocked')
  assert.equal(runtime.calls.length, 1)
  store.close()

  store = new SqliteCheckpointStore(databasePath)
  coordinator = new PersistedRunCoordinator({ stepper: stoppingStepper, store, clock: clock(50) })
  const terminal = await coordinator.advance('run-sqlite')
  assert.equal(terminal.decision.kind, 'terminal')
  assert.equal(stoppingProvider.requests.length, 1)
  assert.equal(runtime.calls.length, 1)
  store.close()
})
