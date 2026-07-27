import type {
  AgentRunInput,
  ModelProvider,
  PermissionPolicy,
  WorkLevel,
} from '@electron-manager/agent-core'
import type {
  AgentConfigCatalog,
  AgentConfigLayer,
} from '@electron-manager/agent-config'
import type { ContextSource } from '@electron-manager/agent-context'
import type { LocalRuntimeOptions } from '@electron-manager/agent-runtime-local'

export interface ModelProviderRegistration {
  profileId: string
  provider: ModelProvider
}

export interface HeadlessAgentRunnerOptions {
  projectRoot: string
  checkpointPath: string
  workLevel: WorkLevel
  catalog: AgentConfigCatalog
  layers: AgentConfigLayer[]
  providers: ModelProviderRegistration[]
  permissionPolicy: PermissionPolicy
  runtimeOptions?: LocalRuntimeOptions
  extraContextSources?: ContextSource[]
  projectRulesRevision?: string
  privacyScopeRevision?: string
  actionSchemaRevision?: string
  clock?: () => string
  now?: () => number
}

export type HeadlessAgentRunInput = Omit<AgentRunInput, 'projectRoot' | 'workLevel' | 'limits'>
