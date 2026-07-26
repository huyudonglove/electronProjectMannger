import { AgentCoreError } from './errors.js'
import type { AgentTurnAction, JsonSchema, JsonValue, ProposedAcceptanceEvidence, ProposedDiffSnapshot, ToolRequest } from './protocol.js'

export function parseAgentTurnAction(value: unknown): AgentTurnAction {
  const action = objectValue(value, 'action')
  if (!('kind' in action)) modelError('action.kind is required')
  const kind = requiredString(action.kind, 'action.kind')
  if (kind === 'inspect' || kind === 'tool') {
    exactKeys(action, 'action', ['kind', 'request'])
    return { kind, request: parseToolRequest(action.request, 'action.request') }
  }
  if (kind === 'verify') {
    exactKeys(action, 'action', ['kind', 'checkId', 'request'])
    return {
      kind,
      checkId: requiredString(action.checkId, 'action.checkId'),
      request: parseToolRequest(action.request, 'action.request'),
    }
  }
  if (kind === 'plan') {
    exactKeys(action, 'action', ['kind', 'id', 'summary', 'rationale', 'actionDigest'])
    return {
      kind,
      id: requiredString(action.id, 'action.id'),
      summary: requiredString(action.summary, 'action.summary'),
      rationale: requiredString(action.rationale, 'action.rationale'),
      actionDigest: requiredString(action.actionDigest, 'action.actionDigest'),
    }
  }
  if (kind === 'finish') {
    exactKeys(action, 'action', ['kind', 'summary', 'acceptanceEvidence'], ['diff'])
    if (!Array.isArray(action.acceptanceEvidence)) modelError('action.acceptanceEvidence must be an array')
    const acceptanceEvidence = action.acceptanceEvidence.map((item, index) => parseEvidence(item, `action.acceptanceEvidence[${index}]`))
    return {
      kind,
      summary: requiredString(action.summary, 'action.summary'),
      acceptanceEvidence,
      ...(action.diff === undefined ? {} : { diff: parseDiff(action.diff, 'action.diff') }),
    }
  }
  if (kind === 'blocked') {
    exactKeys(action, 'action', ['kind', 'summary', 'reason'])
    return {
      kind,
      summary: requiredString(action.summary, 'action.summary'),
      reason: requiredString(action.reason, 'action.reason'),
    }
  }
  return modelError(`Unknown AgentTurnAction kind: ${kind}`)
}

export function assertJsonSchemaValue(value: unknown, schema: JsonSchema, path = 'value'): asserts value is JsonValue {
  const acceptedTypes = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type]
  if (acceptedTypes.length && !acceptedTypes.some((type) => matchesType(value, type))) {
    modelError(`${path} must match schema type ${acceptedTypes.join(' | ')}`)
  }
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    modelError(`${path} must be one of the declared enum values`)
  }
  if (Array.isArray(value)) {
    if (schema.items) value.forEach((item, index) => assertJsonSchemaValue(item, schema.items!, `${path}[${index}]`))
    return
  }
  if (isObject(value)) {
    const properties = schema.properties || {}
    for (const required of schema.required || []) {
      if (!(required in value)) modelError(`${path}.${required} is required`)
    }
    for (const [key, item] of Object.entries(value)) {
      const propertySchema = properties[key]
      if (propertySchema) assertJsonSchemaValue(item, propertySchema, `${path}.${key}`)
      else if (schema.additionalProperties === false) modelError(`${path}.${key} is not allowed`)
      else if (isObject(schema.additionalProperties)) assertJsonSchemaValue(item, schema.additionalProperties, `${path}.${key}`)
      else assertJsonValue(item, `${path}.${key}`)
    }
    return
  }
  assertJsonValue(value, path)
}

export function stableJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key]!)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function parseToolRequest(value: unknown, path: string): ToolRequest {
  const request = exactObject(value, path, ['id', 'name', 'input', 'requestedAt', 'actionDigest'])
  const input = objectValue(request.input, `${path}.input`)
  assertJsonValue(input, `${path}.input`)
  return {
    id: requiredString(request.id, `${path}.id`),
    name: requiredString(request.name, `${path}.name`),
    input,
    requestedAt: isoDateString(request.requestedAt, `${path}.requestedAt`),
    actionDigest: requiredString(request.actionDigest, `${path}.actionDigest`),
  }
}

function parseEvidence(value: unknown, path: string): ProposedAcceptanceEvidence {
  const evidence = exactObject(value, path, ['criterionId', 'summary', 'refs'])
  return {
    criterionId: requiredString(evidence.criterionId, `${path}.criterionId`),
    summary: requiredString(evidence.summary, `${path}.summary`),
    refs: stringArray(evidence.refs, `${path}.refs`),
  }
}

function parseDiff(value: unknown, path: string): ProposedDiffSnapshot {
  const diff = exactObject(value, path, ['toolRequestId', 'changedFiles', 'summary'])
  return {
    toolRequestId: requiredString(diff.toolRequestId, `${path}.toolRequestId`),
    changedFiles: stringArray(diff.changedFiles, `${path}.changedFiles`),
    summary: requiredString(diff.summary, `${path}.summary`),
  }
}

function exactObject(value: unknown, path: string, allowed: string[]) {
  const object = objectValue(value, path)
  exactKeys(object, path, allowed)
  return object
}

function objectValue(value: unknown, path: string) {
  if (!isObject(value)) return modelError(`${path} must be an object`)
  return value
}

function exactKeys(value: Record<string, unknown>, path: string, required: string[], optional: string[] = []) {
  const allowed = new Set([...required, ...optional])
  for (const key of required) if (!(key in value)) modelError(`${path}.${key} is required`)
  for (const key of Object.keys(value)) if (!allowed.has(key)) modelError(`${path}.${key} is not allowed`)
}

function requiredString(value: unknown, path: string) {
  if (typeof value !== 'string' || !value.trim()) return modelError(`${path} must be a non-empty string`)
  return value
}

function isoDateString(value: unknown, path: string) {
  const result = requiredString(value, path)
  if (!Number.isFinite(Date.parse(result))) return modelError(`${path} must be an ISO date string`)
  return result
}

function stringArray(value: unknown, path: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    return modelError(`${path} must be an array of non-empty strings`)
  }
  return [...value] as string[]
}

function assertJsonValue(value: unknown, path: string): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`))
    return
  }
  if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) assertJsonValue(item, `${path}.${key}`)
    return
  }
  modelError(`${path} must contain only JSON values`)
}

function matchesType(value: unknown, type: string) {
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return isObject(value)
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  return typeof value === type
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function modelError(message: string): never {
  throw new AgentCoreError('MODEL_ERROR', message)
}
