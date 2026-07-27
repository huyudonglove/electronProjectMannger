import {
  AgentCoreError,
  toAgentError,
  type NormalizedModelErrorCode,
  type NormalizedProviderError,
  type SerializedAgentError,
} from '@electron-manager/agent-core'

const knownCategories = new Set<NormalizedModelErrorCode>([
  'rate_limit',
  'timeout',
  'service_unavailable',
  'transport',
  'invalid_output',
  'authentication',
  'permission',
  'invalid_request',
  'capability_mismatch',
  'budget_exhausted',
  'cancelled',
  'unknown',
])

const retryableByDefault = new Set<NormalizedModelErrorCode>([
  'rate_limit',
  'timeout',
  'service_unavailable',
  'transport',
  'invalid_output',
])

export function normalizeProviderError(error: unknown): NormalizedProviderError {
  const serialized = isSerializedError(error) ? error : toAgentError(error, 'MODEL_ERROR')
  const details = serialized.details ? structuredClone(serialized.details) : undefined
  const hinted = details?.modelErrorCategory
  const status = typeof details?.status === 'number' ? details.status : undefined
  const category = typeof hinted === 'string' && knownCategories.has(hinted as NormalizedModelErrorCode)
    ? hinted as NormalizedModelErrorCode
    : classify(serialized, status)
  return {
    category,
    message: serialized.message,
    retryable: category !== 'cancelled' && (serialized.retryable || retryableByDefault.has(category)),
    sourceCode: serialized.code,
    ...(details ? { details } : {}),
  }
}

export function invalidOutputError(message: string): NormalizedProviderError {
  return {
    category: 'invalid_output',
    message,
    retryable: true,
    sourceCode: 'MODEL_ERROR',
  }
}

export function timeoutError(message: string): NormalizedProviderError {
  return {
    category: 'timeout',
    message,
    retryable: true,
    sourceCode: 'MODEL_ERROR',
  }
}

export function budgetError(message: string): NormalizedProviderError {
  return {
    category: 'budget_exhausted',
    message,
    retryable: false,
    sourceCode: 'CONTEXT_BUDGET_EXCEEDED',
  }
}

export function toModelStreamError(error: NormalizedProviderError, routeId: string, profileId: string, attempt: number): SerializedAgentError {
  return {
    code: error.category === 'cancelled' ? 'CANCELLED' : error.category === 'budget_exhausted' ? 'CONTEXT_BUDGET_EXCEEDED' : 'MODEL_ERROR',
    message: error.message,
    retryable: error.retryable,
    details: {
      ...(error.details ?? {}),
      modelErrorCategory: error.category,
      routeId,
      profileId,
      attempt,
    },
  }
}

function classify(error: SerializedAgentError, status: number | undefined): NormalizedModelErrorCode {
  if (error.code === 'CANCELLED') return 'cancelled'
  if (error.code === 'CONTEXT_BUDGET_EXCEEDED' || error.code === 'LIMIT_EXCEEDED') return 'budget_exhausted'
  if (error.code === 'INVALID_INPUT') return 'invalid_request'
  if (status === 401) return 'authentication'
  if (status === 403) return 'permission'
  if (status === 408) return 'timeout'
  if (status === 429) return 'rate_limit'
  if (status !== undefined && status >= 500) return 'service_unavailable'
  if (status === 400 || status === 404 || status === 409 || status === 422) return 'invalid_request'

  const message = error.message.toLowerCase()
  if (/rate.?limit|too many requests/.test(message)) return 'rate_limit'
  if (/timed?\s*out|timeout|deadline/.test(message)) return 'timeout'
  if (/service unavailable|overloaded|server error/.test(message)) return 'service_unavailable'
  if (/api.?key|authentication|unauthorized|invalid credential/.test(message)) return 'authentication'
  if (/forbidden|permission|not allowed/.test(message)) return 'permission'
  if (/json|schema|structured|action|malformed|incomplete|without a terminal/.test(message)) return 'invalid_output'
  if (/socket|network|fetch|connection|transport|econn/.test(message)) return 'transport'
  return 'unknown'
}

function isSerializedError(value: unknown): value is SerializedAgentError {
  if (value instanceof AgentCoreError) return false
  return Boolean(value && typeof value === 'object' && 'code' in value && 'message' in value && 'retryable' in value)
}
