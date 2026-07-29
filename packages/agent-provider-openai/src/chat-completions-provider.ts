import {
  AgentCoreError,
  toAgentError,
  type ModelCapabilityProfile,
  type ModelMessage,
  type ModelProvider,
  type ModelRequest,
  type ModelStreamEvent,
  type NormalizedModelErrorCode,
} from '@electron-manager/agent-core'
import {
  ACTION_SCHEMA_COPY,
  MODEL_ACTION_SUBMISSION_PROMPT,
} from '@electron-manager/agent-prompts'

import { createAgentTurnActionSchema, hydrateAgentTurnAction } from './action-schema.js'

export interface OpenAIChatCompletionsProviderOptions {
  baseUrl: string
  apiKey?: string
  providerId?: string
  model: string
  contextWindow?: number
  maxOutputTokens?: number
  toolChoice?: 'auto' | 'required' | 'named'
  fetcher?: typeof fetch
  clock?: () => string
  onDiagnostic?: (entry: OpenAIModelDiagnosticEntry) => void | Promise<void>
}

export interface OpenAIModelDiagnosticEntry {
  at: string
  level: 'info' | 'error'
  event: 'request.started' | 'response.received' | 'response.parsed' | 'request.failed' | 'protocol.selected' | 'protocol.fallback'
  providerId: string
  model: string
  runId: string
  turnId: string
  durationMs?: number
  status?: number
  messageCount?: number
  toolCount?: number
  finishReason?: string
  toolCallNames?: string[]
  actionShape?: string
  error?: string
}

export class OpenAIChatCompletionsProvider implements ModelProvider {
  readonly profile: ModelCapabilityProfile
  readonly #baseUrl: string
  readonly #apiKey: string
  readonly #fetcher: typeof fetch
  readonly #clock: () => string
  readonly #toolChoice: 'auto' | 'required' | 'named'
  readonly #providerId: string
  readonly #onDiagnostic?: OpenAIChatCompletionsProviderOptions['onDiagnostic']

  constructor(options: OpenAIChatCompletionsProviderOptions) {
    if (!options.baseUrl.trim()) throw new AgentCoreError('INVALID_INPUT', 'Chat Completions base URL is required')
    if (!options.model.trim()) throw new AgentCoreError('INVALID_INPUT', 'Chat Completions model is required')
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.#apiKey = String(options.apiKey || '').trim()
    this.#fetcher = options.fetcher || fetch
    this.#clock = options.clock || (() => new Date().toISOString())
    this.#toolChoice = options.toolChoice || 'required'
    this.#providerId = String(options.providerId || 'openai-compatible')
    this.#onDiagnostic = options.onDiagnostic
    this.profile = {
      id: `openai:${options.model}`,
      supportsToolCalls: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutput: true,
      contextWindow: options.contextWindow || 128_000,
      maxOutputTokens: options.maxOutputTokens || 16_000,
      promptCache: 'implicit',
    }
  }

  async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelStreamEvent> {
    if (signal?.aborted) {
      yield { type: 'error', error: cancelledError(signal.reason) }
      return
    }
    const startedAt = Date.now()
    try {
      await this.#diagnostic({
        level: 'info',
        event: 'request.started',
        runId: request.runId,
        turnId: request.turnId,
        messageCount: request.messages.length,
        toolCount: request.tools.length,
      })
      const response = await this.#fetcher(`${this.#baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.#apiKey ? { authorization: `Bearer ${this.#apiKey}` } : {}),
        },
        body: JSON.stringify(requestBody(this.profile, request, this.#toolChoice)),
        signal,
      })
      await this.#diagnostic({
        level: response.ok ? 'info' : 'error',
        event: 'response.received',
        runId: request.runId,
        turnId: request.turnId,
        durationMs: Date.now() - startedAt,
        status: response.status,
      })
      if (!response.ok) {
        const body = (await response.text()).slice(0, 4_000)
        throw new AgentCoreError('MODEL_ERROR', `Chat Completions API failed with HTTP ${response.status}`, {
          retryable: response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
          details: { status: response.status, body, modelErrorCategory: categoryForStatus(response.status) },
        })
      }
      const payload = await response.json() as Record<string, unknown>
      const choice = firstChoice(payload)
      const message = objectValue(choice.message)
      if (!message) throw new AgentCoreError('MODEL_ERROR', 'Chat Completions response is missing choices[0].message')
      const submitted = submittedAction(message)
      const action = hydrateAgentTurnAction(submitted.payload, request, { clock: this.#clock })
      await this.#diagnostic({
        level: 'info',
        event: 'response.parsed',
        runId: request.runId,
        turnId: request.turnId,
        durationMs: Date.now() - startedAt,
        finishReason: String(choice.finish_reason || ''),
        toolCallNames: toolCallNames(message),
        actionShape: submitted.shape,
      })
      const usage = usageEvent(payload.usage)
      if (usage) yield usage
      yield { type: 'action', action }
      yield { type: 'completed', finishReason: Array.isArray(message.tool_calls) ? 'tool_calls' : 'stop' }
    } catch (error) {
      await this.#diagnostic({
        level: 'error',
        event: 'request.failed',
        runId: request.runId,
        turnId: request.turnId,
        durationMs: Date.now() - startedAt,
        error: safeErrorMessage(error),
      })
      if (signal?.aborted) yield { type: 'error', error: cancelledError(signal.reason) }
      else yield { type: 'error', error: toAgentError(error, 'MODEL_ERROR') }
    }
  }

  async #diagnostic(input: Omit<OpenAIModelDiagnosticEntry, 'at' | 'providerId' | 'model'>) {
    if (!this.#onDiagnostic) return
    try {
      await this.#onDiagnostic({
        at: this.#clock(),
        providerId: this.#providerId,
        model: this.profile.id.slice('openai:'.length),
        ...input,
      })
    } catch (error) {
      console.warn('Unable to persist model diagnostic entry.', safeErrorMessage(error))
    }
  }
}

function requestBody(
  profile: ModelCapabilityProfile,
  request: ModelRequest,
  toolChoice: 'auto' | 'required' | 'named',
) {
  return {
    model: profile.id.slice('openai:'.length),
    messages: [
      {
        role: 'system',
        content: MODEL_ACTION_SUBMISSION_PROMPT.text,
      },
      ...request.messages.map(mapMessage),
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'submit_agent_action',
        description: ACTION_SCHEMA_COPY.submitAction,
        parameters: createAgentTurnActionSchema(request.tools, request.allowedActions),
      },
    }],
    tool_choice: toolChoice === 'named'
      ? { type: 'function', function: { name: 'submit_agent_action' } }
      : toolChoice,
    parallel_tool_calls: false,
    max_tokens: Math.min(request.maxOutputTokens, profile.maxOutputTokens),
    stream: false,
  }
}

function mapMessage(message: ModelMessage) {
  if (message.role === 'tool') {
    return { role: 'user', content: `[tool_result request_id=${message.toolRequestId || 'unknown'}]\n${message.content}` }
  }
  return { role: message.role, content: message.content }
}

function firstChoice(payload: Record<string, unknown>) {
  const choices = Array.isArray(payload.choices) ? payload.choices : []
  const choice = objectValue(choices[0])
  if (!choice) throw new AgentCoreError('MODEL_ERROR', 'Chat Completions response is missing choices[0]')
  return choice
}

function submittedAction(message: Record<string, unknown>) {
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
  for (const rawCall of calls) {
    const call = objectValue(rawCall)
    const fn = objectValue(call?.function)
    if (fn?.name !== 'submit_agent_action' || typeof fn.arguments !== 'string') continue
    return normalizeSubmittedAction(parseJson(fn.arguments))
  }
  if (typeof message.content === 'string' && message.content.trim()) {
    return normalizeSubmittedAction(parseJson(stripJsonFence(message.content)))
  }
  throw new AgentCoreError('MODEL_ERROR', 'Model did not call submit_agent_action')
}

function normalizeSubmittedAction(value: unknown): { payload: unknown; shape: string } {
  const object = objectValue(value)
  if (!object) return { payload: value, shape: typeof value }
  if (typeof object.action === 'string') {
    return { payload: { action: parseJson(stripJsonFence(object.action)) }, shape: 'nested-action-json-string' }
  }
  if (objectValue(object.action)) return { payload: object, shape: 'action-envelope' }
  if (typeof object.kind === 'string') return { payload: { action: object }, shape: 'bare-action-object' }
  return { payload: object, shape: `object:${Object.keys(object).sort().join(',') || 'empty'}` }
}

function toolCallNames(message: Record<string, unknown>) {
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
  return calls.flatMap((rawCall) => {
    const name = objectValue(objectValue(rawCall)?.function)?.name
    return typeof name === 'string' && name ? [name] : []
  })
}

function parseJson(value: string) {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new AgentCoreError('MODEL_ERROR', 'Chat Completions action was not valid JSON', { cause: error })
  }
}

function stripJsonFence(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
}

function usageEvent(value: unknown): Extract<ModelStreamEvent, { type: 'usage' }> | undefined {
  const usage = objectValue(value)
  if (!usage) return undefined
  const inputTokens = finiteInteger(usage.prompt_tokens)
  const outputTokens = finiteInteger(usage.completion_tokens)
  if (inputTokens === undefined || outputTokens === undefined) return undefined
  return { type: 'usage', inputTokens, outputTokens }
}

function finiteInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function categoryForStatus(status: number): NormalizedModelErrorCode {
  if (status === 401) return 'authentication'
  if (status === 403) return 'permission'
  if (status === 408) return 'timeout'
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'service_unavailable'
  return 'invalid_request'
}

function cancelledError(reason: unknown) {
  return {
    code: 'CANCELLED' as const,
    message: 'Chat Completions request was cancelled',
    retryable: false,
    ...(reason === undefined ? {} : { cause: reason instanceof Error ? reason.message : String(reason) }),
  }
}

function safeErrorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1_000)
}
