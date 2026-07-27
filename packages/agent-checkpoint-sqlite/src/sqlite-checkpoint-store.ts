import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  AgentCoreError,
  RUN_SNAPSHOT_SCHEMA_VERSION,
  applyCheckpointCommit,
  effectRecordKey,
  validateLoadedCheckpoint,
  type AgentEvent,
  type CheckpointCommit,
  type CheckpointStore,
  type EffectRecord,
  type LoadedCheckpoint,
  type RunCheckpointSummary,
  type RunSnapshot,
} from '@electron-manager/agent-core'

const DATABASE_SCHEMA_VERSION = 1

interface JsonRow {
  value: string
  hash?: string
}

interface RunIdRow {
  run_id: string
}

export class SqliteCheckpointStore implements CheckpointStore {
  readonly #database: DatabaseSync
  #closed = false

  constructor(databasePath: string) {
    if (!databasePath.trim()) throw checkpointError('SQLite checkpoint path is required')
    if (databasePath !== ':memory:') mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true })
    this.#database = new DatabaseSync(databasePath, { allowExtension: false })
    this.#database.exec('PRAGMA foreign_keys = ON')
    if (databasePath !== ':memory:') this.#database.exec('PRAGMA journal_mode = WAL')
    this.#initializeSchema()
  }

  async load(runId: string): Promise<LoadedCheckpoint | null> {
    this.#assertOpen()
    return this.#load(runId)
  }

  async commit(commit: CheckpointCommit): Promise<LoadedCheckpoint> {
    this.#assertOpen()
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      const current = this.#load(commit.runId)
      const record = applyCheckpointCommit(current, commit)
      this.#persist(record, commit.events)
      this.#database.exec('COMMIT')
      return structuredClone(record)
    } catch (error) {
      try {
        this.#database.exec('ROLLBACK')
      } catch {
        // Preserve the original checkpoint failure.
      }
      if (error instanceof AgentCoreError) throw error
      throw checkpointError('SQLite checkpoint commit failed', error)
    }
  }

  async list(): Promise<RunCheckpointSummary[]> {
    this.#assertOpen()
    const rows = this.#database.prepare('SELECT run_id FROM runs ORDER BY committed_at DESC, run_id ASC').all() as unknown as RunIdRow[]
    const summaries: RunCheckpointSummary[] = []
    for (const row of rows) {
      const record = this.#load(row.run_id)
      if (!record) throw checkpointError(`Run index points to a missing checkpoint: ${row.run_id}`)
      summaries.push({
        runId: record.snapshot.runId,
        revision: record.snapshot.revision,
        status: record.snapshot.ledger.status,
        phase: record.snapshot.ledger.phase,
        committedAt: record.snapshot.committedAt,
        lastEventSequence: record.snapshot.lastEventSequence,
      })
    }
    return summaries
  }

  close() {
    if (this.#closed) return
    this.#database.close()
    this.#closed = true
  }

  #initializeSchema() {
    const row = this.#database.prepare('PRAGMA user_version').get() as unknown as { user_version: number }
    if (row.user_version !== 0 && row.user_version !== DATABASE_SCHEMA_VERSION) {
      this.#database.close()
      this.#closed = true
      throw checkpointError(`Unsupported SQLite checkpoint schema version: ${row.user_version}`)
    }
    if (row.user_version === DATABASE_SCHEMA_VERSION) return

    this.#database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE runs (
        run_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        committed_at TEXT NOT NULL,
        last_event_sequence INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        snapshot_hash TEXT NOT NULL
      );
      CREATE TABLE checkpoints (
        run_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        committed_at TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        snapshot_hash TEXT NOT NULL,
        PRIMARY KEY (run_id, revision)
      );
      CREATE TABLE events (
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        event_json TEXT NOT NULL,
        PRIMARY KEY (run_id, sequence)
      );
      CREATE TABLE effects (
        run_id TEXT NOT NULL,
        effect_key TEXT NOT NULL,
        status TEXT NOT NULL,
        effect_json TEXT NOT NULL,
        PRIMARY KEY (run_id, effect_key)
      );
      PRAGMA user_version = ${DATABASE_SCHEMA_VERSION};
      COMMIT;
    `)
  }

  #load(runId: string): LoadedCheckpoint | null {
    const row = this.#database.prepare(
      'SELECT snapshot_json AS value, snapshot_hash AS hash FROM runs WHERE run_id = ?',
    ).get(runId) as unknown as JsonRow | undefined
    if (!row) return null
    if (sha256(row.value) !== row.hash) throw checkpointError(`Checkpoint hash mismatch for run: ${runId}`)

    try {
      const snapshot = JSON.parse(row.value) as RunSnapshot
      if (snapshot.schemaVersion !== RUN_SNAPSHOT_SCHEMA_VERSION) {
        throw checkpointError(`Unsupported RunSnapshot schema version: ${snapshot.schemaVersion}`)
      }
      const eventRows = this.#database.prepare(
        'SELECT event_json AS value FROM events WHERE run_id = ? ORDER BY sequence ASC',
      ).all(runId) as unknown as JsonRow[]
      const events = eventRows.map((eventRow) => JSON.parse(eventRow.value) as AgentEvent)
      const record = { snapshot, events }
      validateLoadedCheckpoint(record)
      this.#validateEffects(snapshot)
      return structuredClone(record)
    } catch (error) {
      if (error instanceof AgentCoreError) throw error
      throw checkpointError(`Checkpoint payload is invalid for run: ${runId}`, error)
    }
  }

  #validateEffects(snapshot: RunSnapshot) {
    const rows = this.#database.prepare(
      'SELECT effect_json AS value FROM effects WHERE run_id = ? ORDER BY effect_key ASC',
    ).all(snapshot.runId) as unknown as JsonRow[]
    const stored = rows.map((row) => JSON.parse(row.value) as EffectRecord)
    const expected = [...snapshot.effects].sort((left, right) => effectRecordKey(left).localeCompare(effectRecordKey(right)))
    if (JSON.stringify(stored) !== JSON.stringify(expected)) {
      throw checkpointError(`Effect journal mismatch for run: ${snapshot.runId}`)
    }
  }

  #persist(record: LoadedCheckpoint, newEvents: AgentEvent[]) {
    const snapshotJson = JSON.stringify(record.snapshot)
    const snapshotHash = sha256(snapshotJson)
    this.#database.prepare(`
      INSERT INTO checkpoints (run_id, revision, committed_at, snapshot_json, snapshot_hash)
      VALUES (?, ?, ?, ?, ?)
    `).run(record.snapshot.runId, record.snapshot.revision, record.snapshot.committedAt, snapshotJson, snapshotHash)

    this.#database.prepare(`
      INSERT INTO runs (run_id, revision, status, phase, committed_at, last_event_sequence, snapshot_json, snapshot_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        revision = excluded.revision,
        status = excluded.status,
        phase = excluded.phase,
        committed_at = excluded.committed_at,
        last_event_sequence = excluded.last_event_sequence,
        snapshot_json = excluded.snapshot_json,
        snapshot_hash = excluded.snapshot_hash
    `).run(
      record.snapshot.runId,
      record.snapshot.revision,
      record.snapshot.ledger.status,
      record.snapshot.ledger.phase,
      record.snapshot.committedAt,
      record.snapshot.lastEventSequence,
      snapshotJson,
      snapshotHash,
    )

    const insertEvent = this.#database.prepare(
      'INSERT INTO events (run_id, sequence, event_id, event_json) VALUES (?, ?, ?, ?)',
    )
    for (const event of newEvents) insertEvent.run(event.runId, event.sequence, event.id, JSON.stringify(event))

    const upsertEffect = this.#database.prepare(`
      INSERT INTO effects (run_id, effect_key, status, effect_json) VALUES (?, ?, ?, ?)
      ON CONFLICT(run_id, effect_key) DO UPDATE SET
        status = excluded.status,
        effect_json = excluded.effect_json
    `)
    for (const effect of record.snapshot.effects) {
      upsertEffect.run(effect.runId, effectRecordKey(effect), effect.status, JSON.stringify(effect))
    }
  }

  #assertOpen() {
    if (this.#closed) throw checkpointError('SQLite checkpoint store is closed')
  }
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function checkpointError(message: string, cause?: unknown) {
  return new AgentCoreError('CHECKPOINT_ERROR', message, { cause })
}
