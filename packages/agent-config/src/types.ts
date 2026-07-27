import type {
  JsonValue,
  NormalizedModelErrorCode,
  RunLimits,
  VersionedRunComponentSnapshot,
  WorkLevel,
} from '@electron-manager/agent-core'

export const AGENT_CONFIG_SCHEMA_VERSION = 1 as const

export type ConfigScope = 'built_in' | 'user' | 'project' | 'run'
export type PromptCacheMode = 'none' | 'implicit' | 'explicit'

export interface VersionedProfile {
  id: string
  revision: string
}

export interface ModelCapabilities {
  structuredOutput: boolean
  toolCalls: boolean
  contextWindow: number
  maxOutputTokens: number
  promptCache: PromptCacheMode
}

export interface ModelProfile extends VersionedProfile {
  provider: string
  model: string
  endpointRef?: string
  credentialRef?: string
  capabilities: ModelCapabilities
}

export interface ModelRequirements {
  structuredOutput?: boolean
  toolCalls?: boolean
  minContextWindow?: number
  minOutputTokens?: number
  promptCache?: Exclude<PromptCacheMode, 'none'>
}

export interface ModelRetryPolicy {
  maxAttempts: number
  totalTimeoutMs: number
  totalTokenBudget: number
  retryableErrors: NormalizedModelErrorCode[]
}

export interface ModelRoute extends VersionedProfile {
  primaryProfileId: string
  fallbackProfileIds: string[]
  requirements: ModelRequirements
  retry: ModelRetryPolicy
}

export interface PromptVariableDefinition {
  required: boolean
  defaultValue?: string
}

export interface PromptTemplateOverride {
  systemTemplate?: string
  developerTemplate?: string
}

export interface PromptProfile extends VersionedProfile {
  systemTemplate: string
  developerTemplate: string
  variables: Record<string, PromptVariableDefinition>
  workLevelOverrides?: Partial<Record<WorkLevel, PromptTemplateOverride>>
}

export interface WorkflowProfile extends VersionedProfile {
  limits: RunLimits
  limitsByWorkLevel?: Partial<Record<WorkLevel, Partial<RunLimits>>>
  verification: {
    required: boolean
    maxRepairAttempts: number
  }
}

export interface ToolPolicyProfile extends VersionedProfile {
  enabledToolNames: string[]
  backendPreferences: Record<string, string>
}

export interface MemoryProfile extends VersionedProfile {
  mode: 'minimal' | 'balanced' | 'extended'
  sourceBudgets: {
    runFacts: number
    session: number
    project: number
    user: number
  }
  compression: {
    triggerTokens: number
    targetTokens: number
  }
  promptCache: {
    mode: PromptCacheMode
    stablePrefixRevision: string
  }
  summarizerRouteId?: string
  allowLongTermUserMemoryWrite: boolean
}

export interface SlotPolicyProfile extends VersionedProfile {
  selections: Record<string, boolean>
}

export interface SlotDefinition {
  id: string
  category: string
  defaultEnabled: boolean
  available: boolean
  unavailableReason?: string
  requires: string[]
  conflictsWith: string[]
}

export interface ToolInventoryEntry {
  name: string
  descriptorRevision: string
  available: boolean
  selectedBackend?: string
  availableBackendIds: string[]
}

export interface ToolInventory {
  revision: string
  tools: ToolInventoryEntry[]
}

export interface AgentConfigCatalog {
  modelProfiles: ModelProfile[]
  modelRoutes: ModelRoute[]
  promptProfiles: PromptProfile[]
  workflowProfiles: WorkflowProfile[]
  toolPolicies: ToolPolicyProfile[]
  memoryProfiles: MemoryProfile[]
  slotPolicies: SlotPolicyProfile[]
  slotDefinitions: SlotDefinition[]
}

export interface AgentConfigSelections {
  modelRouteId?: string
  promptProfileId?: string
  workflowProfileId?: string
  toolPolicyId?: string
  memoryProfileId?: string
  slotPolicyId?: string
}

export interface AgentConfigOverrides {
  promptVariables?: Record<string, string>
  workflowLimits?: Partial<RunLimits>
  enabledToolNames?: string[]
  backendPreferences?: Record<string, string>
  slotSelections?: Record<string, boolean>
}

export interface AgentConfigLayer {
  scope: ConfigScope
  revision: string
  profileId?: string
  selections?: AgentConfigSelections
  overrides?: AgentConfigOverrides
}

export interface ConfigSource {
  scope: ConfigScope
  revision: string
  profileId?: string
}

export interface ResolvedModelRoute {
  route: ModelRoute
  primary: ModelProfile
  fallbacks: ModelProfile[]
}

export interface ResolvedPromptProfile {
  id: string
  revision: string
  systemTemplate: string
  developerTemplate: string
  variables: Record<string, string>
}

export interface ResolvedWorkflowProfile {
  id: string
  revision: string
  limits: RunLimits
  verification: WorkflowProfile['verification']
}

export interface ResolvedToolPolicy {
  id: string
  revision: string
  enabledToolNames: string[]
  backendPreferences: Record<string, string>
}

export interface ResolvedSlotPolicy {
  id: string
  revision: string
  selections: Record<string, boolean>
}

export interface ResolvedAgentConfig {
  schemaVersion: typeof AGENT_CONFIG_SCHEMA_VERSION
  workLevel: WorkLevel
  model: ResolvedModelRoute
  prompt: ResolvedPromptProfile
  workflow: ResolvedWorkflowProfile
  tools: ResolvedToolPolicy
  memory: MemoryProfile
  slots: ResolvedSlotPolicy
  sources: Record<string, ConfigSource>
}

export interface AgentConfigSnapshot extends VersionedRunComponentSnapshot {
  schemaVersion: typeof AGENT_CONFIG_SCHEMA_VERSION
  data: Record<string, JsonValue>
}

export interface ConfigIssue {
  path: string
  code:
    | 'duplicate'
    | 'invalid_value'
    | 'missing_profile'
    | 'missing_variable'
    | 'unknown_variable'
    | 'unavailable_tool'
    | 'unavailable_backend'
    | 'unavailable_slot'
    | 'missing_dependency'
    | 'slot_conflict'
    | 'capability_mismatch'
    | 'budget_exceeded'
  message: string
  source?: ConfigSource
}

export interface ResolveAgentConfigInput {
  workLevel: WorkLevel
  catalog: AgentConfigCatalog
  layers: AgentConfigLayer[]
  toolInventory: ToolInventory
}

export type ResolveAgentConfigResult =
  | { ok: true; config: ResolvedAgentConfig; snapshot: AgentConfigSnapshot }
  | { ok: false; issues: ConfigIssue[] }
