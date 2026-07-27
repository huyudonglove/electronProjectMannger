import { createHash } from 'node:crypto'

import { AgentCoreError, type PromptCachePolicyTemplate } from '@electron-manager/agent-core'

import type {
  PromptArtifact,
  PromptArtifactCache,
  PromptCachePolicyTemplateInput,
  TokenEstimator,
} from './types.js'

export class InMemoryPromptArtifactCache implements PromptArtifactCache {
  readonly #entries = new Map<string, PromptArtifact>()
  readonly #maxEntries: number
  #hits = 0
  #misses = 0

  constructor(maxEntries = 64) {
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) throw new AgentCoreError('INVALID_INPUT', 'Prompt artifact cache size must be a positive integer')
    this.#maxEntries = maxEntries
  }

  get(revision: string): PromptArtifact | undefined {
    const artifact = this.#entries.get(revision)
    if (!artifact) {
      this.#misses += 1
      return undefined
    }
    this.#hits += 1
    this.#entries.delete(revision)
    this.#entries.set(revision, artifact)
    return structuredClone(artifact)
  }

  set(artifact: PromptArtifact) {
    this.#entries.delete(artifact.revision)
    this.#entries.set(artifact.revision, structuredClone(artifact))
    while (this.#entries.size > this.#maxEntries) this.#entries.delete(this.#entries.keys().next().value!)
  }

  stats() {
    return { entries: this.#entries.size, hits: this.#hits, misses: this.#misses }
  }
}

export class CachingTokenEstimator implements TokenEstimator {
  readonly #base: TokenEstimator
  readonly #entries = new Map<string, number>()
  readonly #maxEntries: number

  constructor(base: TokenEstimator, maxEntries = 2_048) {
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) throw new AgentCoreError('INVALID_INPUT', 'Token estimate cache size must be a positive integer')
    this.#base = base
    this.#maxEntries = maxEntries
  }

  estimate(text: string) {
    const key = createHash('sha256').update(text).digest('hex')
    const cached = this.#entries.get(key)
    if (cached !== undefined) {
      this.#entries.delete(key)
      this.#entries.set(key, cached)
      return cached
    }
    const estimated = this.#base.estimate(text)
    this.#entries.set(key, estimated)
    while (this.#entries.size > this.#maxEntries) this.#entries.delete(this.#entries.keys().next().value!)
    return estimated
  }
}

export function createPromptCachePolicyTemplate(input: PromptCachePolicyTemplateInput): PromptCachePolicyTemplate {
  return {
    mode: input.memory.promptCache.mode === 'none'
      ? 'none'
      : input.memory.promptCache.mode === 'explicit'
        ? 'require_explicit'
        : 'prefer',
    promptProfileRevision: input.promptProfileRevision,
    toolRegistryRevision: input.toolRegistryRevision,
    actionSchemaRevision: input.actionSchemaRevision,
    projectRulesRevision: input.projectRulesRevision,
    privacyScopeRevision: input.privacyScopeRevision,
  }
}
