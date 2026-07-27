import { AgentCoreError, type ModelProvider } from '@electron-manager/agent-core'
import type { ModelProfile } from '@electron-manager/agent-config'

import type { ModelProviderBinding, ModelProviderRegistryLike } from './types.js'
import { promptCacheCapabilitySatisfies } from './cache.js'

export class ModelProviderRegistry implements ModelProviderRegistryLike {
  readonly #bindings = new Map<string, ModelProviderBinding>()

  constructor(bindings: Array<{ profile: ModelProfile; provider: ModelProvider }> = []) {
    for (const binding of bindings) this.register(binding.profile, binding.provider)
  }

  register(profile: ModelProfile, provider: ModelProvider) {
    validateProfileBinding(profile, provider)
    if (this.#bindings.has(profile.id)) {
      throw new AgentCoreError('INVALID_INPUT', `Duplicate model provider binding: ${profile.id}`)
    }
    this.#bindings.set(profile.id, { profile: copyProfile(profile), provider })
    return this
  }

  resolve(profileId: string): ModelProviderBinding {
    const binding = this.#bindings.get(profileId)
    if (!binding) throw new AgentCoreError('INVALID_INPUT', `Model provider is not registered: ${profileId}`)
    return { profile: copyProfile(binding.profile), provider: binding.provider }
  }

  list(): ModelProfile[] {
    return [...this.#bindings.values()]
      .map((binding) => copyProfile(binding.profile))
      .sort((left, right) => left.id.localeCompare(right.id))
  }
}

function validateProfileBinding(profile: ModelProfile, provider: ModelProvider) {
  if (!profile.id.trim() || !profile.revision.trim() || !profile.provider.trim() || !profile.model.trim()) {
    throw new AgentCoreError('INVALID_INPUT', 'Model profile id, revision, provider and model are required')
  }
  const actual = provider.profile
  const mismatch =
    (profile.capabilities.structuredOutput && !actual.supportsStructuredOutput)
    || (profile.capabilities.toolCalls && !actual.supportsToolCalls)
    || profile.capabilities.contextWindow > actual.contextWindow
    || profile.capabilities.maxOutputTokens > actual.maxOutputTokens
    || !promptCacheCapabilitySatisfies(actual.promptCache, profile.capabilities.promptCache)
  if (mismatch) {
    throw new AgentCoreError('INVALID_INPUT', `Provider capability does not satisfy model profile: ${profile.id}`, {
      details: { profileId: profile.id, providerProfileId: actual.id },
    })
  }
}

export function copyProfile(profile: ModelProfile): ModelProfile {
  return {
    id: profile.id,
    revision: profile.revision,
    provider: profile.provider,
    model: profile.model,
    ...(profile.endpointRef ? { endpointRef: profile.endpointRef } : {}),
    ...(profile.credentialRef ? { credentialRef: profile.credentialRef } : {}),
    capabilities: {
      structuredOutput: profile.capabilities.structuredOutput,
      toolCalls: profile.capabilities.toolCalls,
      contextWindow: profile.capabilities.contextWindow,
      maxOutputTokens: profile.capabilities.maxOutputTokens,
      promptCache: profile.capabilities.promptCache,
    },
  }
}
