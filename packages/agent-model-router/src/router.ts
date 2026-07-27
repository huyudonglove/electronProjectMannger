import {
  AgentCoreError,
  parseAgentTurnAction,
  type ModelAttemptRecord,
  type ModelCapabilityProfile,
  type ModelProvider,
  type ModelRequest,
  type ModelStreamEvent,
  type NormalizedProviderError,
} from '@electron-manager/agent-core'

import { budgetError, invalidOutputError, normalizeProviderError, timeoutError, toModelStreamError } from './errors.js'
import { bindPromptCacheRequest } from './cache.js'
import { createModelRouteSnapshot } from './snapshot.js'
import type { BufferedModelAttempt, ModelProviderBinding, ModelRouteSnapshot, ModelRouterOptions } from './types.js'

export class ModelRouter implements ModelProvider {
  readonly profile: ModelCapabilityProfile
  readonly #route: ModelRouterOptions['route']
  readonly #bindings: ModelProviderBinding[]
  readonly #clock: () => string
  readonly #now: () => number

  constructor(options: ModelRouterOptions) {
    this.#route = structuredClone(options.route)
    this.#bindings = [this.#route.primary, ...this.#route.fallbacks]
      .map((profile) => options.registry.resolve(profile.id))
    this.#clock = options.clock || (() => new Date().toISOString())
    this.#now = options.now || (() => Date.now())
    this.profile = routedCapabilityProfile(this.#route.route.id, this.#route.route.revision, this.#bindings)
  }

  snapshot(): ModelRouteSnapshot {
    return createModelRouteSnapshot(this.#route, this.#bindings)
  }

  async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelStreamEvent> {
    const policy = this.#route.route.retry
    const candidates = Array.from(
      { length: policy.maxAttempts },
      (_, index) => this.#bindings[index % this.#bindings.length]!,
    )
    const routeStarted = this.#now()
    let inputTokens = 0
    let outputTokens = 0
    let cachedInputTokens = 0
    let cacheWriteTokens = 0
    let reasoningTokens = 0
    let lastAttempt: BufferedModelAttempt | undefined

    if (!request.turnId.trim() || !request.turnId.startsWith(`${request.runId}:`) || !request.contextRevision.trim()) {
      const error = normalizeProviderError(new AgentCoreError('INVALID_INPUT', 'Model turn id and context revision must be valid', {
        details: { runId: request.runId, turnId: request.turnId, contextRevision: request.contextRevision },
      }))
      yield { type: 'error', error: toModelStreamError(error, this.#route.route.id, this.#route.primary.id, 0) }
      return
    }

    if (signal?.aborted) {
      const error = normalizeProviderError(new AgentCoreError('CANCELLED', 'Model route was cancelled', { cause: signal.reason }))
      yield { type: 'error', error: toModelStreamError(error, this.#route.route.id, this.#route.primary.id, 0) }
      return
    }

    for (let index = 0; index < candidates.length; index += 1) {
      const binding = candidates[index]!
      const elapsed = this.#now() - routeStarted
      const remainingMs = policy.totalTimeoutMs - elapsed
      if (remainingMs <= 0) {
        const error = timeoutError('Model route total timeout was exhausted before the next attempt')
        yield { type: 'error', error: toModelStreamError(error, this.#route.route.id, binding.profile.id, index + 1) }
        return
      }
      const remainingTokens = policy.totalTokenBudget - inputTokens - outputTokens
      if (remainingTokens <= 0) {
        const error = budgetError('Model route token budget was exhausted before the next attempt')
        yield { type: 'error', error: toModelStreamError(error, this.#route.route.id, binding.profile.id, index + 1) }
        return
      }

      let routedRequest: ModelRequest
      try {
        routedRequest = bindPromptCacheRequest({
          ...structuredClone(request),
          maxOutputTokens: Math.min(request.maxOutputTokens, binding.profile.capabilities.maxOutputTokens, remainingTokens),
        }, binding)
      } catch (error) {
        const normalized = normalizeProviderError(error)
        yield { type: 'error', error: toModelStreamError(normalized, this.#route.route.id, binding.profile.id, index + 1) }
        return
      }
      let attempted = await this.#attempt(binding, routedRequest, index + 1, remainingMs, signal)
      inputTokens += attempted.record.inputTokens
      outputTokens += attempted.record.outputTokens
      cachedInputTokens += attempted.record.cachedInputTokens ?? 0
      cacheWriteTokens += attempted.record.cacheWriteTokens ?? 0
      reasoningTokens += attempted.record.reasoningTokens ?? 0

      if (inputTokens + outputTokens > policy.totalTokenBudget) {
        const error = budgetError('Model route token budget was exceeded by the latest attempt')
        attempted = failedAttempt(attempted.record, error, this.#clock())
      }
      lastAttempt = attempted
      yield { type: 'model_attempt', attempt: attempted.record }

      if (!attempted.error) {
        if (inputTokens || outputTokens) yield usageEvent(inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens, reasoningTokens)
        for (const event of attempted.events) yield event
        return
      }

      const canFallback = index + 1 < candidates.length
        && attempted.error.retryable
        && policy.retryableErrors.includes(attempted.error.category)
        && attempted.error.category !== 'budget_exhausted'
        && attempted.error.category !== 'cancelled'
      if (!canFallback) {
        if (inputTokens || outputTokens) yield usageEvent(inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens, reasoningTokens)
        yield {
          type: 'error',
          error: toModelStreamError(attempted.error, this.#route.route.id, binding.profile.id, index + 1),
        }
        return
      }
    }

    const profileId = lastAttempt?.record.profileId || this.#route.primary.id
    const attempt = lastAttempt?.record.attempt || 0
    const error = lastAttempt?.error || invalidOutputError('Model route has no available provider attempts')
    yield { type: 'error', error: toModelStreamError(error, this.#route.route.id, profileId, attempt) }
  }

  async #attempt(
    binding: ModelProviderBinding,
    request: ModelRequest,
    attempt: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<BufferedModelAttempt> {
    const startedAt = this.#clock()
    const events: ModelStreamEvent[] = []
    let actionCount = 0
    let completed = false
    let finishReason: ModelAttemptRecord['finishReason']
    let inputTokens = 0
    let outputTokens = 0
    let cachedInputTokens = 0
    let cacheWriteTokens = 0
    let reasoningTokens = 0
    let failure: NormalizedProviderError | undefined
    const scoped = scopedSignal(signal, timeoutMs)

    try {
      for await (const event of binding.provider.stream(request, scoped.signal)) {
        if (completed) {
          failure = invalidOutputError('Provider emitted data after the terminal completed event')
          break
        }
        if (event.type === 'usage') {
          inputTokens += event.inputTokens
          outputTokens += event.outputTokens
          cachedInputTokens += event.cachedInputTokens ?? 0
          cacheWriteTokens += event.cacheWriteTokens ?? 0
          reasoningTokens += event.reasoningTokens ?? 0
          continue
        }
        if (event.type === 'error') {
          failure = normalizeProviderError(event.error)
          break
        }
        if (event.type === 'model_attempt') {
          failure = invalidOutputError('Nested model routers are not supported')
          break
        }
        if (event.type === 'tool_request') {
          failure = invalidOutputError('Provider returned a legacy tool request')
          break
        }
        if (event.type === 'action') {
          actionCount += 1
          try {
            parseAgentTurnAction(event.action)
          } catch (error) {
            failure = normalizeProviderError(error)
            if (failure.category === 'unknown') failure = invalidOutputError(failure.message)
            break
          }
        }
        if (event.type === 'completed') {
          completed = true
          finishReason = event.finishReason
        }
        events.push(structuredClone(event))
      }
      if (!failure && scoped.timedOut()) failure = timeoutError(`Model attempt timed out after ${timeoutMs}ms`)
      if (!failure && signal?.aborted) {
        failure = normalizeProviderError(new AgentCoreError('CANCELLED', 'Model route was cancelled', { cause: signal.reason }))
      }
      if (!failure && actionCount !== 1) failure = invalidOutputError(`Model attempt must return exactly one action; received ${actionCount}`)
      if (!failure && !completed) failure = invalidOutputError('Model stream ended without a completed event')
      if (!failure && finishReason === 'length') failure = invalidOutputError('Model attempt reached its output limit before a safe action was accepted')
    } catch (error) {
      failure = scoped.timedOut()
        ? timeoutError(`Model attempt timed out after ${timeoutMs}ms`)
        : normalizeProviderError(error)
    } finally {
      scoped.dispose()
    }

    const completedAt = this.#clock()
    const record: ModelAttemptRecord = {
      id: `${request.turnId}:${this.#route.route.id}:attempt:${attempt}`,
      routeId: this.#route.route.id,
      routeRevision: this.#route.route.revision,
      contextRevision: request.contextRevision,
      attempt,
      profileId: binding.profile.id,
      profileRevision: binding.profile.revision,
      provider: binding.profile.provider,
      model: binding.profile.model,
      startedAt,
      completedAt,
      outcome: failure?.category === 'cancelled' ? 'cancelled' : failure ? 'failed' : 'succeeded',
      acceptedAction: !failure,
      inputTokens,
      outputTokens,
      ...(cachedInputTokens ? { cachedInputTokens } : {}),
      ...(cacheWriteTokens ? { cacheWriteTokens } : {}),
      ...(reasoningTokens ? { reasoningTokens } : {}),
      ...(request.promptCacheBinding ? { cacheCapability: request.promptCacheBinding.capability } : {}),
      ...(request.promptCacheBinding?.cacheKey ? { cacheKey: request.promptCacheBinding.cacheKey } : {}),
      ...(finishReason ? { finishReason } : {}),
      ...(failure ? { error: failure } : {}),
    }
    return { record, events: failure ? [] : events, ...(failure ? { error: failure } : {}) }
  }
}

function routedCapabilityProfile(routeId: string, revision: string, bindings: ModelProviderBinding[]): ModelCapabilityProfile {
  if (!bindings.length) throw new AgentCoreError('INVALID_INPUT', `Model route has no registered providers: ${routeId}`)
  return {
    id: `route:${routeId}@${revision}`,
    supportsToolCalls: bindings.every((binding) => binding.provider.profile.supportsToolCalls),
    supportsParallelToolCalls: bindings.every((binding) => binding.provider.profile.supportsParallelToolCalls),
    supportsStructuredOutput: bindings.every((binding) => binding.provider.profile.supportsStructuredOutput),
    contextWindow: Math.min(...bindings.map((binding) => binding.provider.profile.contextWindow)),
    maxOutputTokens: Math.min(...bindings.map((binding) => binding.provider.profile.maxOutputTokens)),
    promptCache: commonPromptCacheCapability(bindings),
  }
}

function commonPromptCacheCapability(bindings: ModelProviderBinding[]) {
  const capabilities = bindings.map((binding) => binding.provider.profile.promptCache)
  if (capabilities.every((capability) => capability === 'explicit')) return 'explicit' as const
  if (capabilities.every((capability) => capability !== 'none')) return 'implicit' as const
  return 'none' as const
}

function usageEvent(
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens: number,
  cacheWriteTokens: number,
  reasoningTokens: number,
): Extract<ModelStreamEvent, { type: 'usage' }> {
  return {
    type: 'usage',
    inputTokens,
    outputTokens,
    ...(cachedInputTokens ? { cachedInputTokens } : {}),
    ...(cacheWriteTokens ? { cacheWriteTokens } : {}),
    ...(reasoningTokens ? { reasoningTokens } : {}),
  }
}

function failedAttempt(record: ModelAttemptRecord, error: NormalizedProviderError, completedAt: string): BufferedModelAttempt {
  return {
    record: {
      ...record,
      completedAt,
      outcome: 'failed',
      acceptedAction: false,
      error,
    },
    events: [],
    error,
  }
}

function scopedSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController()
  let timedOut = false
  const onAbort = () => controller.abort(parent?.reason)
  if (parent) parent.addEventListener('abort', onAbort, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort(new AgentCoreError('MODEL_ERROR', `Model attempt timed out after ${timeoutMs}ms`, { retryable: true }))
  }, timeoutMs)
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timeout)
      if (parent) parent.removeEventListener('abort', onAbort)
    },
  }
}
