export interface OpenAIResponseInputMessage {
  role: 'developer' | 'user' | 'assistant'
  content: string
}

export interface OpenAIResponsesRequest {
  model: string
  input: OpenAIResponseInputMessage[]
  max_output_tokens: number
  stream: true
  store: false
  text: {
    verbosity: 'low' | 'medium' | 'high'
    format: {
      type: 'json_schema'
      name: string
      strict: true
      schema: Record<string, unknown>
    }
  }
  reasoning?: { effort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' }
}

export interface OpenAIResponsesStreamEvent {
  type: string
  [key: string]: unknown
}

export interface OpenAIResponsesTransport {
  stream(request: OpenAIResponsesRequest, signal?: AbortSignal): AsyncIterable<OpenAIResponsesStreamEvent>
}
