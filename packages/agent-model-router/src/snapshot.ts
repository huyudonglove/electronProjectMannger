import { createHash } from 'node:crypto'

import type { JsonValue } from '@electron-manager/agent-core'
import type { ResolvedModelRoute } from '@electron-manager/agent-config'

import { copyProfile } from './registry.js'
import type { ModelProviderBinding, ModelRouteSnapshot } from './types.js'

export function createModelRouteSnapshot(route: ResolvedModelRoute, bindings: ModelProviderBinding[]): ModelRouteSnapshot {
  const data = jsonRecord({
    route: {
      id: route.route.id,
      revision: route.route.revision,
      primaryProfileId: route.route.primaryProfileId,
      fallbackProfileIds: [...route.route.fallbackProfileIds],
      requirements: route.route.requirements,
      retry: route.route.retry,
    },
    profiles: bindings.map((binding) => ({
      ...copyProfile(binding.profile),
      providerCapabilityId: binding.provider.profile.id,
    })),
  })
  return {
    schemaVersion: 1,
    revision: createHash('sha256').update(canonicalJson(data)).digest('hex'),
    data,
  }
}

function jsonRecord(value: unknown): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>
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
