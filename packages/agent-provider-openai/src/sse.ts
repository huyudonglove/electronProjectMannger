import { AgentCoreError } from '@electron-manager/agent-core'

import type { OpenAIResponsesStreamEvent } from './types.js'

export async function* parseServerSentEvents(
  source: AsyncIterable<Uint8Array | string>,
): AsyncIterable<OpenAIResponsesStreamEvent> {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of source) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    buffer = buffer.replaceAll('\r\n', '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const event = parseEventBlock(block)
      if (event === 'done') return
      if (event) yield event
      boundary = buffer.indexOf('\n\n')
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) {
    const event = parseEventBlock(buffer)
    if (event && event !== 'done') yield event
  }
}

function parseEventBlock(block: string): OpenAIResponsesStreamEvent | 'done' | undefined {
  const data = block.split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
  if (!data) return undefined
  if (data === '[DONE]') return 'done'
  try {
    const parsed = JSON.parse(data)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.type !== 'string') {
      throw new Error('SSE data is not an OpenAI event object')
    }
    return parsed as OpenAIResponsesStreamEvent
  } catch (error) {
    throw new AgentCoreError('MODEL_ERROR', 'OpenAI returned malformed SSE JSON', { cause: error })
  }
}
