import { AgentCoreError } from '@electron-manager/agent-core'

import type {
  AgentConfigCatalog,
  MemoryProfile,
  ModelProfile,
  ModelRoute,
  PromptProfile,
  SlotDefinition,
  SlotPolicyProfile,
  ToolPolicyProfile,
  VersionedProfile,
  WorkflowProfile,
} from './types.js'

export class AgentConfigRegistry {
  readonly #catalog: AgentConfigCatalog = {
    modelProfiles: [],
    modelRoutes: [],
    promptProfiles: [],
    workflowProfiles: [],
    toolPolicies: [],
    memoryProfiles: [],
    slotPolicies: [],
    slotDefinitions: [],
  }

  constructor(initial: Partial<AgentConfigCatalog> = {}) {
    for (const profile of initial.modelProfiles ?? []) this.registerModelProfile(profile)
    for (const profile of initial.modelRoutes ?? []) this.registerModelRoute(profile)
    for (const profile of initial.promptProfiles ?? []) this.registerPromptProfile(profile)
    for (const profile of initial.workflowProfiles ?? []) this.registerWorkflowProfile(profile)
    for (const profile of initial.toolPolicies ?? []) this.registerToolPolicy(profile)
    for (const profile of initial.memoryProfiles ?? []) this.registerMemoryProfile(profile)
    for (const profile of initial.slotPolicies ?? []) this.registerSlotPolicy(profile)
    for (const definition of initial.slotDefinitions ?? []) this.registerSlotDefinition(definition)
  }

  registerModelProfile(profile: ModelProfile) {
    return this.#register(this.#catalog.modelProfiles, profile, 'model profile')
  }

  registerModelRoute(profile: ModelRoute) {
    return this.#register(this.#catalog.modelRoutes, profile, 'model route')
  }

  registerPromptProfile(profile: PromptProfile) {
    return this.#register(this.#catalog.promptProfiles, profile, 'prompt profile')
  }

  registerWorkflowProfile(profile: WorkflowProfile) {
    return this.#register(this.#catalog.workflowProfiles, profile, 'workflow profile')
  }

  registerToolPolicy(profile: ToolPolicyProfile) {
    return this.#register(this.#catalog.toolPolicies, profile, 'tool policy')
  }

  registerMemoryProfile(profile: MemoryProfile) {
    return this.#register(this.#catalog.memoryProfiles, profile, 'memory profile')
  }

  registerSlotPolicy(profile: SlotPolicyProfile) {
    return this.#register(this.#catalog.slotPolicies, profile, 'slot policy')
  }

  registerSlotDefinition(definition: SlotDefinition) {
    if (!definition.id.trim()) throw new AgentCoreError('INVALID_INPUT', 'Slot definition id is required')
    if (this.#catalog.slotDefinitions.some((candidate) => candidate.id === definition.id)) {
      throw new AgentCoreError('INVALID_INPUT', `Duplicate slot definition: ${definition.id}`)
    }
    this.#catalog.slotDefinitions.push(structuredClone(definition))
    return this
  }

  catalog(): AgentConfigCatalog {
    return structuredClone(this.#catalog)
  }

  #register<T extends VersionedProfile>(target: T[], profile: T, kind: string) {
    if (!profile.id.trim() || !profile.revision.trim()) {
      throw new AgentCoreError('INVALID_INPUT', `${kind} id and revision are required`)
    }
    if (target.some((candidate) => candidate.id === profile.id)) {
      throw new AgentCoreError('INVALID_INPUT', `Duplicate ${kind}: ${profile.id}`)
    }
    target.push(structuredClone(profile))
    return this
  }
}
