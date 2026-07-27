import { createHash } from 'node:crypto'

import { AgentCoreError, type JsonValue, type ModelMessage } from '@electron-manager/agent-core'

import { DeterministicTokenEstimator } from './estimator.js'
import {
  CONTEXT_ENVELOPE_SCHEMA_VERSION,
  CONTEXT_REGIONS,
  type ContextAssemblerOptions,
  type ContextBudget,
  type ContextCollectionInput,
  type ContextDrop,
  type ContextEntry,
  type ContextEnvelope,
  type ContextFragment,
  type ContextRegion,
  type ContextSource,
  type TokenEstimator,
} from './types.js'

const regionRank = new Map<ContextRegion, number>(CONTEXT_REGIONS.map((region, index) => [region, index]))

export class ContextAssembler {
  readonly #registry: ContextAssemblerOptions['registry']
  readonly #budget: ContextBudget
  readonly #estimator: TokenEstimator
  readonly #compactor?: ContextAssemblerOptions['compactor']
  readonly #artifactCache?: ContextAssemblerOptions['artifactCache']

  constructor(options: ContextAssemblerOptions) {
    validateBudget(options.budget)
    this.#registry = options.registry
    this.#budget = structuredClone(options.budget)
    this.#estimator = options.tokenEstimator || new DeterministicTokenEstimator()
    this.#compactor = options.compactor
    this.#artifactCache = options.artifactCache
  }

  async assemble(input: ContextCollectionInput): Promise<ContextEnvelope> {
    const sources = this.#registry.sources()
    const collected = await Promise.all(sources.map(async (source) => ({
      source,
      fragments: await source.collect({
        runId: input.runId,
        ledger: structuredClone(input.ledger),
        tools: input.tools.map((tool) => structuredClone(tool)),
      }),
    })))
    const collectedEntries = collected.flatMap(({ source, fragments }) => this.#entries(source, fragments))
    validateEntries(collected, collectedEntries)
    const compaction = this.#compactor
      ? await this.#compactor.compact({
        runId: input.runId,
        ledger: structuredClone(input.ledger),
        tools: input.tools.map((tool) => structuredClone(tool)),
        entries: structuredClone(collectedEntries),
        budget: structuredClone(this.#budget),
      })
      : {
        entries: collectedEntries,
        pressure: {
          level: 'healthy' as const,
          beforeTokens: sumTokens(collectedEntries),
          afterTokens: sumTokens(collectedEntries),
        },
      }
    const entries = compaction.entries
    validateCompactedEntries(collectedEntries, entries)

    const available = this.#budget.maxInputTokens - this.#budget.reservedOutputTokens
    const selected: ContextEntry[] = []
    const dropped: ContextDrop[] = []
    const sourceUsage = new Map<string, number>()
    const regionUsage = new Map<ContextRegion, number>(CONTEXT_REGIONS.map((region) => [region, 0]))
    let total = 0

    const required = entries.filter((entry) => entry.required).sort(finalOrder)
    for (const entry of required) {
      const failure = budgetFailure(entry, sourceUsage, regionUsage, total, available, this.#budget)
      if (failure) {
        throw new AgentCoreError('CONTEXT_BUDGET_EXCEEDED', `Required context exceeds ${failure.replace('_', ' ')}: ${entry.sourceId}/${entry.id}`, {
          details: {
            sourceId: entry.sourceId,
            fragmentId: entry.id,
            reason: failure,
            estimatedTokens: entry.estimatedTokens,
          },
        })
      }
      total = select(entry, selected, sourceUsage, regionUsage, total)
    }

    const optional = entries.filter((entry) => !entry.required).sort(selectionOrder)
    for (const entry of optional) {
      const failure = budgetFailure(entry, sourceUsage, regionUsage, total, available, this.#budget)
      if (failure) {
        dropped.push({
          sourceId: entry.sourceId,
          fragmentId: entry.id,
          estimatedTokens: entry.estimatedTokens,
          reason: failure,
        })
        continue
      }
      total = select(entry, selected, sourceUsage, regionUsage, total)
    }

    const regions = Object.fromEntries(CONTEXT_REGIONS.map((region) => [
      region,
      selected.filter((entry) => entry.region === region).sort(finalOrder),
    ])) as Record<ContextRegion, ContextEntry[]>
    if (regions.newest_message.length !== 1) {
      throw new AgentCoreError('INVALID_INPUT', 'ContextEnvelope requires exactly one newest_message')
    }
    const stableData = jsonValue({
      stable_system_prefix: regions.stable_system_prefix,
      stable_capability_prefix: regions.stable_capability_prefix,
    })
    const revisionData = jsonValue({
      runId: input.runId,
      budget: this.#budget,
      regions,
    })
    const revision = hash(canonicalJson(revisionData))
    const stablePrefixRevision = hash(canonicalJson(stableData))
    const generatedStableMessages = [
      ...regions.stable_system_prefix.map(toMessage),
      ...regions.stable_capability_prefix.map(toMessage),
    ]
    const cachedArtifact = this.#artifactCache?.get(stablePrefixRevision)
    if (cachedArtifact && (
      cachedArtifact.revision !== stablePrefixRevision
      || JSON.stringify(cachedArtifact.messages) !== JSON.stringify(generatedStableMessages)
    )) {
      throw new AgentCoreError('INVALID_INPUT', 'Prompt artifact cache returned content that does not match the stable prefix revision')
    }
    const localArtifactCacheHit = Boolean(cachedArtifact)
    if (!cachedArtifact) {
      this.#artifactCache?.set({
        revision: stablePrefixRevision,
        messages: generatedStableMessages,
        estimatedTokens: sumTokens([...regions.stable_system_prefix, ...regions.stable_capability_prefix]),
      })
    }
    const stableMessages = cachedArtifact?.messages ?? generatedStableMessages
    const messages = [
      ...stableMessages.map((message) => structuredClone(message)),
      ...regions.compacted_history.map(toMessage),
      ...regions.recent_dynamic_context.map(toMessage),
      ...regions.newest_message.map(toMessage),
    ]
    const compactionRevision = compaction.compaction?.revision ?? compaction.compactionRevision
    if (compaction.compaction && compaction.compactionRevision && compaction.compaction.revision !== compaction.compactionRevision) {
      throw new AgentCoreError('INVALID_INPUT', 'Context compaction result contains conflicting revisions')
    }
    const sourceRevisions = Object.fromEntries(
      [...new Map(selected.map((entry) => [entry.sourceId, entry.sourceRevision])).entries()]
        .sort(([left], [right]) => left.localeCompare(right)),
    )
    return {
      schemaVersion: CONTEXT_ENVELOPE_SCHEMA_VERSION,
      runId: input.runId,
      revision,
      stablePrefixRevision,
      regions,
      messages,
      budget: {
        ...structuredClone(this.#budget),
        availableInputTokens: available,
        usedInputTokens: total,
        remainingInputTokens: available - total,
      },
      dropped: dropped.sort((left, right) => left.sourceId.localeCompare(right.sourceId) || left.fragmentId.localeCompare(right.fragmentId)),
      pressure: structuredClone(compaction.pressure),
      localArtifactCacheHit,
      ...(compaction.compaction ? { compaction: structuredClone(compaction.compaction) } : {}),
      snapshot: {
        schemaVersion: CONTEXT_ENVELOPE_SCHEMA_VERSION,
        revision,
        stablePrefixRevision,
        estimatedInputTokens: total,
        availableInputTokens: available,
        sourceRevisions,
        droppedFragments: dropped.length,
        pressureLevel: compaction.pressure.level,
        localArtifactCacheHit,
        ...(compactionRevision ? { compactionRevision } : {}),
      },
    }
  }

  #entries(source: ContextSource, fragments: ContextFragment[]): ContextEntry[] {
    return fragments.map((fragment) => ({
      ...structuredClone(fragment),
      sourceId: source.descriptor.id,
      sourceRevision: source.descriptor.revision,
      region: source.descriptor.region,
      scope: source.descriptor.scope,
      trust: source.descriptor.trust,
      priority: source.descriptor.priority,
      required: source.descriptor.required,
      compressible: source.descriptor.compressible,
      maxTokens: source.descriptor.maxTokens,
      estimatedTokens: this.#estimator.estimate(fragment.content),
    }))
  }
}

function validateCompactedEntries(original: ContextEntry[], entries: ContextEntry[]) {
  const ids = new Set<string>()
  for (const entry of entries) {
    validateEntryShape(entry)
    if (ids.has(entry.id)) throw new AgentCoreError('INVALID_INPUT', `Duplicate compacted context fragment: ${entry.id}`)
    ids.add(entry.id)
  }
  if (entries.filter((entry) => entry.region === 'newest_message').length !== 1) {
    throw new AgentCoreError('INVALID_INPUT', 'Context compaction must preserve exactly one newest_message')
  }
  const compactedById = new Map(entries.map((entry) => [entry.id, entry]))
  for (const entry of original.filter((candidate) => !candidate.compressible)) {
    if (JSON.stringify(compactedById.get(entry.id)) !== JSON.stringify(entry)) {
      throw new AgentCoreError('INVALID_INPUT', `Context compaction cannot remove or modify protected context: ${entry.id}`)
    }
  }
  const originalIds = new Set(original.map((entry) => entry.id))
  for (const entry of entries) {
    if (!originalIds.has(entry.id) && entry.region !== 'compacted_history') {
      throw new AgentCoreError('INVALID_INPUT', `Compaction output must place replacement context in compacted_history: ${entry.id}`)
    }
  }
}

function sumTokens(entries: ContextEntry[]) {
  return entries.reduce((total, entry) => total + entry.estimatedTokens, 0)
}

export function assertAppendOnlyContext(previous: ContextEnvelope, next: ContextEnvelope) {
  if (previous.runId !== next.runId) throw new AgentCoreError('INVALID_INPUT', 'Context transition must stay within one run')
  if (previous.stablePrefixRevision !== next.stablePrefixRevision) {
    throw new AgentCoreError('INVALID_INPUT', 'Stable context prefix changed during an append-only transition')
  }
  const previousDynamic = [...previous.regions.recent_dynamic_context, ...previous.regions.newest_message].map(entryKey)
  const nextDynamic = [...next.regions.recent_dynamic_context, ...next.regions.newest_message].map(entryKey)
  if (nextDynamic.length <= previousDynamic.length) {
    throw new AgentCoreError('INVALID_INPUT', 'Append-only context transition requires a newer message')
  }
  for (let index = 0; index < previousDynamic.length; index += 1) {
    if (previousDynamic[index] !== nextDynamic[index]) {
      throw new AgentCoreError('INVALID_INPUT', 'Recent context messages cannot be reordered or inserted into history')
    }
  }
  const newest = next.regions.newest_message[0]!
  const preceding = [...next.regions.compacted_history, ...next.regions.recent_dynamic_context]
  if (newest.sequence === undefined || preceding.some((entry) => entry.sequence !== undefined && entry.sequence >= newest.sequence!)) {
    throw new AgentCoreError('INVALID_INPUT', 'The newest message must have the greatest sequence and remain at the bottom')
  }
}

function validateBudget(budget: ContextBudget) {
  if (!Number.isInteger(budget.maxInputTokens) || !Number.isInteger(budget.reservedOutputTokens)
    || budget.maxInputTokens <= 0 || budget.reservedOutputTokens < 0
    || budget.reservedOutputTokens >= budget.maxInputTokens) {
    throw new AgentCoreError('INVALID_INPUT', 'Context input and reserved output budgets are invalid')
  }
  for (const region of CONTEXT_REGIONS) {
    const value = budget.regionTokens[region]
    if (!Number.isInteger(value) || value <= 0) {
      throw new AgentCoreError('INVALID_INPUT', `Context region budget must be a positive integer: ${region}`)
    }
  }
}

function validateEntries(
  collected: Array<{ source: ContextSource; fragments: ContextFragment[] }>,
  entries: ContextEntry[],
) {
  const keys = new Set<string>()
  for (const { source, fragments } of collected) {
    if (source.descriptor.required && fragments.length === 0) {
      throw new AgentCoreError('INVALID_INPUT', `Required context source returned no fragments: ${source.descriptor.id}`)
    }
  }
  for (const entry of entries) {
    const key = entry.id
    validateEntryShape(entry)
    if (keys.has(key)) throw new AgentCoreError('INVALID_INPUT', `Duplicate context fragment: ${key}`)
    keys.add(key)
  }
  if (entries.filter((entry) => entry.region === 'newest_message').length !== 1) {
    throw new AgentCoreError('INVALID_INPUT', 'Exactly one newest_message fragment must be collected')
  }
}

function validateEntryShape(entry: ContextEntry) {
  const key = entry.id
  if (!entry.id.trim() || !entry.content.trim()) throw new AgentCoreError('INVALID_INPUT', `Context fragment id and content are required: ${key}`)
  if (entry.region === 'stable_system_prefix' || entry.region === 'stable_capability_prefix') {
    if (entry.sequence !== undefined) throw new AgentCoreError('INVALID_INPUT', `Stable context cannot declare a sequence: ${key}`)
  } else if (!Number.isInteger(entry.sequence) || entry.sequence! < 0) {
    throw new AgentCoreError('INVALID_INPUT', `Dynamic context requires a non-negative sequence: ${key}`)
  }
  if (entry.role === 'tool' && !entry.toolRequestId?.trim()) {
    throw new AgentCoreError('INVALID_INPUT', `Tool context requires toolRequestId: ${key}`)
  }
}

function budgetFailure(
  entry: ContextEntry,
  sourceUsage: Map<string, number>,
  regionUsage: Map<ContextRegion, number>,
  total: number,
  available: number,
  budget: ContextBudget,
): ContextDrop['reason'] | undefined {
  if ((sourceUsage.get(entry.sourceId) ?? 0) + entry.estimatedTokens > entry.maxTokens) return 'source_budget'
  if ((regionUsage.get(entry.region) ?? 0) + entry.estimatedTokens > budget.regionTokens[entry.region]) return 'region_budget'
  if (total + entry.estimatedTokens > available) return 'total_budget'
  return undefined
}

function select(
  entry: ContextEntry,
  selected: ContextEntry[],
  sourceUsage: Map<string, number>,
  regionUsage: Map<ContextRegion, number>,
  total: number,
) {
  selected.push(entry)
  sourceUsage.set(entry.sourceId, (sourceUsage.get(entry.sourceId) ?? 0) + entry.estimatedTokens)
  regionUsage.set(entry.region, (regionUsage.get(entry.region) ?? 0) + entry.estimatedTokens)
  return total + entry.estimatedTokens
}

function selectionOrder(left: ContextEntry, right: ContextEntry) {
  return right.priority - left.priority
    || (regionRank.get(left.region)! - regionRank.get(right.region)!)
    || left.sourceId.localeCompare(right.sourceId)
    || left.id.localeCompare(right.id)
}

function finalOrder(left: ContextEntry, right: ContextEntry) {
  const regionDifference = regionRank.get(left.region)! - regionRank.get(right.region)!
  if (regionDifference) return regionDifference
  if (left.region === 'stable_system_prefix' || left.region === 'stable_capability_prefix') {
    return left.sourceId.localeCompare(right.sourceId) || left.id.localeCompare(right.id)
  }
  return (left.sequence! - right.sequence!) || left.sourceId.localeCompare(right.sourceId) || left.id.localeCompare(right.id)
}

function toMessage(entry: ContextEntry): ModelMessage {
  return {
    role: entry.role,
    content: entry.content,
    ...(entry.toolRequestId ? { toolRequestId: entry.toolRequestId } : {}),
  }
}

function entryKey(entry: Pick<ContextEntry, 'sourceId' | 'id'>) {
  return entry.id
}

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
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
