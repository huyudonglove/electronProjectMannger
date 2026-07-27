import type { ModelProfile, ResolvedModelRoute } from '@electron-manager/agent-config'
import type {
  ModelAttemptRecord,
  ModelCapabilityProfile,
  ModelProvider,
  ModelStreamEvent,
  NormalizedProviderError,
  VersionedRunComponentSnapshot,
} from '@electron-manager/agent-core'

export interface ModelProviderBinding {
  profile: ModelProfile
  provider: ModelProvider
}

export interface ModelRouterOptions {
  route: ResolvedModelRoute
  registry: ModelProviderRegistryLike
  clock?: () => string
  now?: () => number
}

export interface ModelProviderRegistryLike {
  resolve(profileId: string): ModelProviderBinding
}

export interface ModelRouteSnapshot extends VersionedRunComponentSnapshot {
  schemaVersion: 1
}

export interface BufferedModelAttempt {
  record: ModelAttemptRecord
  events: ModelStreamEvent[]
  error?: NormalizedProviderError
}

export interface RoutedModelProfile extends ModelCapabilityProfile {
  id: string
}
