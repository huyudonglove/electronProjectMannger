import { AgentCoreError, type JsonValue } from '@electron-manager/agent-core'

export function requiredString(value: JsonValue | undefined, name: string) {
  if (typeof value !== 'string' || !value.trim()) throw new AgentCoreError('INVALID_INPUT', `${name} must be a non-empty string`)
  return value
}

export function optionalString(value: JsonValue | undefined, fallback: string) {
  if (value === undefined) return fallback
  if (typeof value !== 'string') throw new AgentCoreError('INVALID_INPUT', 'Expected a string input')
  return value
}

export function stringValue(value: JsonValue | undefined, name: string) {
  if (typeof value !== 'string') throw new AgentCoreError('INVALID_INPUT', `${name} must be a string`)
  return value
}

export function optionalNumber(value: JsonValue | undefined, fallback: number) {
  if (value === undefined) return fallback
  if (typeof value !== 'number') throw new AgentCoreError('INVALID_INPUT', 'Expected a numeric input')
  return value
}

export function optionalStringArray(value: JsonValue | undefined, name: string) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new AgentCoreError('INVALID_INPUT', `${name} must be an array of strings`)
  }
  return value as string[]
}
