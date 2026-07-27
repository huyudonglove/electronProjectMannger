import { AgentCoreError } from './errors.js'
import type {
  AgentEvent,
  EffectExpectation,
  JsonValue,
  PendingAction,
  RunLedger,
  RunStatus,
  ToolRecovery,
  ToolResult,
} from './protocol.js'

export const RUN_SNAPSHOT_SCHEMA_VERSION = 1 as const

export type EffectRecovery = ToolRecovery
export type EffectStatus = 'prepared' | 'completed' | 'failed' | 'unknown'

export interface EffectRecord {
  runId: string
  toolRequestId: string
  actionDigest: string
  attempt: number
  recovery: EffectRecovery
  status: EffectStatus
  backend: string
  inputHash: string
  expectedEffects: EffectExpectation[]
  verificationCheckId?: string
  preparedAt: string
  updatedAt: string
  result?: ToolResult
}

export interface VersionedRunComponentSnapshot {
  schemaVersion: number
  revision: string
  data: Record<string, JsonValue>
}

export interface RunSnapshot {
  schemaVersion: typeof RUN_SNAPSHOT_SCHEMA_VERSION
  runId: string
  revision: number
  committedAt: string
  ledger: RunLedger
  lastEventSequence: number
  effects: EffectRecord[]
  configSnapshot?: VersionedRunComponentSnapshot
  modelRouteSnapshot?: VersionedRunComponentSnapshot
  toolRegistrySnapshot?: VersionedRunComponentSnapshot
  memorySnapshot?: VersionedRunComponentSnapshot
}

export interface CheckpointCommit {
  schemaVersion: typeof RUN_SNAPSHOT_SCHEMA_VERSION
  runId: string
  expectedRevision: number | null
  committedAt: string
  ledger: RunLedger
  events: AgentEvent[]
  effects: EffectRecord[]
  configSnapshot?: VersionedRunComponentSnapshot
  modelRouteSnapshot?: VersionedRunComponentSnapshot
  toolRegistrySnapshot?: VersionedRunComponentSnapshot
  memorySnapshot?: VersionedRunComponentSnapshot
}

export interface LoadedCheckpoint {
  snapshot: RunSnapshot
  events: AgentEvent[]
}

export interface RunCheckpointSummary {
  runId: string
  revision: number
  status: RunStatus
  phase: RunLedger['phase']
  committedAt: string
  lastEventSequence: number
}

export interface CheckpointStore {
  load(runId: string): Promise<LoadedCheckpoint | null>
  commit(commit: CheckpointCommit): Promise<LoadedCheckpoint>
  list(): Promise<RunCheckpointSummary[]>
}

export type ResumeDecision =
  | { kind: 'continue'; reason: string }
  | { kind: 'awaiting_approval'; reason: string; pendingAction: PendingAction }
  | { kind: 'replay'; reason: string; effect: EffectRecord }
  | { kind: 'reconcile'; reason: string; effect: EffectRecord }
  | { kind: 'blocked'; reason: string; effect?: EffectRecord }
  | { kind: 'terminal'; reason: string; status: Extract<RunStatus, 'completed' | 'blocked' | 'failed' | 'cancelled'> }

const terminalStatuses = new Set<RunStatus>(['completed', 'blocked', 'failed', 'cancelled'])

export function decideResume(snapshot: RunSnapshot): ResumeDecision {
  assertSupportedSnapshot(snapshot)

  if (terminalStatuses.has(snapshot.ledger.status)) {
    return {
      kind: 'terminal',
      status: snapshot.ledger.status as Extract<RunStatus, 'completed' | 'blocked' | 'failed' | 'cancelled'>,
      reason: `Run is already ${snapshot.ledger.status}`,
    }
  }

  if (snapshot.ledger.pendingAction) {
    return {
      kind: 'awaiting_approval',
      pendingAction: structuredClone(snapshot.ledger.pendingAction),
      reason: 'Run has a persisted pending action',
    }
  }

  if (snapshot.ledger.phase === 'awaiting_approval') {
    return { kind: 'blocked', reason: 'Approval phase is missing its pending action' }
  }

  const unresolved = snapshot.effects.filter((effect) => effect.status === 'prepared' || effect.status === 'unknown')
  if (unresolved.length > 1) {
    return { kind: 'blocked', reason: 'Run has multiple unresolved effects' }
  }

  const effect = unresolved[0]
  if (!effect) return { kind: 'continue', reason: 'No unresolved effect or pending action' }
  if (effect.recovery === 'safe_replay') {
    return { kind: 'replay', effect: structuredClone(effect), reason: 'Unresolved effect is declared safe to replay' }
  }
  if (effect.recovery === 'reconcile_then_resume') {
    return { kind: 'reconcile', effect: structuredClone(effect), reason: 'External state must be reconciled before resume' }
  }
  return { kind: 'blocked', effect: structuredClone(effect), reason: 'Effect must never be replayed automatically' }
}

export class InMemoryCheckpointStore implements CheckpointStore {
  readonly #records = new Map<string, LoadedCheckpoint>()

  async load(runId: string): Promise<LoadedCheckpoint | null> {
    const record = this.#records.get(runId)
    return record ? structuredClone(record) : null
  }

  async commit(commit: CheckpointCommit): Promise<LoadedCheckpoint> {
    const current = this.#records.get(commit.runId)
    const record = applyCheckpointCommit(current ?? null, commit)
    this.#records.set(commit.runId, structuredClone(record))
    return structuredClone(record)
  }

  async list(): Promise<RunCheckpointSummary[]> {
    return [...this.#records.values()]
      .map(({ snapshot }) => ({
        runId: snapshot.runId,
        revision: snapshot.revision,
        status: snapshot.ledger.status,
        phase: snapshot.ledger.phase,
        committedAt: snapshot.committedAt,
        lastEventSequence: snapshot.lastEventSequence,
      }))
      .sort((left, right) => right.committedAt.localeCompare(left.committedAt) || left.runId.localeCompare(right.runId))
  }
}

export function effectRecordKey(effect: Pick<EffectRecord, 'runId' | 'toolRequestId' | 'actionDigest' | 'attempt'>) {
  return `${effect.runId}:${effect.toolRequestId}:${effect.actionDigest}:${effect.attempt}`
}

export function applyCheckpointCommit(current: LoadedCheckpoint | null, commit: CheckpointCommit): LoadedCheckpoint {
  validateCommit(commit)
  if (current) validateLoadedCheckpoint(current)
  const currentRevision = current?.snapshot.revision ?? null
  if (commit.expectedRevision !== currentRevision) {
    throw new AgentCoreError('CHECKPOINT_ERROR', 'Checkpoint revision conflict', {
      details: {
        runId: commit.runId,
        expectedRevision: commit.expectedRevision,
        actualRevision: currentRevision,
      },
    })
  }

  const previousSequence = current?.snapshot.lastEventSequence ?? 0
  validateEvents(commit.runId, previousSequence, commit.ledger.eventSequence, commit.events)
  validateEffectHistory(current?.snapshot.effects ?? [], commit.effects)
  validateModelAttemptHistory(current?.snapshot.ledger.modelAttempts ?? [], commit.ledger.modelAttempts)
  validateContextEnvelopeHistory(current?.snapshot.ledger.contextEnvelopes ?? [], commit.ledger.contextEnvelopes)
  validateComponentHistory(current?.snapshot, commit)

  const snapshot: RunSnapshot = {
    schemaVersion: RUN_SNAPSHOT_SCHEMA_VERSION,
    runId: commit.runId,
    revision: (currentRevision ?? 0) + 1,
    committedAt: commit.committedAt,
    ledger: structuredClone(commit.ledger),
    lastEventSequence: commit.ledger.eventSequence,
    effects: structuredClone(commit.effects),
    ...(commit.configSnapshot ? { configSnapshot: structuredClone(commit.configSnapshot) } : {}),
    ...(commit.modelRouteSnapshot ? { modelRouteSnapshot: structuredClone(commit.modelRouteSnapshot) } : {}),
    ...(commit.toolRegistrySnapshot ? { toolRegistrySnapshot: structuredClone(commit.toolRegistrySnapshot) } : {}),
    ...(commit.memorySnapshot ? { memorySnapshot: structuredClone(commit.memorySnapshot) } : {}),
  }
  return {
    snapshot,
    events: [...(current?.events ?? []), ...structuredClone(commit.events)],
  }
}

export function validateLoadedCheckpoint(record: LoadedCheckpoint) {
  assertSupportedSnapshot(record.snapshot)
  validateEvents(record.snapshot.runId, 0, record.snapshot.lastEventSequence, record.events)
  for (const effect of record.snapshot.effects) validateEffect(record.snapshot.runId, effect)
  validateModelAttempts(record.snapshot.runId, record.snapshot.ledger.modelAttempts)
  validateContextEnvelopes(record.snapshot.ledger.contextEnvelopes)
  const keys = record.snapshot.effects.map(effectRecordKey)
  if (new Set(keys).size !== keys.length) {
    throw new AgentCoreError('CHECKPOINT_ERROR', 'Effect journal contains duplicate idempotency keys')
  }
}

function assertSupportedSnapshot(snapshot: RunSnapshot) {
  if (snapshot.schemaVersion !== RUN_SNAPSHOT_SCHEMA_VERSION) {
    throw new AgentCoreError('CHECKPOINT_ERROR', `Unsupported RunSnapshot schema version: ${snapshot.schemaVersion}`)
  }
  if (snapshot.runId !== snapshot.ledger.runId) {
    throw new AgentCoreError('CHECKPOINT_ERROR', 'RunSnapshot run id does not match its ledger')
  }
  if (snapshot.lastEventSequence !== snapshot.ledger.eventSequence) {
    throw new AgentCoreError('CHECKPOINT_ERROR', 'RunSnapshot event sequence does not match its ledger')
  }
}

function validateCommit(commit: CheckpointCommit) {
  if (commit.schemaVersion !== RUN_SNAPSHOT_SCHEMA_VERSION) {
    throw new AgentCoreError('CHECKPOINT_ERROR', `Unsupported checkpoint schema version: ${commit.schemaVersion}`)
  }
  if (!commit.runId.trim() || commit.runId !== commit.ledger.runId) {
    throw new AgentCoreError('CHECKPOINT_ERROR', 'Checkpoint run id must match its ledger')
  }
  if (commit.expectedRevision !== null && (!Number.isInteger(commit.expectedRevision) || commit.expectedRevision < 1)) {
    throw new AgentCoreError('CHECKPOINT_ERROR', 'Expected revision must be null or a positive integer')
  }
  for (const effect of commit.effects) validateEffect(commit.runId, effect)
  validateModelAttempts(commit.runId, commit.ledger.modelAttempts)
  validateContextEnvelopes(commit.ledger.contextEnvelopes)
  const keys = commit.effects.map(effectRecordKey)
  if (new Set(keys).size !== keys.length) {
    throw new AgentCoreError('CHECKPOINT_ERROR', 'Effect journal contains duplicate idempotency keys')
  }
}

function validateEvents(runId: string, previousSequence: number, ledgerSequence: number, events: AgentEvent[]) {
  let expected = previousSequence + 1
  for (const event of events) {
    if (event.runId !== runId || event.sequence !== expected || event.id !== `${runId}:${expected}`) {
      throw new AgentCoreError('CHECKPOINT_ERROR', 'Checkpoint events must be contiguous and belong to the run', {
        details: {
          runId,
          expectedSequence: expected,
          actualSequence: event.sequence,
          expectedEventId: `${runId}:${expected}`,
          eventId: event.id,
          eventRunId: event.runId,
        },
      })
    }
    expected += 1
  }
  if (ledgerSequence !== expected - 1) {
    throw new AgentCoreError('CHECKPOINT_ERROR', 'Ledger sequence must equal the last persisted event sequence', {
      details: { ledgerSequence, persistedSequence: expected - 1 },
    })
  }
}

function validateEffect(runId: string, effect: EffectRecord) {
  if (effect.runId !== runId || !effect.toolRequestId || !effect.actionDigest || !effect.backend || !effect.inputHash) {
    throw new AgentCoreError('CHECKPOINT_ERROR', 'Effect record identity and backend fields are required')
  }
  if (!Number.isInteger(effect.attempt) || effect.attempt < 1) {
    throw new AgentCoreError('CHECKPOINT_ERROR', 'Effect attempt must be a positive integer')
  }
  for (const expectation of effect.expectedEffects) {
    if (
      !expectation
      || expectation.kind !== 'file'
      || !expectation.path.trim()
      || (expectation.operation !== 'create' && expectation.operation !== 'modify')
      || (expectation.beforeHash !== null && !expectation.beforeHash.trim())
      || !expectation.afterHash.trim()
    ) {
      throw new AgentCoreError('CHECKPOINT_ERROR', 'Effect contains invalid file recovery evidence')
    }
  }
  if ((effect.status === 'completed' || effect.status === 'failed') && !effect.result) {
    throw new AgentCoreError('CHECKPOINT_ERROR', `${effect.status} effect must include a tool result`)
  }
  if ((effect.status === 'prepared' || effect.status === 'unknown') && effect.result) {
    throw new AgentCoreError('CHECKPOINT_ERROR', `${effect.status} effect cannot include a tool result`)
  }
  if (effect.result && effect.result.requestId !== effect.toolRequestId) {
    throw new AgentCoreError('CHECKPOINT_ERROR', 'Effect result must match its tool request')
  }
  if (effect.status === 'completed' && effect.result?.ok !== true) {
    throw new AgentCoreError('CHECKPOINT_ERROR', 'Completed effect must contain a successful tool result')
  }
  if (effect.status === 'failed' && effect.result?.ok !== false) {
    throw new AgentCoreError('CHECKPOINT_ERROR', 'Failed effect must contain a failed tool result')
  }
}

function validateEffectHistory(previous: EffectRecord[], next: EffectRecord[]) {
  const nextByKey = new Map(next.map((effect) => [effectRecordKey(effect), effect]))
  for (const effect of previous) {
    const candidate = nextByKey.get(effectRecordKey(effect))
    if (!candidate) throw new AgentCoreError('CHECKPOINT_ERROR', 'Effect history cannot remove existing records')
    if (
      candidate.recovery !== effect.recovery
      || candidate.backend !== effect.backend
      || candidate.inputHash !== effect.inputHash
      || candidate.preparedAt !== effect.preparedAt
      || candidate.verificationCheckId !== effect.verificationCheckId
      || JSON.stringify(candidate.expectedEffects) !== JSON.stringify(effect.expectedEffects)
    ) {
      throw new AgentCoreError('CHECKPOINT_ERROR', 'Prepared effect identity and recovery fields are immutable')
    }
    if (effect.status === 'completed' || effect.status === 'failed') {
      if (JSON.stringify(candidate) !== JSON.stringify(effect)) {
        throw new AgentCoreError('CHECKPOINT_ERROR', 'Completed effect records are immutable')
      }
      continue
    }
    const allowed = effect.status === 'prepared'
      ? new Set<EffectStatus>(['prepared', 'completed', 'failed', 'unknown'])
      : new Set<EffectStatus>(['unknown', 'completed', 'failed'])
    if (!allowed.has(candidate.status)) {
      throw new AgentCoreError('CHECKPOINT_ERROR', `Invalid effect transition from ${effect.status} to ${candidate.status}`)
    }
  }
}

function validateModelAttempts(runId: string, attempts: RunSnapshot['ledger']['modelAttempts']) {
  const ids = new Set<string>()
  for (const attempt of attempts) {
    if (
      !attempt.id.trim()
      || !attempt.id.startsWith(`${runId}:`)
      || !attempt.routeId.trim()
      || !attempt.routeRevision.trim()
      || !attempt.contextRevision.trim()
      || !attempt.profileId.trim()
      || !attempt.profileRevision.trim()
      || !attempt.provider.trim()
      || !attempt.model.trim()
      || !Number.isInteger(attempt.attempt)
      || attempt.attempt < 1
      || !Number.isInteger(attempt.inputTokens)
      || attempt.inputTokens < 0
      || !Number.isInteger(attempt.outputTokens)
      || attempt.outputTokens < 0
    ) {
      throw new AgentCoreError('CHECKPOINT_ERROR', 'Model attempt contains invalid identity or usage fields')
    }
    if (ids.has(attempt.id)) throw new AgentCoreError('CHECKPOINT_ERROR', 'Model attempt ids must be unique')
    ids.add(attempt.id)
    if (attempt.outcome === 'succeeded' && (!attempt.acceptedAction || attempt.error)) {
      throw new AgentCoreError('CHECKPOINT_ERROR', 'Successful model attempt must contain an accepted action and no error')
    }
    if (attempt.outcome !== 'succeeded' && (attempt.acceptedAction || !attempt.error)) {
      throw new AgentCoreError('CHECKPOINT_ERROR', 'Failed or cancelled model attempt must contain an error and no accepted action')
    }
  }
}

function validateModelAttemptHistory(
  previous: RunSnapshot['ledger']['modelAttempts'],
  next: RunSnapshot['ledger']['modelAttempts'],
) {
  if (next.length < previous.length) throw new AgentCoreError('CHECKPOINT_ERROR', 'Model attempt history is append-only')
  for (let index = 0; index < previous.length; index += 1) {
    if (JSON.stringify(previous[index]) !== JSON.stringify(next[index])) {
      throw new AgentCoreError('CHECKPOINT_ERROR', 'Persisted model attempts are immutable')
    }
  }
}

function validateContextEnvelopes(envelopes: RunSnapshot['ledger']['contextEnvelopes']) {
  const revisions = new Set<string>()
  for (const envelope of envelopes) {
    if (
      !Number.isInteger(envelope.schemaVersion)
      || envelope.schemaVersion < 1
      || !envelope.revision.trim()
      || !envelope.stablePrefixRevision.trim()
      || !Number.isInteger(envelope.estimatedInputTokens)
      || envelope.estimatedInputTokens < 0
      || !Number.isInteger(envelope.availableInputTokens)
      || envelope.availableInputTokens <= 0
      || envelope.estimatedInputTokens > envelope.availableInputTokens
      || !Number.isInteger(envelope.droppedFragments)
      || envelope.droppedFragments < 0
    ) {
      throw new AgentCoreError('CHECKPOINT_ERROR', 'Context envelope contains invalid revision or budget fields')
    }
    if (revisions.has(envelope.revision)) throw new AgentCoreError('CHECKPOINT_ERROR', 'Context envelope revisions must be unique')
    revisions.add(envelope.revision)
  }
}

function validateContextEnvelopeHistory(
  previous: RunSnapshot['ledger']['contextEnvelopes'],
  next: RunSnapshot['ledger']['contextEnvelopes'],
) {
  if (next.length < previous.length) throw new AgentCoreError('CHECKPOINT_ERROR', 'Context envelope history is append-only')
  for (let index = 0; index < previous.length; index += 1) {
    if (JSON.stringify(previous[index]) !== JSON.stringify(next[index])) {
      throw new AgentCoreError('CHECKPOINT_ERROR', 'Persisted context envelopes are immutable')
    }
  }
}

function validateComponentHistory(previous: RunSnapshot | undefined, next: CheckpointCommit) {
  const keys = ['configSnapshot', 'modelRouteSnapshot', 'toolRegistrySnapshot', 'memorySnapshot'] as const
  for (const key of keys) {
    const candidate = next[key]
    if (candidate && (
      !Number.isInteger(candidate.schemaVersion)
      || candidate.schemaVersion < 1
      || !candidate.revision.trim()
    )) {
      throw new AgentCoreError('CHECKPOINT_ERROR', `${key} requires a positive schema version and revision`)
    }
    const existing = previous?.[key]
    if (existing && JSON.stringify(candidate) !== JSON.stringify(existing)) {
      throw new AgentCoreError('CHECKPOINT_ERROR', `${key} is immutable after the run starts`)
    }
  }
}
