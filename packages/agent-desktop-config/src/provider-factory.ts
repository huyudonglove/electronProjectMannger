import type { AgentConfigLayer, ModelProfile } from '@electron-manager/agent-config'
import {
  FetchOpenAIResponsesTransport,
  OpenAIChatCompletionsProvider,
  OpenAIResponsesProvider,
} from '@electron-manager/agent-provider-openai'

import { desktopOpenAIModelCapabilities } from './model-name.js'
import type {
  CredentialResolver,
  DesktopAgentSettings,
  OpenAIProviderCapabilityResolver,
  OpenAITransportFactory,
} from './types.js'

export interface DesktopModelProviderFactoryOptions {
  credentials: CredentialResolver
  openAITransportFactory?: OpenAITransportFactory
  resolveOpenAICapabilities?: OpenAIProviderCapabilityResolver
  onModelDiagnostic?: ConstructorParameters<typeof OpenAIChatCompletionsProvider>[0]['onDiagnostic']
}

export class DesktopModelProviderFactory {
  readonly #credentials: CredentialResolver
  readonly #openAITransportFactory: OpenAITransportFactory
  readonly #resolveOpenAICapabilities: OpenAIProviderCapabilityResolver
  readonly #onModelDiagnostic?: DesktopModelProviderFactoryOptions['onModelDiagnostic']

  constructor(options: DesktopModelProviderFactoryOptions) {
    this.#credentials = options.credentials
    this.#openAITransportFactory = options.openAITransportFactory || ((input) => new FetchOpenAIResponsesTransport(input))
    this.#resolveOpenAICapabilities = options.resolveOpenAICapabilities || resolveBuiltinOpenAICapabilities
    this.#onModelDiagnostic = options.onModelDiagnostic
  }

  async createRegistrations(settings: DesktopAgentSettings, layers: AgentConfigLayer[]) {
    const profiles = selectedProfiles(settings, layers)
    return await Promise.all(profiles.map(async (profile) => {
      if (profile.provider !== 'openai') throw new Error(`Unsupported desktop model provider: ${profile.provider}`)
      const credentialRef = profile.credentialRef
      if (!credentialRef) throw new Error(`Model profile is missing credentialRef: ${profile.id}`)
      const providerSettings = settings.providerSettings[profile.id]
      if (!providerSettings || providerSettings.provider !== 'openai') {
        throw new Error(`OpenAI provider settings are missing: ${profile.id}`)
      }
      const capabilities = this.#resolveOpenAICapabilities({ profile, settings: providerSettings })
      if (providerSettings.apiStyle === 'chat-completions') {
        if (!providerSettings.baseUrl) throw new Error(`Chat Completions base URL is missing: ${profile.id}`)
        return {
          profileId: profile.id,
          provider: new OpenAIChatCompletionsProvider({
            baseUrl: providerSettings.baseUrl,
            providerId: providerSettings.providerId,
            model: profile.model,
            contextWindow: capabilities.contextWindow,
            maxOutputTokens: capabilities.maxOutputTokens,
            toolChoice: providerSettings.providerId === 'deepseek' ? 'auto' : 'named',
            onDiagnostic: this.#onModelDiagnostic,
          }),
        }
      }
      const apiKey = await this.#credentials.resolveCredential(credentialRef)
      if (!apiKey?.trim()) throw new Error(`Credential is unavailable: ${credentialRef}`)
      const transport = this.#openAITransportFactory({
        apiKey,
        profileId: profile.id,
        ...(providerSettings.baseUrl ? { baseUrl: providerSettings.baseUrl } : {}),
        ...(providerSettings.organization ? { organization: providerSettings.organization } : {}),
        ...(providerSettings.project ? { project: providerSettings.project } : {}),
      })
      return {
        profileId: profile.id,
        provider: new OpenAIResponsesProvider({
          transport,
          model: profile.model,
          contextWindow: capabilities.contextWindow,
          maxOutputTokens: capabilities.maxOutputTokens,
          ...(providerSettings.reasoningEffort ? { reasoningEffort: providerSettings.reasoningEffort } : {}),
          ...(providerSettings.verbosity ? { verbosity: providerSettings.verbosity } : {}),
        }),
      }
    }))
  }
}

function resolveBuiltinOpenAICapabilities(input: Parameters<OpenAIProviderCapabilityResolver>[0]) {
  return desktopOpenAIModelCapabilities(input.profile.model)
}

function selectedProfiles(settings: DesktopAgentSettings, layers: AgentConfigLayer[]): ModelProfile[] {
  const sortedLayers = [...layers].sort((left, right) => scopeRank(left.scope) - scopeRank(right.scope))
  const routeId = sortedLayers.reduce((selected, layer) => layer.selections?.modelRouteId || selected, '')
  const memoryProfileId = sortedLayers.reduce((selected, layer) => layer.selections?.memoryProfileId || selected, '')
  const memoryProfile = settings.catalog.memoryProfiles.find((candidate) => candidate.id === memoryProfileId)
  if (!memoryProfile) throw new Error(`Selected memory profile does not exist: ${memoryProfileId || 'none'}`)
  const routeIds = [routeId, memoryProfile.summarizerRouteId].filter((id): id is string => Boolean(id))
  const profileIds = routeIds.flatMap((selectedRouteId) => {
    const route = settings.catalog.modelRoutes.find((candidate) => candidate.id === selectedRouteId)
    if (!route) throw new Error(`Selected model route does not exist: ${selectedRouteId || 'none'}`)
    return [route.primaryProfileId, ...route.fallbackProfileIds]
  })
  return [...new Set(profileIds)].map((id) => {
    const profile = settings.catalog.modelProfiles.find((candidate) => candidate.id === id)
    if (!profile) throw new Error(`Model route references an unknown profile: ${id}`)
    return profile
  })
}

function scopeRank(scope: AgentConfigLayer['scope']) {
  return scope === 'built_in' ? 0 : scope === 'user' ? 1 : scope === 'project' ? 2 : 3
}
