import { createHash } from 'node:crypto'

import {
  AgentCoreError,
  type ModelRequest,
  type PromptCacheBinding,
  type PromptCacheCapability,
  type PromptCachePolicy,
} from '@electron-manager/agent-core'

import type { ModelProviderBinding } from './types.js'

const capabilityRank: Record<PromptCacheCapability, number> = { none: 0, implicit: 1, explicit: 2 }

export function bindPromptCacheRequest(request: ModelRequest, binding: ModelProviderBinding): ModelRequest {
  if (!request.promptCache) {
    const copy = structuredClone(request)
    delete copy.promptCacheBinding
    return copy
  }
  return {
    ...structuredClone(request),
    promptCacheBinding: createPromptCacheBinding(request.promptCache, binding),
  }
}

export function createPromptCacheBinding(
  policy: PromptCachePolicy,
  binding: ModelProviderBinding,
): PromptCacheBinding {
  validatePolicy(policy)
  const capability = binding.provider.profile.promptCache
  if (policy.mode === 'require_explicit' && capability !== 'explicit') {
    throw new AgentCoreError('MODEL_ERROR', `Model does not support required explicit prompt caching: ${binding.profile.id}`, {
      details: { modelErrorCategory: 'capability_mismatch', profileId: binding.profile.id, capability },
    })
  }
  if (policy.mode === 'none' || capability === 'none') {
    return {
      capability: 'none',
      provider: binding.profile.provider,
      model: binding.profile.model,
      profileRevision: binding.profile.revision,
    }
  }
  return {
    capability,
    provider: binding.profile.provider,
    model: binding.profile.model,
    profileRevision: binding.profile.revision,
    cacheKey: createPromptCacheKey(policy, binding),
  }
}

export function promptCacheCapabilitySatisfies(actual: PromptCacheCapability, required: PromptCacheCapability) {
  return capabilityRank[actual] >= capabilityRank[required]
}

export function createPromptCacheKey(policy: PromptCachePolicy, binding: ModelProviderBinding) {
  validatePolicy(policy)
  return createHash('sha256').update(canonicalJson({
    provider: binding.profile.provider,
    model: binding.profile.model,
    profileRevision: binding.profile.revision,
    credentialScope: binding.profile.credentialRef || binding.profile.id,
    stablePrefixRevision: policy.stablePrefixRevision,
    promptProfileRevision: policy.promptProfileRevision,
    toolRegistryRevision: policy.toolRegistryRevision,
    actionSchemaRevision: policy.actionSchemaRevision,
    projectRulesRevision: policy.projectRulesRevision,
    privacyScopeRevision: policy.privacyScopeRevision,
  })).digest('hex')
}

function validatePolicy(policy: PromptCachePolicy) {
  const values = [
    policy.stablePrefixRevision,
    policy.promptProfileRevision,
    policy.toolRegistryRevision,
    policy.actionSchemaRevision,
    policy.projectRulesRevision,
    policy.privacyScopeRevision,
  ]
  if (values.some((value) => !value.trim())) throw new AgentCoreError('INVALID_INPUT', 'Prompt cache policy revisions are required')
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
