import { createHash } from 'node:crypto'

import {
  AgentCoreError,
  type EffectExpectation,
  type EffectReconcileResult,
  type AgentRuntime,
  type JsonSchema,
  type RuntimeContext,
  type ToolDefinition,
  type ToolEffectPlan,
  type ToolRecovery,
  type ToolRequest,
  type ToolResult,
  type ToolRisk,
  type ToolRiskLevel,
} from '@electron-manager/agent-core'

export interface ToolBackendDescriptor {
  id: string
  kind: 'native' | 'cli'
  command?: string
}

export interface BackendAvailability {
  backendId: string
  available: boolean
  version?: string
  reason?: string
}

export interface ToolAvailability {
  toolName: string
  checkedAt: string
  available: boolean
  selectedBackend?: string
  backends: BackendAvailability[]
}

export interface ToolDescriptor extends ToolDefinition {
  version: string
  title: string
  useWhen: string
  avoidWhen: string
  risk: ToolRisk
  riskCategory: ToolRisk
  baseRiskLevel: ToolRiskLevel
  recovery: ToolRecovery
  sideEffects: string[]
  retryable: boolean
  backends: ToolBackendDescriptor[]
  preferredBackendId: string
  inputSchema: JsonSchema
}

export interface ToolModule {
  descriptor: ToolDescriptor
  probe(): Promise<ToolAvailability>
  prepareEffect?(request: ToolRequest): ToolEffectPlan | Promise<ToolEffectPlan>
  reconcileEffect?(request: ToolRequest, expectedEffects: EffectExpectation[]): EffectReconcileResult | Promise<EffectReconcileResult>
  execute(request: ToolRequest, context: RuntimeContext, signal?: AbortSignal): Promise<ToolResult>
}

export interface ToolRegistrySnapshotEntry {
  name: string
  version: string
  descriptorRevision: string
  baseRiskLevel: ToolRiskLevel
  riskCategory: ToolRisk
  recovery: ToolRecovery
  availability: ToolAvailability
}

export interface ToolRegistrySnapshot {
  schemaVersion: 1
  revision: string
  tools: ToolRegistrySnapshotEntry[]
}

export class ToolRegistry implements AgentRuntime {
  readonly #modules = new Map<string, ToolModule>()

  constructor(modules: ToolModule[] = []) {
    for (const module of modules) this.register(module)
  }

  register(module: ToolModule) {
    validateDescriptor(module.descriptor)
    if (this.#modules.has(module.descriptor.name)) {
      throw new AgentCoreError('INVALID_INPUT', `Duplicate tool registration: ${module.descriptor.name}`)
    }
    this.#modules.set(module.descriptor.name, {
      descriptor: structuredClone(module.descriptor),
      probe: module.probe.bind(module),
      ...(module.prepareEffect ? { prepareEffect: module.prepareEffect.bind(module) } : {}),
      ...(module.reconcileEffect ? { reconcileEffect: module.reconcileEffect.bind(module) } : {}),
      execute: module.execute.bind(module),
    })
    return this
  }

  descriptors(): ToolDescriptor[] {
    return this.#sortedModules().map((module) => structuredClone(module.descriptor))
  }

  definitions(): ToolDefinition[] {
    return this.descriptors().map((descriptor) => ({
      name: descriptor.name,
      description: descriptor.description,
      inputSchema: descriptor.inputSchema,
      risk: descriptor.risk,
      riskCategory: descriptor.riskCategory,
      baseRiskLevel: descriptor.baseRiskLevel,
      recovery: descriptor.recovery,
    }))
  }

  async probe(): Promise<ToolRegistrySnapshot> {
    const entries = await Promise.all(this.#sortedModules().map(async (module) => {
      let availability: ToolAvailability
      try {
        availability = await module.probe()
      } catch (error) {
        availability = {
          toolName: module.descriptor.name,
          checkedAt: new Date().toISOString(),
          available: false,
          backends: [{
            backendId: module.descriptor.preferredBackendId,
            available: false,
            reason: error instanceof Error ? error.message : String(error),
          }],
        }
      }
      validateAvailability(module.descriptor, availability)
      return {
        name: module.descriptor.name,
        version: module.descriptor.version,
        descriptorRevision: descriptorRevision(module.descriptor),
        baseRiskLevel: module.descriptor.baseRiskLevel,
        riskCategory: module.descriptor.riskCategory,
        recovery: module.descriptor.recovery,
        availability: structuredClone(availability),
      }
    }))
    return {
      schemaVersion: 1,
      revision: registryRevision(this.descriptors()),
      tools: entries,
    }
  }

  async execute(request: ToolRequest, context: RuntimeContext, signal?: AbortSignal): Promise<ToolResult> {
    const module = this.#modules.get(request.name)
    if (!module) throw new AgentCoreError('TOOL_NOT_FOUND', `Unknown registered tool: ${request.name}`)
    return await module.execute(request, context, signal)
  }

  async prepareEffect(request: ToolRequest): Promise<ToolEffectPlan> {
    const module = this.#module(request.name)
    if (module.prepareEffect) return structuredClone(await module.prepareEffect(request))
    return {
      backend: module.descriptor.preferredBackendId,
      inputHash: request.actionDigest,
      expectedEffects: [],
    }
  }

  async reconcileEffect(request: ToolRequest, expectedEffects: EffectExpectation[]): Promise<EffectReconcileResult> {
    const module = this.#module(request.name)
    if (!module.reconcileEffect) {
      return { outcome: 'blocked', summary: `Tool does not provide reconciliation: ${request.name}` }
    }
    return structuredClone(await module.reconcileEffect(request, structuredClone(expectedEffects)))
  }

  #module(name: string) {
    const module = this.#modules.get(name)
    if (!module) throw new AgentCoreError('TOOL_NOT_FOUND', `Unknown registered tool: ${name}`)
    return module
  }

  #sortedModules() {
    return [...this.#modules.values()].sort((left, right) => {
      return left.descriptor.name.localeCompare(right.descriptor.name)
        || left.descriptor.version.localeCompare(right.descriptor.version)
    })
  }
}

export function descriptorRevision(descriptor: ToolDescriptor) {
  return hash(canonicalJson(descriptor))
}

export function registryRevision(descriptors: ToolDescriptor[]) {
  const normalized = [...descriptors]
    .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version))
    .map((descriptor) => ({ name: descriptor.name, version: descriptor.version, revision: descriptorRevision(descriptor) }))
  return hash(canonicalJson(normalized))
}

function validateDescriptor(descriptor: ToolDescriptor) {
  const required = [
    descriptor.name,
    descriptor.version,
    descriptor.title,
    descriptor.description,
    descriptor.useWhen,
    descriptor.avoidWhen,
    descriptor.preferredBackendId,
  ]
  if (required.some((value) => !value.trim())) throw new AgentCoreError('INVALID_INPUT', 'Tool descriptor text fields are required')
  if (!descriptor.backends.length || !descriptor.backends.some((backend) => backend.id === descriptor.preferredBackendId)) {
    throw new AgentCoreError('INVALID_INPUT', `Preferred backend is not declared for tool: ${descriptor.name}`)
  }
  if (new Set(descriptor.backends.map((backend) => backend.id)).size !== descriptor.backends.length) {
    throw new AgentCoreError('INVALID_INPUT', `Tool backend ids must be unique: ${descriptor.name}`)
  }
  if (descriptor.risk !== descriptor.riskCategory) {
    throw new AgentCoreError('INVALID_INPUT', `Compatibility risk must match riskCategory: ${descriptor.name}`)
  }
}

function validateAvailability(descriptor: ToolDescriptor, availability: ToolAvailability) {
  if (availability.toolName !== descriptor.name) {
    throw new AgentCoreError('INVALID_INPUT', `Availability does not match tool: ${descriptor.name}`)
  }
  const backendIds = new Set(descriptor.backends.map((backend) => backend.id))
  if (availability.backends.some((backend) => !backendIds.has(backend.backendId))) {
    throw new AgentCoreError('INVALID_INPUT', `Availability contains an undeclared backend: ${descriptor.name}`)
  }
  if (availability.available && (!availability.selectedBackend || !backendIds.has(availability.selectedBackend))) {
    throw new AgentCoreError('INVALID_INPUT', `Available tool must select a declared backend: ${descriptor.name}`)
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}
