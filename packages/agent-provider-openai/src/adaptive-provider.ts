import type {
  ModelCapabilityProfile,
  ModelProvider,
  ModelRequest,
  ModelStreamEvent,
  SerializedAgentError,
} from '@electron-manager/agent-core'

import type { OpenAIModelDiagnosticEntry } from './chat-completions-provider.js'

export type OpenAIProtocol = 'responses' | 'chat-completions'

export interface AdaptiveOpenAIProviderOptions {
  responses: ModelProvider
  chatCompletions: ModelProvider
  cacheKey: string
  preferred?: OpenAIProtocol
  providerId?: string
  model: string
  clock?: () => string
  onDiagnostic?: (entry: OpenAIModelDiagnosticEntry) => void | Promise<void>
}

const selectedProtocolCache = new Map<string, OpenAIProtocol>()

export class AdaptiveOpenAIProvider implements ModelProvider {
  readonly profile: ModelCapabilityProfile
  readonly #providers: Record<OpenAIProtocol, ModelProvider>
  readonly #cacheKey: string
  readonly #preferred: OpenAIProtocol
  readonly #providerId: string
  readonly #model: string
  readonly #clock: () => string
  readonly #onDiagnostic?: AdaptiveOpenAIProviderOptions['onDiagnostic']

  constructor(options: AdaptiveOpenAIProviderOptions) {
    if (!options.cacheKey.trim()) throw new Error('Adaptive provider cache key is required')
    this.#providers = { responses: options.responses, 'chat-completions': options.chatCompletions }
    this.#cacheKey = options.cacheKey
    this.#preferred = options.preferred || 'responses'
    this.#providerId = String(options.providerId || 'openai-compatible')
    this.#model = options.model
    this.#clock = options.clock || (() => new Date().toISOString())
    this.#onDiagnostic = options.onDiagnostic
    this.profile = structuredClone(options.responses.profile)
  }

  async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelStreamEvent> {
    const cached = selectedProtocolCache.get(this.#cacheKey)
    const first = cached || this.#preferred
    const second: OpenAIProtocol = first === 'responses' ? 'chat-completions' : 'responses'
    const attempts = cached ? [first] : [first, second]

    for (let index = 0; index < attempts.length; index += 1) {
      const protocol = attempts[index]!
      const events: ModelStreamEvent[] = []
      for await (const event of this.#providers[protocol].stream(request, signal)) events.push(event)
      const failure = events.find((event): event is Extract<ModelStreamEvent, { type: 'error' }> => event.type === 'error')
      if (failure && index + 1 < attempts.length && unsupportedProtocol(failure.error)) {
        await this.#diagnostic(request, 'protocol.fallback', `${protocol} unsupported; trying ${attempts[index + 1]}`)
        continue
      }
      if (!failure) {
        selectedProtocolCache.set(this.#cacheKey, protocol)
        await this.#diagnostic(request, 'protocol.selected', protocol)
      }
      yield* events
      return
    }
  }

  async #diagnostic(request: ModelRequest, event: OpenAIModelDiagnosticEntry['event'], detail: string) {
    if (!this.#onDiagnostic) return
    try {
      await this.#onDiagnostic({
        at: this.#clock(), level: 'info', event,
        providerId: this.#providerId, model: this.#model,
        runId: request.runId, turnId: request.turnId, actionShape: detail,
      })
    } catch {
      // Protocol diagnostics are observational only.
    }
  }
}

function unsupportedProtocol(error: SerializedAgentError) {
  const status = error.details?.status
  if (status === 404 || status === 405 || status === 415 || status === 501) return true
  return /unsupported (?:api|endpoint|protocol)|unknown endpoint|not found/i.test(error.message)
}

export function clearAdaptiveOpenAIProtocolCache() {
  selectedProtocolCache.clear()
}
