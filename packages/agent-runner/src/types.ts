import type {
  AgentEvent,
  AgentRunInput,
  LoadedCheckpoint,
  ModelProvider,
  PermissionPolicy,
  WorkLevel,
} from '@electron-manager/agent-core'
import type {
  AgentConfigCatalog,
  AgentConfigLayer,
} from '@electron-manager/agent-config'
import type { ContextSource } from '@electron-manager/agent-context'
import type {
  ProjectMemoryDocument,
  ProjectMemoryRetrievalRevision,
  SessionSummarizerDiagnostic,
} from '@electron-manager/agent-memory'
import type { LocalRuntimeOptions } from '@electron-manager/agent-runtime-local'
import type { RepoMapOptions } from '@electron-manager/agent-repo-map'
import type { ModelRouteAttemptDiagnostic } from '@electron-manager/agent-model-router'

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
  outputDirectory?: string
  outputPreviewCharacters?: number
  maxOutputArtifactBytes?: number
  repoMapOptions?: RepoMapOptions
  extraContextSources?: ContextSource[]
  projectMemoryDocuments?: ProjectMemoryDocument[]
  projectMemoryRetrievalRevision?: ProjectMemoryRetrievalRevision
  onMemoryDiagnostic?: (diagnostic: SessionSummarizerDiagnostic) => void | Promise<void>
  onModelAttempt?: (diagnostic: ModelRouteAttemptDiagnostic) => void | Promise<void>
  projectRulesRevision?: string
  privacyScopeRevision?: string
  actionSchemaRevision?: string
  clock?: () => string
  now?: () => number
  onCommitted?: (checkpoint: LoadedCheckpoint, events: AgentEvent[]) => void | Promise<void>
  onPublishError?: (error: unknown, checkpoint: LoadedCheckpoint) => void | Promise<void>
}

export interface HeadlessAgentRunRepositoryOptions {
  checkpointPath: string
  outputDirectory?: string
  maxOutputArtifactBytes?: number
}

export type HeadlessAgentRunInput = Omit<AgentRunInput, 'projectRoot' | 'workLevel' | 'limits'>
