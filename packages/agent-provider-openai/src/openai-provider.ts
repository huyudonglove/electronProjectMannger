import {
  AgentCoreError,
  toAgentError,
  type ModelCapabilityProfile,
  type ModelMessage,
  type NormalizedModelErrorCode,
  type ModelProvider,
  type ModelRequest,
  type ModelStreamEvent,
  type SerializedAgentError,
  type ToolDefinition,
} from '@electron-manager/agent-core'

import { createAgentTurnActionSchema, hydrateAgentTurnAction } from './action-schema.js'
import type { OpenAIResponseInputMessage, OpenAIResponsesRequest, OpenAIResponsesStreamEvent, OpenAIResponsesTransport } from './types.js'

export interface OpenAIResponsesProviderOptions {
  transport: OpenAIResponsesTransport
  model?: string
  contextWindow?: number
  maxOutputTokens?: number
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  verbosity?: 'low' | 'medium' | 'high'
  clock?: () => string
}

export class OpenAIResponsesProvider implements ModelProvider {
  readonly profile: ModelCapabilityProfile
  readonly #transport: OpenAIResponsesTransport
  readonly #reasoningEffort?: OpenAIResponsesProviderOptions['reasoningEffort']
  readonly #verbosity: NonNullable<OpenAIResponsesProviderOptions['verbosity']>
  readonly #clock: () => string

  constructor(options: OpenAIResponsesProviderOptions) {
    const model = options.model || 'gpt-5.6'
    if (!model.trim()) throw new AgentCoreError('INVALID_INPUT', 'OpenAI model is required')
    this.#transport = options.transport
    this.#reasoningEffort = options.reasoningEffort
    this.#verbosity = options.verbosity || 'low'
    this.#clock = options.clock || (() => new Date().toISOString())
    this.profile = {
      id: `openai:${model}`,
      supportsToolCalls: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutput: true,
      contextWindow: options.contextWindow || 1_000_000,
      maxOutputTokens: options.maxOutputTokens || 128_000,
    }
  }

  async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelStreamEvent> {
    if (signal?.aborted) {
      yield { type: 'error', error: cancelledError(signal.reason) }
      return
    }
    let outputText = ''
    let terminal = false
    try {
      for await (const event of this.#transport.stream(this.#requestBody(request), signal)) {
        if (signal?.aborted) throw new AgentCoreError('CANCELLED', 'OpenAI model request was cancelled', { cause: signal.reason })
        if (event.type === 'response.output_text.delta') {
          if (typeof event.delta !== 'string') throw new AgentCoreError('MODEL_ERROR', 'OpenAI output_text delta is malformed')
          outputText += event.delta
          yield { type: 'text_delta', text: event.delta }
          continue
        }
        if (event.type === 'response.completed') {
          terminal = true
          const response = requiredResponse(event.response)
          if (!outputText) outputText = completedOutputText(response)
          const action = hydrateAgentTurnAction(parseJson(outputText), request, { clock: this.#clock })
          const usage = usageEvent(response)
          if (usage) yield usage
          yield { type: 'action', action }
          yield { type: 'completed', finishReason: 'stop' }
          return
        }
        if (event.type === 'response.incomplete') {
          terminal = true
          const response = requiredResponse(event.response)
          const usage = usageEvent(response)
          if (usage) yield usage
          yield {
            type: 'error',
            error: {
              code: 'MODEL_ERROR',
              message: `OpenAI response was incomplete${incompleteReason(response)}`,
              retryable: true,
            },
          }
          yield { type: 'completed', finishReason: 'length' }
          return
        }
        if (event.type === 'response.failed' || event.type === 'error') {
          terminal = true
          yield { type: 'error', error: responseError(event) }
          return
        }
      }
      if (!terminal) {
        yield { type: 'error', error: { code: 'MODEL_ERROR', message: 'OpenAI stream ended without a terminal response event', retryable: true } }
      }
    } catch (error) {
      if (signal?.aborted) yield { type: 'error', error: cancelledError(signal.reason) }
      else yield { type: 'error', error: toAgentError(error, 'MODEL_ERROR') }
    }
  }

  #requestBody(request: ModelRequest): OpenAIResponsesRequest {
    return {
      model: this.profile.id.slice('openai:'.length),
      input: requestInput(request),
      max_output_tokens: Math.min(request.maxOutputTokens, this.profile.maxOutputTokens),
      stream: true,
      store: false,
      text: {
        verbosity: this.#verbosity,
        format: {
          type: 'json_schema',
          name: 'agent_turn_action',
          strict: true,
          schema: createAgentTurnActionSchema(request.tools),
        },
      },
      ...(this.#reasoningEffort ? { reasoning: { effort: this.#reasoningEffort } } : {}),
    }
  }
}

function requestInput(request: ModelRequest): OpenAIResponseInputMessage[] {
  const prefixLength = request.messages.findIndex((message) => message.role !== 'system')
  const stableSystemCount = prefixLength === -1 ? request.messages.length : prefixLength
  return [
    ...request.messages.slice(0, stableSystemCount).map(mapMessage),
    toolCatalogMessage(request.tools),
    ...request.messages.slice(stableSystemCount).map(mapMessage),
  ]
}

function toolCatalogMessage(tools: ToolDefinition[]): OpenAIResponseInputMessage {
  return {
    role: 'developer',
    content: [
      'Return exactly one action matching the supplied JSON schema.',
      'Request ids must be unique and stable because later evidence refers to them.',
      'Null in an optional tool field means omit that field. Never claim a tool result before it appears in the ledger.',
      `Available tools: ${JSON.stringify(tools.map(({ name, description, risk, riskCategory, baseRiskLevel }) => ({ name, description, riskCategory: riskCategory || risk, baseRiskLevel })))}`,
    ].join('\n'),
  }
}

function mapMessage(message: ModelMessage): OpenAIResponseInputMessage {
  if (message.role === 'system') return { role: 'developer', content: message.content }
  if (message.role === 'tool') {
    return { role: 'user', content: `[tool_result request_id=${message.toolRequestId || 'unknown'}]\n${message.content}` }
  }
  return { role: message.role, content: message.content }
}

function parseJson(text: string) {
  if (!text.trim()) throw new AgentCoreError('MODEL_ERROR', 'OpenAI completed without structured action output')
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new AgentCoreError('MODEL_ERROR', 'OpenAI structured action output was not valid JSON', { cause: error })
  }
}

function usageEvent(response: Record<string, unknown>): Extract<ModelStreamEvent, { type: 'usage' }> | undefined {
  const usage = objectValue(response.usage)
  if (!usage) return undefined
  const inputTokens = finiteNumber(usage.input_tokens)
  const outputTokens = finiteNumber(usage.output_tokens)
  if (inputTokens === undefined || outputTokens === undefined) return undefined
  return { type: 'usage', inputTokens, outputTokens }
}

function completedOutputText(response: Record<string, unknown>) {
  if (!Array.isArray(response.output)) return ''
  const parts: string[] = []
  for (const item of response.output) {
    const message = objectValue(item)
    if (!message || !Array.isArray(message.content)) continue
    for (const content of message.content) {
      const part = objectValue(content)
      if (part?.type === 'output_text' && typeof part.text === 'string') parts.push(part.text)
    }
  }
  return parts.join('')
}

function incompleteReason(response: Record<string, unknown>) {
  const details = objectValue(response.incomplete_details)
  return typeof details?.reason === 'string' ? `: ${details.reason}` : ''
}

function responseError(event: OpenAIResponsesStreamEvent): SerializedAgentError {
  const response = objectValue(event.response)
  const error = objectValue(response?.error) || objectValue(event.error)
  const message = typeof error?.message === 'string' ? error.message : 'OpenAI model request failed'
  const providerCode = typeof error?.code === 'string' ? error.code : typeof error?.type === 'string' ? error.type : undefined
  const category = openAIErrorCategory(providerCode, message)
  return {
    code: 'MODEL_ERROR',
    message,
    retryable: ['rate_limit', 'timeout', 'service_unavailable', 'transport'].includes(category),
    details: {
      modelErrorCategory: category,
      ...(providerCode ? { providerCode } : {}),
    },
  }
}

function openAIErrorCategory(code: string | undefined, message: string): NormalizedModelErrorCode {
  const value = `${code || ''} ${message}`.toLowerCase()
  if (/rate.?limit|too many requests/.test(value)) return 'rate_limit'
  if (/timeout|timed out|deadline/.test(value)) return 'timeout'
  if (/server|service unavailable|overloaded/.test(value)) return 'service_unavailable'
  if (/api.?key|authentication|unauthorized|invalid credential/.test(value)) return 'authentication'
  if (/permission|forbidden/.test(value)) return 'permission'
  if (/invalid|request|unsupported/.test(value)) return 'invalid_request'
  if (/connection|network|transport|socket/.test(value)) return 'transport'
  return 'unknown'
}

function cancelledError(reason: unknown): SerializedAgentError {
  return {
    code: 'CANCELLED',
    message: 'OpenAI model request was cancelled',
    retryable: false,
    ...(reason === undefined ? {} : { cause: reason instanceof Error ? reason.message : String(reason) }),
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function requiredResponse(value: unknown) {
  const response = objectValue(value)
  if (!response) throw new AgentCoreError('MODEL_ERROR', 'OpenAI terminal event is missing its response object')
  return response
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
