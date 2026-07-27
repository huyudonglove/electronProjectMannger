import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'

import {
  AgentCoreError,
  RUN_SNAPSHOT_SCHEMA_VERSION,
  createRunLedger,
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
      maxDurationMs: 60_000,
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

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-checkpoint-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return path.join(directory, 'runs.sqlite')
}

test('SQLite checkpoint survives reopen with revisions and events intact', async (t) => {
  const databasePath = await fixture(t)
  let ledger = createRunLedger(input(), at(0))
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
