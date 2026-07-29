import { createHash } from 'node:crypto'

import {
  AgentCoreError,
  assertJsonSchemaValue,
  parseAgentTurnAction,
  stableJson,
  type AgentTurnAction,
  type JsonSchema,
  type JsonValue,
  type ModelRequest,
  type ToolDefinition,
} from '@electron-manager/agent-core'
import { ACTION_SCHEMA_COPY } from '@electron-manager/agent-prompts'

export interface HydrateActionOptions {
  clock?: () => string
}

export function createAgentTurnActionSchema(
  tools: ToolDefinition[],
  allowedKinds: AgentTurnAction['kind'][] = ['inspect', 'plan', 'tool', 'verify', 'finish', 'blocked'],
): Record<string, unknown> {
  const branches: Record<string, unknown>[] = []
  const allowed = new Set(allowedKinds)
  const readTools = tools.filter((tool) => tool.risk === 'read')
  if (allowed.has('inspect') && readTools.length) branches.push(...toolActionBranches('inspect', readTools))
  if (tools.length) {
    if (allowed.has('tool')) branches.push(...toolActionBranches('tool', tools))
    if (allowed.has('verify')) branches.push(...toolActionBranches('verify', tools, true))
  }
  if (allowed.has('plan')) branches.push(planBranch())
  if (allowed.has('finish')) branches.push(finishBranch())
  if (allowed.has('blocked')) branches.push(blockedBranch())
  if (!branches.length) throw new AgentCoreError('INVALID_INPUT', 'Model request has no available Agent actions')
  return {
    type: 'object',
    description: ACTION_SCHEMA_COPY.root,
    properties: { action: { description: ACTION_SCHEMA_COPY.actionEnvelope, anyOf: branches } },
    required: ['action'],
    additionalProperties: false,
  }
}

export function hydrateAgentTurnAction(value: unknown, request: ModelRequest, options: HydrateActionOptions = {}): AgentTurnAction {
  const envelope = exactObject(value, 'response', ['action'])
  const raw = objectValue(envelope.action, 'response.action')
  const kind = nonEmptyString(raw.kind, 'response.action.kind')
  if (request.allowedActions?.length && !request.allowedActions.includes(kind as AgentTurnAction['kind'])) {
    throw new AgentCoreError('MODEL_ERROR', `Model selected an action that is not available in this graph node: ${kind}`)
  }
  const clock = options.clock || (() => new Date().toISOString())
  const tools = new Map(request.tools.map((tool) => [tool.name, tool]))

  if (kind === 'inspect' || kind === 'tool' || kind === 'verify') {
    const required = kind === 'verify' ? ['kind', 'checkId', 'request'] : ['kind', 'request']
    exactKeys(raw, 'response.action', required, ['workItemId'])
    const rawRequest = exactObject(raw.request, 'response.action.request', ['id', 'name', 'input'])
    const name = nonEmptyString(rawRequest.name, 'response.action.request.name')
    const tool = tools.get(name)
    if (!tool) throw new AgentCoreError('MODEL_ERROR', `Model requested unknown tool: ${name}`)
    const input = restoreOptionalValues(rawRequest.input, tool.inputSchema, 'response.action.request.input')
    assertJsonSchemaValue(input, tool.inputSchema, `${name}.input`)
    const hydratedRequest = {
      id: nonEmptyString(rawRequest.id, 'response.action.request.id'),
      name,
      input,
      requestedAt: clock(),
      actionDigest: actionDigest(name, input),
    }
    const workItemId = raw.workItemId === null || raw.workItemId === undefined
      ? undefined
      : nonEmptyString(raw.workItemId, 'response.action.workItemId')
    return parseAgentTurnAction(kind === 'verify'
      ? { kind, checkId: nonEmptyString(raw.checkId, 'response.action.checkId'), request: hydratedRequest, ...(workItemId ? { workItemId } : {}) }
      : { kind, request: hydratedRequest, ...(workItemId ? { workItemId } : {}) })
  }

  if (kind === 'plan') {
    exactKeys(raw, 'response.action', ['kind', 'id', 'summary', 'rationale', 'steps'])
    const plan = parseAgentTurnAction({
      kind,
      id: nonEmptyString(raw.id, 'response.action.id'),
      summary: nonEmptyString(raw.summary, 'response.action.summary'),
      rationale: nonEmptyString(raw.rationale, 'response.action.rationale'),
      steps: raw.steps,
      actionDigest: 'pending',
    })
    if (plan.kind !== 'plan') throw new AgentCoreError('MODEL_ERROR', 'Hydrated plan action has an invalid kind')
    const digestInput: Record<string, JsonValue> = {
      id: plan.id,
      summary: plan.summary,
      rationale: plan.rationale,
      steps: JSON.parse(JSON.stringify(plan.steps || [])) as JsonValue,
    }
    return { ...plan, actionDigest: actionDigest('plan', digestInput) }
  }

  if (kind === 'finish') {
    exactKeys(raw, 'response.action', ['kind', 'summary', 'acceptanceEvidence', 'diff'])
    return parseAgentTurnAction({
      kind,
      summary: raw.summary,
      acceptanceEvidence: raw.acceptanceEvidence,
      ...(raw.diff === null ? {} : { diff: raw.diff }),
    })
  }

  if (kind === 'blocked') {
    exactKeys(raw, 'response.action', ['kind', 'summary', 'reason'])
    return parseAgentTurnAction(raw)
  }
  throw new AgentCoreError('MODEL_ERROR', `Unknown AgentTurnAction kind: ${kind}`)
}

function toolActionBranches(kind: 'inspect' | 'tool' | 'verify', tools: ToolDefinition[], verification = false) {
  return tools.map((tool) => ({
    type: 'object',
    properties: {
      kind: { type: 'string', const: kind, description: actionKindDescription(kind) },
      workItemId: { anyOf: [{ type: 'string' }, { type: 'null' }], description: ACTION_SCHEMA_COPY.workItemReference },
      ...(verification ? { checkId: { type: 'string', description: ACTION_SCHEMA_COPY.verificationCheckId } } : {}),
      request: {
        type: 'object',
        properties: {
          id: { type: 'string', description: ACTION_SCHEMA_COPY.requestId },
          name: { type: 'string', const: tool.name },
          input: strictToolSchema(tool.inputSchema),
        },
        required: ['id', 'name', 'input'],
        additionalProperties: false,
      },
    },
    required: verification ? ['kind', 'workItemId', 'checkId', 'request'] : ['kind', 'workItemId', 'request'],
    additionalProperties: false,
  }))
}

function planBranch() {
  return {
    type: 'object',
    properties: {
      kind: { type: 'string', const: 'plan', description: ACTION_SCHEMA_COPY.plan },
      id: { type: 'string', description: ACTION_SCHEMA_COPY.planId },
      summary: { type: 'string', description: ACTION_SCHEMA_COPY.planSummary },
      rationale: { type: 'string', description: ACTION_SCHEMA_COPY.planRationale },
      steps: {
        type: 'array',
        description: ACTION_SCHEMA_COPY.planSteps,
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: ACTION_SCHEMA_COPY.workItemId },
            title: { type: 'string', description: ACTION_SCHEMA_COPY.workItemTitle },
            kind: { type: 'string', enum: ['inspect', 'change', 'verify'], description: ACTION_SCHEMA_COPY.workItemKind },
            dependsOn: { type: 'array', items: { type: 'string' }, description: ACTION_SCHEMA_COPY.workItemDependencies },
          },
          required: ['id', 'title', 'kind', 'dependsOn'],
          additionalProperties: false,
        },
      },
    },
    required: ['kind', 'id', 'summary', 'rationale', 'steps'],
    additionalProperties: false,
  }
}

function finishBranch() {
  const diff = {
    type: 'object',
    properties: {
      toolRequestId: { type: 'string', description: ACTION_SCHEMA_COPY.diffRequestId },
      changedFiles: { type: 'array', items: { type: 'string' } },
      summary: { type: 'string', description: ACTION_SCHEMA_COPY.completionSummary },
    },
    required: ['toolRequestId', 'changedFiles', 'summary'],
    additionalProperties: false,
  }
  return {
    type: 'object',
    description: ACTION_SCHEMA_COPY.finish,
    properties: {
      kind: { type: 'string', const: 'finish', description: ACTION_SCHEMA_COPY.finish },
      summary: { type: 'string', description: ACTION_SCHEMA_COPY.completionSummary },
      acceptanceEvidence: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            criterionId: { type: 'string', description: ACTION_SCHEMA_COPY.criterionId },
            summary: { type: 'string', description: ACTION_SCHEMA_COPY.criterionSummary },
            refs: { type: 'array', items: { type: 'string' }, description: ACTION_SCHEMA_COPY.evidenceRefs },
          },
          required: ['criterionId', 'summary', 'refs'],
          additionalProperties: false,
        },
      },
      diff: { anyOf: [diff, { type: 'null' }] },
    },
    required: ['kind', 'summary', 'acceptanceEvidence', 'diff'],
    additionalProperties: false,
  }
}

function blockedBranch() {
  return {
    type: 'object',
    properties: {
      kind: { type: 'string', const: 'blocked', description: ACTION_SCHEMA_COPY.blocked },
      summary: { type: 'string', description: ACTION_SCHEMA_COPY.blockedSummary },
      reason: { type: 'string', description: ACTION_SCHEMA_COPY.blockedReason },
    },
    required: ['kind', 'summary', 'reason'],
    additionalProperties: false,
  }
}

function actionKindDescription(kind: 'inspect' | 'tool' | 'verify') {
  if (kind === 'inspect') return ACTION_SCHEMA_COPY.inspect
  if (kind === 'verify') return ACTION_SCHEMA_COPY.verify
  return ACTION_SCHEMA_COPY.tool
}

function strictToolSchema(schema: JsonSchema): Record<string, unknown> {
  const normalizedType = schema.type || (schema.properties ? 'object' : undefined)
  if (normalizedType === 'object') {
    if (schema.additionalProperties === true || (schema.additionalProperties !== undefined && typeof schema.additionalProperties === 'object')) {
      throw new AgentCoreError('INVALID_INPUT', 'Strict OpenAI tool schemas cannot allow undeclared object properties')
    }
    const originalRequired = new Set(schema.required || [])
    const properties = Object.fromEntries(Object.entries(schema.properties || {}).map(([key, property]) => [
      key,
      originalRequired.has(key) ? strictToolSchema(property) : nullable(strictToolSchema(property)),
    ]))
    return {
      type: 'object',
      ...(schema.description ? { description: schema.description } : {}),
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    }
  }
  if (normalizedType === 'array') {
    return {
      type: 'array',
      ...(schema.description ? { description: schema.description } : {}),
      items: strictToolSchema(schema.items || {}),
    }
  }
  const result: Record<string, unknown> = {}
  if (normalizedType) result.type = normalizedType
  if (schema.description) result.description = schema.description
  if (schema.enum) result.enum = schema.enum
  return result
}

function nullable(schema: Record<string, unknown>) {
  const type = schema.type
  if (type === 'null' || (Array.isArray(type) && type.includes('null'))) return schema
  return { anyOf: [schema, { type: 'null' }] }
}

function restoreOptionalValues(value: unknown, schema: JsonSchema, path: string): Record<string, JsonValue> {
  const object = objectValue(value, path)
  const required = new Set(schema.required || [])
  const properties = schema.properties || {}
  const result: Record<string, JsonValue> = {}
  for (const [key, item] of Object.entries(object)) {
    const propertySchema = properties[key]
    if (item === null && propertySchema && !required.has(key) && !allowsNull(propertySchema)) continue
    result[key] = restoreJsonValue(item, propertySchema, `${path}.${key}`)
  }
  return result
}

function restoreJsonValue(value: unknown, schema: JsonSchema | undefined, path: string): JsonValue {
  if (Array.isArray(value)) return value.map((item, index) => restoreJsonValue(item, schema?.items, `${path}[${index}]`))
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    const required = new Set(schema?.required || [])
    const properties = schema?.properties || {}
    const result: Record<string, JsonValue> = {}
    for (const [key, item] of Object.entries(object)) {
      const propertySchema = properties[key]
      if (item === null && propertySchema && !required.has(key) && !allowsNull(propertySchema)) continue
      result[key] = restoreJsonValue(item, propertySchema, `${path}.${key}`)
    }
    return result
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value
  throw new AgentCoreError('MODEL_ERROR', `${path} must contain only JSON values`)
}

function allowsNull(schema: JsonSchema) {
  return schema.type === 'null' || (Array.isArray(schema.type) && schema.type.includes('null')) || schema.enum?.includes(null)
}

function actionDigest(name: string, input: Record<string, JsonValue>) {
  return createHash('sha256').update(name).update('\n').update(stableJson(input)).digest('hex')
}

function exactObject(value: unknown, path: string, keys: string[]) {
  const object = objectValue(value, path)
  exactKeys(object, path, keys)
  return object
}

function exactKeys(value: Record<string, unknown>, path: string, keys: string[], optional: string[] = []) {
  const allowed = new Set([...keys, ...optional])
  for (const key of keys) if (!(key in value)) throw new AgentCoreError('MODEL_ERROR', `${path}.${key} is required`)
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new AgentCoreError('MODEL_ERROR', `${path}.${key} is not allowed`)
}

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new AgentCoreError('MODEL_ERROR', `${path} must be an object`)
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown, path: string) {
  if (typeof value !== 'string' || !value.trim()) throw new AgentCoreError('MODEL_ERROR', `${path} must be a non-empty string`)
  return value
}
