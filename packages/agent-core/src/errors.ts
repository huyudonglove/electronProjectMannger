import type { AgentErrorCode, JsonValue, SerializedAgentError } from './protocol.js'

export class AgentCoreError extends Error {
  readonly code: AgentErrorCode
  readonly retryable: boolean
  readonly details?: Record<string, JsonValue>

  constructor(
    code: AgentErrorCode,
    message: string,
    options: { retryable?: boolean; details?: Record<string, JsonValue>; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'AgentCoreError'
    this.code = code
    this.retryable = options.retryable ?? false
    this.details = options.details
  }

  serialize(): SerializedAgentError {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details ? { details: this.details } : {}),
      ...(this.cause ? { cause: causeMessage(this.cause) } : {}),
    }
  }
}

export function toAgentError(error: unknown, fallbackCode: AgentErrorCode = 'INTERNAL_ERROR'): SerializedAgentError {
  if (error instanceof AgentCoreError) return error.serialize()
  if (error instanceof Error) {
    return {
      code: fallbackCode,
      message: error.message,
      retryable: false,
      cause: error.name,
    }
  }
  return {
    code: fallbackCode,
    message: String(error),
    retryable: false,
  }
}

function causeMessage(cause: unknown) {
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)
}
