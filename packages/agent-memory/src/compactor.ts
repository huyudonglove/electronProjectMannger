import { createHash } from 'node:crypto'

import { AgentCoreError, type CompactionRecord, type RunLedger, type SessionSummary } from '@electron-manager/agent-core'
import {
  DeterministicTokenEstimator,
  type ContextCompactionInput,
  type ContextCompactionResult,
  type ContextEntry,
  type ContextTrust,
  type TokenEstimator,
} from '@electron-manager/agent-context'

import { SESSION_COMPACTION_SCHEMA_VERSION, type SessionCompactionPolicy, type SessionCompactorOptions } from './types.js'

const MAX_OBSERVATIONS = 8
const MAX_EXCERPT_CHARS = 160
const MAX_FACTS = 12

export class DeterministicSessionCompactor {
  readonly #policy: SessionCompactionPolicy
  readonly #estimator: TokenEstimator

  constructor(options: SessionCompactorOptions) {
    validatePolicy(options.policy)
    this.#policy = structuredClone(options.policy)
    this.#estimator = options.tokenEstimator || new DeterministicTokenEstimator()
  }

  compact(input: ContextCompactionInput): ContextCompactionResult {
    const latest = input.ledger.compactions.at(-1)
    const active = restoreActiveEntries(input.entries, latest, input.budget.regionTokens.compacted_history, this.#estimator)
    const beforeTokens = sumTokens(active)
    if (beforeTokens < this.#policy.warningTokens) return this.#unchanged(active, 'healthy', beforeTokens, latest?.revision)
    if (beforeTokens < this.#policy.compactTokens) return this.#unchanged(active, 'warning', beforeTokens, latest?.revision)

    const candidates = active
      .filter((entry) => entry.compressible && (entry.region === 'compacted_history' || entry.region === 'recent_dynamic_context'))
      .sort(oldestFirst)
    const selected: ContextEntry[] = []
    let summary = buildSummary(input.ledger, latest, selected)
    let summaryTokens = this.#estimator.estimate(summaryContent(summary))
    let afterTokens = beforeTokens

    for (const candidate of candidates) {
      selected.push(candidate)
      summary = buildSummary(input.ledger, latest, selected)
      summaryTokens = this.#estimator.estimate(summaryContent(summary))
      afterTokens = beforeTokens - sumTokens(selected) + summaryTokens
      if (afterTokens <= this.#policy.targetTokens) break
    }

    if (selected.length === 0 || afterTokens >= beforeTokens) {
      if (beforeTokens >= this.#policy.hardStopTokens) this.#hardStop(beforeTokens, afterTokens, selected.length)
      return this.#unchanged(active, 'warning', beforeTokens, latest?.revision)
    }
    if (afterTokens >= this.#policy.hardStopTokens) this.#hardStop(beforeTokens, afterTokens, selected.length)

    const selectedIds = selected.map((entry) => entry.id)
    const selectedSet = new Set(selectedIds)
    const sourceRefs = uniqueSorted(selected.flatMap((entry) => entry.sourceRefs))
    summary = { ...summary, sourceRefs }
    const compactedHistoryRevision = hash(canonicalJson(summary))
    const sourceHash = hash(canonicalJson(selected.map(sourceIdentity)))
    const coveredFragmentIds = uniqueSorted([
      ...(latest?.coveredFragmentIds ?? []),
      ...selectedIds.filter((id) => id !== latest?.summaryFragmentId),
    ])
    const retained = active.filter((entry) => !selectedSet.has(entry.id))
    const trigger = beforeTokens >= this.#policy.hardStopTokens ? 'hard_stop' : 'compact_threshold'
    const revision = hash(canonicalJson({
      runId: input.runId,
      policyRevision: this.#policy.revision,
      trigger,
      sourceHash,
      compactedHistoryRevision,
      coveredFragmentIds,
      targetTokens: this.#policy.targetTokens,
      hardStopTokens: this.#policy.hardStopTokens,
    }))
    const summaryFragmentId = `compaction-summary-${revision.slice(0, 16)}`
    const summaryEntry = createSummaryEntry(
      summaryFragmentId,
      revision,
      summary,
      summaryTokens,
      selected,
      input.budget.regionTokens.compacted_history,
    )
    const entries = [...retained, summaryEntry]
    afterTokens = sumTokens(entries)
    if (afterTokens >= this.#policy.hardStopTokens) this.#hardStop(beforeTokens, afterTokens, selected.length)

    const record: CompactionRecord = {
      schemaVersion: SESSION_COMPACTION_SCHEMA_VERSION,
      id: `${input.runId}:compaction:${input.ledger.compactions.length + 1}`,
      revision,
      runId: input.runId,
      strategy: 'deterministic',
      trigger,
      policyRevision: this.#policy.revision,
      beforeTokens,
      afterTokens,
      targetTokens: this.#policy.targetTokens,
      warningTokens: this.#policy.warningTokens,
      compactTokens: this.#policy.compactTokens,
      hardStopTokens: this.#policy.hardStopTokens,
      sourceHash,
      sourceRefs,
      replacedFragmentIds: selectedIds,
      coveredFragmentIds,
      retainedFragmentIds: retained.map((entry) => entry.id).sort(),
      summaryFragmentId,
      compactedHistoryRevision,
      summary,
      createdAt: input.ledger.updatedAt,
      fallbackReason: 'deterministic_first_stage',
    }
    return {
      entries,
      compaction: record,
      compactionRevision: revision,
      pressure: {
        level: 'compacted',
        beforeTokens,
        afterTokens,
        warningTokens: this.#policy.warningTokens,
        compactTokens: this.#policy.compactTokens,
        hardStopTokens: this.#policy.hardStopTokens,
      },
    }
  }

  #unchanged(
    entries: ContextEntry[],
    level: 'healthy' | 'warning',
    tokens: number,
    compactionRevision?: string,
  ): ContextCompactionResult {
    return {
      entries,
      ...(compactionRevision ? { compactionRevision } : {}),
      pressure: {
        level,
        beforeTokens: tokens,
        afterTokens: tokens,
        warningTokens: this.#policy.warningTokens,
        compactTokens: this.#policy.compactTokens,
        hardStopTokens: this.#policy.hardStopTokens,
      },
    }
  }

  #hardStop(beforeTokens: number, afterTokens: number, candidates: number): never {
    throw new AgentCoreError('CONTEXT_BUDGET_EXCEEDED', 'Session context remains above the hard-stop after deterministic compaction', {
      details: {
        beforeTokens,
        afterTokens,
        hardStopTokens: this.#policy.hardStopTokens,
        selectedFragments: candidates,
        policyRevision: this.#policy.revision,
      },
    })
  }
}

function restoreActiveEntries(
  entries: ContextEntry[],
  latest: CompactionRecord | undefined,
  compactedHistoryBudget: number,
  estimator: TokenEstimator,
) {
  if (!latest) return structuredClone(entries)
  const covered = new Set(latest.coveredFragmentIds)
  const active = entries.filter((entry) => !covered.has(entry.id)).map((entry) => structuredClone(entry))
  const content = summaryContent(latest.summary)
  active.push(createSummaryEntry(
    latest.summaryFragmentId,
    latest.revision,
    latest.summary,
    estimator.estimate(content),
    [],
    compactedHistoryBudget,
  ))
  return active
}

function createSummaryEntry(
  id: string,
  sourceRevision: string,
  summary: SessionSummary,
  estimatedTokens: number,
  selected: ContextEntry[],
  maxTokens: number,
): ContextEntry {
  return {
    id,
    role: 'user',
    content: summaryContent(summary),
    sourceRefs: [...summary.sourceRefs],
    sequence: 0,
    sourceId: 'builtin.session-compactor',
    sourceRevision,
    region: 'compacted_history',
    scope: 'session',
    trust: summaryTrust(selected, summary),
    priority: 85,
    required: true,
    compressible: true,
    maxTokens,
    estimatedTokens,
  }
}

function buildSummary(ledger: RunLedger, latest: CompactionRecord | undefined, selected: ContextEntry[]): SessionSummary {
  const observations = [...(latest?.summary.observations ?? [])]
  for (const entry of selected) {
    if (entry.sourceId === 'builtin.session-compactor') continue
    observations.push({
      sourceId: entry.sourceId,
      trust: entry.trust,
      sourceRefs: [...entry.sourceRefs].sort(),
      excerpt: boundedExcerpt(entry.content),
    })
  }
  const deduplicated = new Map(observations.map((observation) => [
    `${observation.sourceId}\u0000${observation.sourceRefs.join('\u0000')}\u0000${observation.excerpt}`,
    observation,
  ]))
  const sourceRefs = uniqueSorted(selected.flatMap((entry) => entry.sourceRefs))
  return {
    objective: ledger.objective,
    knownFacts: [
      ...ledger.inspectedFiles.map((item) => `inspected:${item.path}@${item.hash}`),
      ...ledger.changes.map((item) => `changed:${item.operation}:${item.path}${item.afterHash ? `@${item.afterHash}` : ''}`),
      ...ledger.verifications.map((item) => `verification:${item.checkId}:${item.status}`),
    ].slice(-MAX_FACTS),
    decisions: ledger.decisions.map((item) => item.summary).slice(-MAX_FACTS),
    failures: ledger.failures.map((item) => item.error.message).slice(-MAX_FACTS),
    unresolved: [
      ...ledger.acceptanceCriteria
        .filter((criterion) => criterion.required !== false && !ledger.acceptanceEvidence.some((item) => item.criterionId === criterion.id && item.passed))
        .map((criterion) => criterion.description),
      ...(ledger.pendingAction ? [ledger.pendingAction.summary] : []),
    ].slice(-MAX_FACTS),
    observations: [...deduplicated.values()].slice(-MAX_OBSERVATIONS),
    sourceRefs,
    ...(ledger.nextAction ? { nextAction: ledger.nextAction } : {}),
  }
}

function summaryContent(summary: SessionSummary) {
  return canonicalJson({
    kind: 'deterministic_session_summary',
    objective: summary.objective,
    knownFacts: summary.knownFacts,
    decisions: summary.decisions,
    failures: summary.failures,
    unresolved: summary.unresolved,
    observations: summary.observations,
    sourceRefCount: summary.sourceRefs.length,
    nextAction: summary.nextAction,
  })
}

function summaryTrust(selected: ContextEntry[], summary: SessionSummary): ContextTrust {
  if (selected.some((entry) => entry.trust === 'untrusted') || summary.observations.some((item) => item.trust === 'untrusted')) return 'untrusted'
  if (selected.some((entry) => entry.trust === 'trusted_project')) return 'trusted_project'
  return 'trusted_run'
}

function sourceIdentity(entry: ContextEntry) {
  return {
    id: entry.id,
    sourceId: entry.sourceId,
    sourceRevision: entry.sourceRevision,
    trust: entry.trust,
    sourceRefs: entry.sourceRefs,
    content: entry.content,
  }
}

function oldestFirst(left: ContextEntry, right: ContextEntry) {
  if (left.region !== right.region) return left.region === 'compacted_history' ? -1 : 1
  return (left.sequence! - right.sequence!) || left.sourceId.localeCompare(right.sourceId) || left.id.localeCompare(right.id)
}

function boundedExcerpt(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim()
  return normalized.length <= MAX_EXCERPT_CHARS ? normalized : `${normalized.slice(0, MAX_EXCERPT_CHARS - 1)}…`
}

function sumTokens(entries: ContextEntry[]) {
  return entries.reduce((total, entry) => total + entry.estimatedTokens, 0)
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort()
}

function validatePolicy(policy: SessionCompactionPolicy) {
  if (!policy.revision.trim()
    || !Number.isInteger(policy.targetTokens)
    || !Number.isInteger(policy.warningTokens)
    || !Number.isInteger(policy.compactTokens)
    || !Number.isInteger(policy.hardStopTokens)
    || policy.targetTokens <= 0
    || policy.targetTokens >= policy.warningTokens
    || policy.warningTokens >= policy.compactTokens
    || policy.compactTokens >= policy.hardStopTokens) {
    throw new AgentCoreError('INVALID_INPUT', 'Compaction policy must satisfy target < warning < compact < hard-stop')
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}
