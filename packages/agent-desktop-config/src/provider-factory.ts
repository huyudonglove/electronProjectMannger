import type { AgentConfigLayer, ModelProfile } from '@electron-manager/agent-config'
import {
  FetchOpenAIResponsesTransport,
  OpenAIResponsesProvider,
} from '@electron-manager/agent-provider-openai'

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
}

export class DesktopModelProviderFactory {
  readonly #credentials: CredentialResolver
  readonly #openAITransportFactory: OpenAITransportFactory
  readonly #resolveOpenAICapabilities: OpenAIProviderCapabilityResolver

  constructor(options: DesktopModelProviderFactoryOptions) {
    this.#credentials = options.credentials
    this.#openAITransportFactory = options.openAITransportFactory || ((input) => new FetchOpenAIResponsesTransport(input))
    this.#resolveOpenAICapabilities = options.resolveOpenAICapabilities || resolveBuiltinOpenAICapabilities
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
  const baseUrl = input.settings.baseUrl?.replace(/\/+$/, '') || 'https://api.openai.com/v1'
  if (baseUrl !== 'https://api.openai.com/v1' || input.profile.model !== 'gpt-5.6') {
    throw new Error(`OpenAI capability metadata is unavailable for ${input.profile.model} at ${baseUrl}`)
  }
  return { contextWindow: 1_000_000, maxOutputTokens: 128_000 }
}

function selectedProfiles(settings: DesktopAgentSettings, layers: AgentConfigLayer[]): ModelProfile[] {
  const routeId = [...layers]
    .sort((left, right) => scopeRank(left.scope) - scopeRank(right.scope))
    .reduce((selected, layer) => layer.selections?.modelRouteId || selected, '')
  const route = settings.catalog.modelRoutes.find((candidate) => candidate.id === routeId)
  if (!route) throw new Error(`Selected model route does not exist: ${routeId || 'none'}`)
  return [route.primaryProfileId, ...route.fallbackProfileIds].map((id) => {
    const profile = settings.catalog.modelProfiles.find((candidate) => candidate.id === id)
    if (!profile) throw new Error(`Model route references an unknown profile: ${id}`)
    return profile
  })
}

function scopeRank(scope: AgentConfigLayer['scope']) {
  return scope === 'built_in' ? 0 : scope === 'user' ? 1 : scope === 'project' ? 2 : 3
}
