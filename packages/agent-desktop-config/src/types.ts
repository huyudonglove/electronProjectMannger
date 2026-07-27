import type {
  AgentConfigCatalog,
  AgentConfigLayer,
  ModelProfile,
} from '@electron-manager/agent-config'
import type { OpenAIResponsesTransport } from '@electron-manager/agent-provider-openai'
import type { ModelProviderRegistration } from '@electron-manager/agent-runner'

export const DESKTOP_AGENT_SETTINGS_SCHEMA_VERSION = 1 as const

export interface OpenAIDesktopProviderSettings {
  provider: 'openai'
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
  apiKey: string
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
}
