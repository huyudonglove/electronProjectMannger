import type {
  AgentConfigCatalog,
  AgentConfigLayer,
  ModelProfile,
} from '@electron-manager/agent-config'
import type { OpenAIResponsesTransport } from '@electron-manager/agent-provider-openai'
import type { ModelProviderRegistration } from '@electron-manager/agent-runner'
import type { ProjectMemoryDocument } from '@electron-manager/agent-memory'
import type { CredentialVaultSnapshot } from '@electron-manager/agent-credential-vault'

export const DESKTOP_AGENT_SETTINGS_SCHEMA_VERSION = 1 as const

export interface OpenAIDesktopProviderSettings {
  provider: 'openai'
  providerId?: string
  connectionSource?: 'credential-vault' | 'telance-local-proxy'
  apiStyle?: 'responses' | 'chat-completions'
  baseUrl?: string
  organization?: string
  project?: string
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  verbosity?: 'low' | 'medium' | 'high'
}

export type DesktopProviderSettings = OpenAIDesktopProviderSettings

export interface DesktopAgentSettings {
  schemaVersion: typeof DESKTOP_AGENT_SETTINGS_SCHEMA_VERSION
  revision: string
  updatedAt: string
  catalog: AgentConfigCatalog
  providerSettings: Record<string, DesktopProviderSettings>
  userLayer: AgentConfigLayer
  projectLayers: Record<string, AgentConfigLayer>
}

export type DesktopAgentSettingsInput = Omit<DesktopAgentSettings, 'revision' | 'updatedAt'>

export interface CredentialResolver {
  resolveCredential(ref: string): Promise<string | null>
}

export interface OpenAITransportFactoryInput {
  apiKey?: string
  baseUrl?: string
  organization?: string
  project?: string
  profileId: string
}

export type OpenAITransportFactory = (input: OpenAITransportFactoryInput) => OpenAIResponsesTransport

export interface OpenAIProviderCapabilities {
  contextWindow: number
  maxOutputTokens: number
}

export type OpenAIProviderCapabilityResolver = (input: {
  profile: ModelProfile
  settings: OpenAIDesktopProviderSettings
}) => OpenAIProviderCapabilities

export interface DesktopResolvedAgentConfiguration {
  settingsRevision: string
  catalog: AgentConfigCatalog
  layers: AgentConfigLayer[]
  providers: ModelProviderRegistration[]
  projectRulesRevision: string
  projectMemoryDocuments: ProjectMemoryDocument[]
}

export interface DesktopProjectMemoryStatusView {
  enabled: boolean
  profile: {
    id: string
    revision: string
    mode: 'minimal' | 'balanced' | 'extended'
    sourceBudgets: {
      runFacts: number
      session: number
      project: number
      user: number
    }
  }
  sources: {
    total: number
    byKind: {
      constraints: number
      documents: number
      knowledge: number
    }
    byTrust: {
      trustedProject: number
      untrusted: number
    }
  }
}

export interface DesktopOpenAIModelSettingsView {
  profileId: string
  provider: 'openai'
  providerId: string
  model: string
  connectionSource: 'credential-vault' | 'telance-local-proxy'
  connectionConfigured: boolean
  desktopAvailable: boolean
  availabilityReason?: string
  reasoningEffort: NonNullable<OpenAIDesktopProviderSettings['reasoningEffort']>
  verbosity: NonNullable<OpenAIDesktopProviderSettings['verbosity']>
}

export interface DesktopModelSelectionInput {
  providerId: string
  model: string
  reasoningEffort?: NonNullable<OpenAIDesktopProviderSettings['reasoningEffort']>
  verbosity?: NonNullable<OpenAIDesktopProviderSettings['verbosity']>
}

export interface DesktopEffectiveModelSelectionView extends DesktopOpenAIModelSettingsView {
  role: 'primary' | 'fallback'
  order: number
}

export interface DesktopEffectiveModelRouteView {
  routeId: string
  source: 'built_in' | 'user' | 'project'
  projectId?: string
  selections: DesktopEffectiveModelSelectionView[]
}

export interface DesktopBackendProviderOption {
  id: string
  name: string
  models: string[]
  defaultModel: string
  free: boolean
  configured: boolean
  transport: 'loopback-proxy' | 'browser-direct'
  desktopAvailable: boolean
}

export interface DesktopBackendProviderCatalogView {
  source: 'telance-local-proxy'
  label: string
  available: boolean
  activeProviderId: string
  providers: DesktopBackendProviderOption[]
  error?: string
}

export interface DesktopAgentSettingsView {
  settingsRevision: string
  providerCatalog: DesktopBackendProviderCatalogView
  models: DesktopOpenAIModelSettingsView[]
  effectiveModelRoute: DesktopEffectiveModelRouteView
  projectMemory?: DesktopProjectMemoryStatusView
}

export interface DesktopOpenAIModelSettingsPatch {
  expectedRevision: string
  profileId: string
  providerId: string
  model: string
  reasoningEffort: NonNullable<OpenAIDesktopProviderSettings['reasoningEffort']>
  verbosity: NonNullable<OpenAIDesktopProviderSettings['verbosity']>
}

export interface DesktopProjectModelRoutePatch {
  expectedRevision: string
  projectId: string
  primary: DesktopModelSelectionInput
  fallbacks: DesktopModelSelectionInput[]
}

export interface DesktopModelCredentialInput {
  profileId: string
  value: string
  expectedCredentialRevision: string
}

export interface DesktopModelCredentialDeleteInput {
  profileId: string
  expectedCredentialRevision: string
}

export type DesktopCredentialSnapshot = CredentialVaultSnapshot
