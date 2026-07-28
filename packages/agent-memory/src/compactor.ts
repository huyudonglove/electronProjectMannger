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

import {
  SESSION_COMPACTION_SCHEMA_VERSION,
  type ModelBackedSessionCompactorOptions,
  type SessionCompactionPolicy,
  type SessionCompactorOptions,
  SessionSummarizerError,
  type SessionSummarizerDiagnostic,
} from './types.js'

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

export class ModelBackedSessionCompactor {
  readonly #deterministic: DeterministicSessionCompactor
  readonly #summarizer: ModelBackedSessionCompactorOptions['summarizer']
  readonly #estimator: TokenEstimator
  readonly #onDiagnostic?: ModelBackedSessionCompactorOptions['onDiagnostic']
  readonly #diagnostics: SessionSummarizerDiagnostic[] = []

  constructor(options: ModelBackedSessionCompactorOptions) {
    this.#deterministic = new DeterministicSessionCompactor(options)
    this.#summarizer = options.summarizer
    this.#estimator = options.tokenEstimator || new DeterministicTokenEstimator()
    this.#onDiagnostic = options.onDiagnostic
  }

  diagnostics() {
    return structuredClone(this.#diagnostics)
  }

  async compact(input: ContextCompactionInput): Promise<ContextCompactionResult> {
    const fallback = this.#deterministic.compact(input)
    const deterministicRecord = fallback.compaction
    if (!deterministicRecord) return fallback
    let attempted: Omit<SessionSummarizerDiagnostic, 'runId' | 'outcome' | 'reason'> | undefined
    try {
      const candidate = await this.#summarizer.summarize({
        runId: input.runId,
        objective: input.ledger.objective,
        sourceRefs: [...deterministicRecord.sourceRefs],
        observations: structuredClone(deterministicRecord.summary.observations),
        deterministicSummary: structuredClone(deterministicRecord.summary),
      })
      attempted = {
        routeId: candidate.routeId,
        routeRevision: candidate.routeRevision,
        attemptCount: candidate.attemptCount,
        usage: structuredClone(candidate.usage),
      }
      const summary = validatedModelSummary(deterministicRecord.summary, candidate.summary)
      const result = modelCompaction(
        { ...fallback, compaction: deterministicRecord },
        summary,
        candidate.routeId,
        candidate.routeRevision,
        this.#estimator,
      )
      await this.#recordDiagnostic({
        runId: input.runId,
        outcome: 'succeeded',
        routeId: candidate.routeId,
        routeRevision: candidate.routeRevision,
        attemptCount: candidate.attemptCount,
        usage: structuredClone(candidate.usage),
      })
      return result
    } catch (error) {
      const reason = safeErrorMessage(error)
      const failed = error instanceof SessionSummarizerError ? error.diagnostic : attempted
      await this.#recordDiagnostic({
        runId: input.runId,
        outcome: 'fallback',
        ...(failed?.routeId ? { routeId: failed.routeId } : {}),
        ...(failed?.routeRevision ? { routeRevision: failed.routeRevision } : {}),
        attemptCount: failed?.attemptCount ?? 0,
        usage: structuredClone(failed?.usage ?? { inputTokens: 0, outputTokens: 0 }),
        reason,
      })
      return {
        ...fallback,
        compaction: {
          ...deterministicRecord,
          fallbackReason: `summarizer_failed:${reason}`,
        },
      }
    }
  }

  async #recordDiagnostic(diagnostic: SessionSummarizerDiagnostic) {
    this.#diagnostics.push(structuredClone(diagnostic))
    try {
      await this.#onDiagnostic?.(structuredClone(diagnostic))
    } catch {
      // Diagnostics must never change compaction correctness or fallback behavior.
    }
  }
}

function validatedModelSummary(baseline: SessionSummary, candidate: SessionSummary): SessionSummary {
  if (!candidate || !Array.isArray(candidate.observations) || candidate.observations.length > MAX_OBSERVATIONS) {
    throw new AgentCoreError('INVALID_INPUT', 'Summarizer returned an invalid observations list')
  }
  const allowedRefs = new Set(baseline.sourceRefs)
  const baselineTrust = new Map(baseline.observations.flatMap((observation) =>
    observation.sourceRefs.map((sourceRef) => [sourceRef, observation.trust] as const)))
  const observations = candidate.observations.map((observation) => {
    if (!observation.sourceId?.trim() || !observation.excerpt?.trim() || !Array.isArray(observation.sourceRefs) || !observation.sourceRefs.length) {
      throw new AgentCoreError('INVALID_INPUT', 'Summarizer observation is missing source identity')
    }
    if (observation.sourceRefs.some((sourceRef) => !allowedRefs.has(sourceRef))) {
      throw new AgentCoreError('INVALID_INPUT', 'Summarizer observation references unknown source material')
    }
    const trusts = observation.sourceRefs.map((sourceRef) => baselineTrust.get(sourceRef)).filter(Boolean) as ContextTrust[]
    const trust: ContextTrust = trusts.includes('untrusted')
      ? 'untrusted'
      : trusts.includes('trusted_project')
        ? 'trusted_project'
        : 'trusted_run'
    return {
      sourceId: observation.sourceId.trim(),
      trust,
      sourceRefs: uniqueSorted(observation.sourceRefs),
      excerpt: boundedExcerpt(observation.excerpt),
    }
  })
  return {
    objective: baseline.objective,
    knownFacts: [...baseline.knownFacts],
    decisions: [...baseline.decisions],
    failures: [...baseline.failures],
    unresolved: [...baseline.unresolved],
    observations,
    sourceRefs: [...baseline.sourceRefs],
    ...(baseline.nextAction ? { nextAction: baseline.nextAction } : {}),
  }
}

function modelCompaction(
  fallback: ContextCompactionResult & { compaction: CompactionRecord },
  summary: SessionSummary,
  routeId: string,
  routeRevision: string,
  estimator: TokenEstimator,
): ContextCompactionResult {
  if (!routeId.trim() || !routeRevision.trim()) throw new AgentCoreError('INVALID_INPUT', 'Summarizer route identity is required')
  const compactedHistoryRevision = hash(canonicalJson(summary))
  const revision = hash(canonicalJson({
    baseRevision: fallback.compaction.revision,
    strategy: 'model',
    routeId,
    routeRevision,
    compactedHistoryRevision,
  }))
  const summaryFragmentId = `compaction-summary-${revision.slice(0, 16)}`
  const content = summaryContent(summary)
  const estimatedTokens = estimator.estimate(content)
  const originalSummary = fallback.entries.find((entry) => entry.id === fallback.compaction.summaryFragmentId)
  if (!originalSummary) throw new AgentCoreError('INVALID_INPUT', 'Deterministic compaction summary entry is missing')
  const summaryEntry = {
    ...originalSummary,
    id: summaryFragmentId,
    content,
    sourceRefs: [...summary.sourceRefs],
    sourceRevision: revision,
    estimatedTokens,
    trust: summaryTrust([], summary),
  }
  const entries = fallback.entries.map((entry) => entry.id === fallback.compaction!.summaryFragmentId ? summaryEntry : entry)
  const afterTokens = sumTokens(entries)
  if (afterTokens >= fallback.compaction.hardStopTokens) {
    throw new AgentCoreError('CONTEXT_BUDGET_EXCEEDED', 'Model summary remains above the hard-stop; using deterministic fallback')
  }
  return {
    entries,
    compactionRevision: revision,
    pressure: { ...fallback.pressure, afterTokens },
    compaction: {
      ...fallback.compaction,
      revision,
      strategy: 'model',
      afterTokens,
      retainedFragmentIds: fallback.compaction.retainedFragmentIds,
      summaryFragmentId,
      compactedHistoryRevision,
      summary,
      fallbackReason: undefined,
    },
  }
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
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
