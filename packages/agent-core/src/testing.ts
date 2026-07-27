import type {
  AgentRuntime,
  ModelCapabilityProfile,
  ModelProvider,
  ModelRequest,
  ModelStreamEvent,
  RuntimeContext,
  PermissionDecision,
  PermissionPolicy,
  RunLedger,
  ToolDefinition,
  ToolRequest,
  ToolResult,
} from './protocol.js'

export class FakeModelProvider implements ModelProvider {
  readonly requests: ModelRequest[] = []
  readonly profile: ModelCapabilityProfile
  readonly #responses: ModelStreamEvent[][]

  constructor(responses: ModelStreamEvent[][], profile: Partial<ModelCapabilityProfile> = {}) {
    this.#responses = responses.map((response) => [...response])
    this.profile = {
      id: 'fake-model',
      supportsToolCalls: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutput: true,
      contextWindow: 32_000,
      maxOutputTokens: 4_000,
      promptCache: 'none',
      ...profile,
    }
  }

  async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelStreamEvent> {
    if (signal?.aborted) throw signal.reason
    this.requests.push(structuredClone(request))
    const response = this.#responses.shift()
    if (!response) throw new Error('FakeModelProvider has no queued response')
    for (const event of response) {
      if (signal?.aborted) throw signal.reason
      yield structuredClone(event)
    }
  }
}

export class FakePermissionPolicy implements PermissionPolicy {
  readonly calls: Array<{ request: ToolRequest; tool: ToolDefinition; ledger: RunLedger }> = []
  readonly #decide: (request: ToolRequest, tool: ToolDefinition, ledger: RunLedger) => PermissionDecision | Promise<PermissionDecision>

  constructor(decide: PermissionDecision | ((request: ToolRequest, tool: ToolDefinition, ledger: RunLedger) => PermissionDecision | Promise<PermissionDecision>)) {
    this.#decide = typeof decide === 'function' ? decide : () => decide
  }

  async decide(request: ToolRequest, tool: ToolDefinition, ledger: RunLedger) {
    this.calls.push({ request: structuredClone(request), tool: structuredClone(tool), ledger: structuredClone(ledger) })
    return structuredClone(await this.#decide(request, tool, ledger))
  }
}

export type FakeRuntimeHandler = (request: ToolRequest, context: RuntimeContext) => ToolResult | Promise<ToolResult>

export class FakeAgentRuntime implements AgentRuntime {
  readonly calls: Array<{ request: ToolRequest; context: RuntimeContext }> = []
  readonly #handlers = new Map<string, FakeRuntimeHandler>()

  on(toolName: string, handler: FakeRuntimeHandler) {
    this.#handlers.set(toolName, handler)
    return this
  }

  async execute(request: ToolRequest, context: RuntimeContext, signal?: AbortSignal): Promise<ToolResult> {
    if (signal?.aborted) throw signal.reason
    this.calls.push({ request: structuredClone(request), context: structuredClone(context) })
    const handler = this.#handlers.get(request.name)
    if (!handler) throw new Error(`No fake runtime handler registered for ${request.name}`)
    return structuredClone(await handler(request, context))
  }
}
