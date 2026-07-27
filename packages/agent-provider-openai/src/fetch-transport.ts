import { AgentCoreError, type NormalizedModelErrorCode } from '@electron-manager/agent-core'

import { parseServerSentEvents } from './sse.js'
import type { OpenAIResponsesRequest, OpenAIResponsesStreamEvent, OpenAIResponsesTransport } from './types.js'

export interface FetchOpenAIResponsesTransportOptions {
  apiKey: string
  baseUrl?: string
  organization?: string
  project?: string
  fetcher?: typeof fetch
}

export class FetchOpenAIResponsesTransport implements OpenAIResponsesTransport {
  readonly #apiKey: string
  readonly #baseUrl: string
  readonly #organization?: string
  readonly #project?: string
  readonly #fetcher: typeof fetch

  constructor(options: FetchOpenAIResponsesTransportOptions) {
    if (!options.apiKey.trim()) throw new AgentCoreError('INVALID_INPUT', 'OpenAI API key is required')
    this.#apiKey = options.apiKey
    this.#baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
    this.#organization = options.organization
    this.#project = options.project
    this.#fetcher = options.fetcher || fetch
  }

  async *stream(request: OpenAIResponsesRequest, signal?: AbortSignal): AsyncIterable<OpenAIResponsesStreamEvent> {
    const response = await this.#fetcher(`${this.#baseUrl}/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        'content-type': 'application/json',
        ...(this.#organization ? { 'openai-organization': this.#organization } : {}),
        ...(this.#project ? { 'openai-project': this.#project } : {}),
      },
      body: JSON.stringify(request),
      signal,
    })
    if (!response.ok) {
      const body = (await response.text()).slice(0, 4_000)
      throw new AgentCoreError('MODEL_ERROR', `OpenAI Responses API failed with HTTP ${response.status}`, {
        retryable: response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
        details: { status: response.status, body, modelErrorCategory: categoryForStatus(response.status) },
      })
    }
    if (!response.body) throw new AgentCoreError('MODEL_ERROR', 'OpenAI Responses API returned an empty stream')
    yield* parseServerSentEvents(response.body as unknown as AsyncIterable<Uint8Array>)
  }
}

function categoryForStatus(status: number): NormalizedModelErrorCode {
  if (status === 401) return 'authentication'
  if (status === 403) return 'permission'
  if (status === 408) return 'timeout'
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'service_unavailable'
  return 'invalid_request'
}
