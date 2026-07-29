import { createHash } from 'node:crypto'

import { DesktopAgentSettingsStore } from './settings-store.js'
import { desktopOpenAIModelCapabilities, normalizeDesktopModelName } from './model-name.js'
import { DesktopBackendProviderCatalog } from './provider-catalog.js'
import type {
  DesktopAgentSettings,
  DesktopAgentSettingsView,
  DesktopBackendProviderCatalogView,
  DesktopEffectiveModelRouteView,
  DesktopOpenAIModelSettingsPatch,
  DesktopOpenAIModelSettingsView,
  DesktopProjectModelRoutePatch,
  DesktopModelSelectionInput,
  OpenAIDesktopProviderSettings,
} from './types.js'

const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])
const VERBOSITIES = new Set(['low', 'medium', 'high'])

export class DesktopAgentSettingsService {
  readonly #store: DesktopAgentSettingsStore
  readonly #providers: DesktopBackendProviderCatalog

  constructor(options: {
    store: DesktopAgentSettingsStore
    providers?: DesktopBackendProviderCatalog
  }) {
    this.#store = options.store
    this.#providers = options.providers || new DesktopBackendProviderCatalog()
  }

  async getView(projectId = ''): Promise<DesktopAgentSettingsView> {
    const [settings, providerCatalog] = await Promise.all([
      this.#store.loadOrCreate(),
      this.#providers.getView(),
    ])
    const effectiveModelRoute = effectiveModelRouteView(settings, providerCatalog, projectId)
    return {
      settingsRevision: settings.revision,
      providerCatalog,
      models: effectiveModelRoute.selections.map(({ role: _role, order: _order, ...model }) => model),
      effectiveModelRoute,
    }
  }

  async updateOpenAIModel(input: DesktopOpenAIModelSettingsPatch): Promise<DesktopAgentSettingsView> {
    const providerCatalog = await this.#providers.getView()
    if (!providerCatalog.available) {
      throw new Error(providerCatalog.error || 'Chrome Extion 本机 Provider 服务不可用')
    }
    const providerOption = providerCatalog.providers.find((provider) => provider.id === input.providerId)
    if (!providerOption) throw new Error(`后台 Provider 不存在：${input.providerId || 'empty'}`)
    if (!providerOption.configured) throw new Error(`后台 Provider 尚未配置连接凭据：${providerOption.name}`)
    if (!providerOption.desktopAvailable) throw new Error(`Provider 仅支持 Chrome 浏览器直连：${providerOption.name}`)
    const model = normalizeDesktopModelName(input.model)
    if (!providerOption.models.includes(model)) {
      throw new Error(`模型不属于后台 Provider ${providerOption.name}：${model}`)
    }
    const reasoningEffort = String(input.reasoningEffort || '')
    const verbosity = String(input.verbosity || '')
    if (!REASONING_EFFORTS.has(reasoningEffort)) throw new Error(`Unsupported reasoning effort: ${reasoningEffort || 'empty'}`)
    if (!VERBOSITIES.has(verbosity)) throw new Error(`Unsupported response verbosity: ${verbosity || 'empty'}`)
    await this.#store.update(input.expectedRevision, (draft) => {
      const profile = requireOpenAIProfile(draft, input.profileId)
      profile.model = model
      profile.capabilities = {
        ...profile.capabilities,
        ...desktopOpenAIModelCapabilities(model),
      }
      draft.providerSettings[input.profileId] = {
        provider: 'openai',
        providerId: providerOption.id,
        connectionSource: 'telance-local-proxy',
        apiStyle: 'auto',
        baseUrl: this.#providers.proxyBaseUrl(providerOption.id),
        reasoningEffort: reasoningEffort as NonNullable<OpenAIDesktopProviderSettings['reasoningEffort']>,
        verbosity: verbosity as NonNullable<OpenAIDesktopProviderSettings['verbosity']>,
      }
    })
    return await this.getView()
  }

  async updateProjectModelRoute(input: DesktopProjectModelRoutePatch): Promise<DesktopAgentSettingsView> {
    const projectId = String(input.projectId || '').trim()
    if (!projectId) throw new Error('Project id is required')
    if (!input.primary) throw new Error('Primary model selection is required')
    if (!Array.isArray(input.fallbacks) || input.fallbacks.length > 4) throw new Error('At most four fallback models are supported')
    const providerCatalog = await this.#providers.getView()
    if (!providerCatalog.available) throw new Error(providerCatalog.error || 'Chrome Extion 本机 Provider 服务不可用')
    const selections = [input.primary, ...input.fallbacks].map((selection) => validatedSelection(selection, providerCatalog))
    const keys = selections.map((selection) => `${selection.providerId}\u0000${selection.model}`)
    if (new Set(keys).size !== keys.length) throw new Error('Primary and fallback model selections must be distinct')

    await this.#store.update(input.expectedRevision, (draft) => {
      const existingLayer = draft.projectLayers[projectId]
      const existingRouteId = existingLayer?.selections?.modelRouteId
      const existingRoute = draft.catalog.modelRoutes.find((candidate) => candidate.id === existingRouteId)
      const previousProfileIds = existingRoute ? [existingRoute.primaryProfileId, ...existingRoute.fallbackProfileIds] : []
      const profileIds = selections.map((selection) => upsertProjectProfile(draft, projectId, selection, this.#providers))
      const routeId = projectRouteId(projectId)
      const routeRevision = shortHash(profileIds.map((profileId) => {
        const profile = draft.catalog.modelProfiles.find((candidate) => candidate.id === profileId)
        return `${profileId}:${profile?.revision || ''}`
      }).join('|'))
      const route: DesktopAgentSettings['catalog']['modelRoutes'][number] = {
        id: routeId,
        revision: routeRevision,
        primaryProfileId: profileIds[0]!,
        fallbackProfileIds: profileIds.slice(1),
        requirements: {
          structuredOutput: true,
          toolCalls: true,
          minContextWindow: 32_000,
          minOutputTokens: 8_000,
        },
        retry: {
          maxAttempts: Math.max(1, profileIds.length),
          totalTimeoutMs: 180_000,
          totalTokenBudget: 120_000,
          retryableErrors: ['rate_limit', 'timeout', 'service_unavailable', 'transport', 'invalid_output'],
        },
      }
      const routeIndex = draft.catalog.modelRoutes.findIndex((candidate) => candidate.id === routeId)
      if (routeIndex >= 0) draft.catalog.modelRoutes[routeIndex] = route
      else draft.catalog.modelRoutes.push(route)
      draft.projectLayers[projectId] = {
        ...(existingLayer || {}),
        scope: 'project',
        revision: `project-model-route-${routeRevision}`,
        selections: { ...(existingLayer?.selections || {}), modelRouteId: routeId },
      }
      removeUnreferencedProjectProfiles(draft, projectId, previousProfileIds.filter((profileId) => !profileIds.includes(profileId)))
    })
    return await this.getView(projectId)
  }
}

function validatedSelection(
  input: DesktopModelSelectionInput,
  catalog: DesktopBackendProviderCatalogView,
): Required<DesktopModelSelectionInput> {
  const providerId = String(input?.providerId || '').trim()
  const provider = catalog.providers.find((candidate) => candidate.id === providerId)
  if (!provider) throw new Error(`后台 Provider 不存在：${providerId || 'empty'}`)
  if (!provider.configured) throw new Error(`后台 Provider 尚未配置连接凭据：${provider.name}`)
  if (!provider.desktopAvailable) throw new Error(`Provider 仅支持 Chrome 浏览器直连：${provider.name}`)
  const model = normalizeDesktopModelName(input.model)
  if (!provider.models.includes(model)) throw new Error(`模型不属于后台 Provider ${provider.name}：${model}`)
  const reasoningEffort = String(input.reasoningEffort || 'medium')
  const verbosity = String(input.verbosity || 'low')
  if (!REASONING_EFFORTS.has(reasoningEffort)) throw new Error(`Unsupported reasoning effort: ${reasoningEffort}`)
  if (!VERBOSITIES.has(verbosity)) throw new Error(`Unsupported response verbosity: ${verbosity}`)
  return {
    providerId,
    model,
    reasoningEffort: reasoningEffort as Required<DesktopModelSelectionInput>['reasoningEffort'],
    verbosity: verbosity as Required<DesktopModelSelectionInput>['verbosity'],
  }
}

function upsertProjectProfile(
  settings: Pick<DesktopAgentSettings, 'catalog' | 'providerSettings'>,
  projectId: string,
  selection: Required<DesktopModelSelectionInput>,
  providers: DesktopBackendProviderCatalog,
) {
  const profileId = projectProfileId(projectId, selection.providerId, selection.model)
  const capabilities = desktopOpenAIModelCapabilities(selection.model)
  const revision = shortHash(JSON.stringify({ selection, capabilities }))
  const profile = {
    id: profileId,
    revision,
    provider: 'openai',
    model: selection.model,
    credentialRef: `credential.openai.project.${shortHash(projectId)}`,
    capabilities: {
      structuredOutput: true,
      toolCalls: true,
      contextWindow: capabilities.contextWindow,
      maxOutputTokens: capabilities.maxOutputTokens,
      promptCache: 'implicit' as const,
    },
  }
  const profileIndex = settings.catalog.modelProfiles.findIndex((candidate) => candidate.id === profileId)
  if (profileIndex >= 0) settings.catalog.modelProfiles[profileIndex] = profile
  else settings.catalog.modelProfiles.push(profile)
  settings.providerSettings[profileId] = {
    provider: 'openai',
    providerId: selection.providerId,
    connectionSource: 'telance-local-proxy',
    apiStyle: 'auto',
    baseUrl: providers.proxyBaseUrl(selection.providerId),
    reasoningEffort: selection.reasoningEffort,
    verbosity: selection.verbosity,
  }
  return profileId
}

function removeUnreferencedProjectProfiles(
  settings: Pick<DesktopAgentSettings, 'catalog' | 'providerSettings'>,
  projectId: string,
  candidates: string[],
) {
  const prefix = `desktop.model.project.${shortHash(projectId)}.`
  const referenced = new Set(settings.catalog.modelRoutes.flatMap((route) => [route.primaryProfileId, ...route.fallbackProfileIds]))
  const removable = new Set(candidates.filter((profileId) => profileId.startsWith(prefix) && !referenced.has(profileId)))
  if (!removable.size) return
  settings.catalog.modelProfiles = settings.catalog.modelProfiles.filter((profile) => !removable.has(profile.id))
  for (const profileId of removable) delete settings.providerSettings[profileId]
}

function effectiveModelRouteView(
  settings: DesktopAgentSettings,
  providerCatalog: DesktopBackendProviderCatalogView,
  projectId: string,
): DesktopEffectiveModelRouteView {
  const builtinRouteId = settings.catalog.modelRoutes[0]?.id || ''
  const userRouteId = settings.userLayer.selections?.modelRouteId || builtinRouteId
  const projectRouteId = projectId ? settings.projectLayers[projectId]?.selections?.modelRouteId : undefined
  const routeId = projectRouteId || userRouteId
  const source: DesktopEffectiveModelRouteView['source'] = projectRouteId
    ? 'project'
    : settings.userLayer.selections?.modelRouteId ? 'user' : 'built_in'
  const route = settings.catalog.modelRoutes.find((candidate) => candidate.id === routeId)
  if (!route) throw new Error(`Selected model route does not exist: ${routeId || 'none'}`)
  const profileIds = [route.primaryProfileId, ...route.fallbackProfileIds]
  return {
    routeId,
    source,
    ...(projectId ? { projectId } : {}),
    selections: profileIds.map((profileId, index) => ({
      ...modelView(settings, providerCatalog, profileId),
      role: index === 0 ? 'primary' : 'fallback',
      order: index,
    })),
  }
}

function modelView(
  settings: DesktopAgentSettings,
  providerCatalog: DesktopBackendProviderCatalogView,
  profileId: string,
): DesktopOpenAIModelSettingsView {
  const profile = requireOpenAIProfile(settings, profileId)
  const provider = requireProviderSettings(settings, profile.id)
  const providerId = provider.providerId || providerIdFromProxyBaseUrl(provider.baseUrl) || 'openai'
  const option = providerCatalog.providers.find((candidate) => candidate.id === providerId)
  const modelAvailable = Boolean(option?.models.includes(profile.model))
  const desktopAvailable = Boolean(option?.desktopAvailable && modelAvailable)
  return {
    profileId: profile.id,
    provider: 'openai',
    providerId,
    model: profile.model,
    connectionSource: provider.connectionSource || 'credential-vault',
    connectionConfigured: desktopAvailable,
    desktopAvailable,
    ...(!option ? { availabilityReason: '后台 Provider 不在当前安全清单中' }
      : !option.configured ? { availabilityReason: '后台 Provider 尚未配置' }
        : !option.desktopAvailable ? { availabilityReason: 'Provider 仅支持 Chrome 浏览器直连' }
          : !modelAvailable ? { availabilityReason: '模型不在 Provider 当前清单中' } : {}),
    reasoningEffort: provider.reasoningEffort || 'medium',
    verbosity: provider.verbosity || 'low',
  }
}

function projectRouteId(projectId: string) {
  return `desktop.route.project.${shortHash(projectId)}`
}

function projectProfileId(projectId: string, providerId: string, model: string) {
  return `desktop.model.project.${shortHash(projectId)}.${shortHash(`${providerId}\u0000${model}`)}`
}

function shortHash(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function requireOpenAIProfile(settings: Pick<DesktopAgentSettings, 'catalog'>, profileId: string) {
  const profile = settings.catalog.modelProfiles.find((candidate) => candidate.id === profileId)
  if (!profile) throw new Error(`Desktop model profile does not exist: ${profileId || 'empty'}`)
  if (profile.provider !== 'openai') throw new Error(`Unsupported desktop model provider: ${profile.provider}`)
  return profile
}

function requireProviderSettings(settings: DesktopAgentSettings, profileId: string) {
  const provider = settings.providerSettings[profileId]
  if (!provider || provider.provider !== 'openai') throw new Error(`OpenAI provider settings are missing: ${profileId}`)
  return provider
}

function resolveProviderId(
  settings: OpenAIDesktopProviderSettings,
  catalog: DesktopBackendProviderCatalogView,
) {
  if (settings.providerId && catalog.providers.some((provider) => provider.id === settings.providerId)) {
    return settings.providerId
  }
  const pathProviderId = providerIdFromProxyBaseUrl(settings.baseUrl)
  if (pathProviderId && catalog.providers.some((provider) => provider.id === pathProviderId)) {
    return pathProviderId
  }
  if (catalog.activeProviderId && catalog.providers.some((provider) => provider.id === catalog.activeProviderId && provider.desktopAvailable)) {
    return catalog.activeProviderId
  }
  return catalog.providers.find((provider) => provider.desktopAvailable)?.id || catalog.providers[0]?.id || ''
}

function providerIdFromProxyBaseUrl(baseUrl?: string) {
  try {
    const match = new URL(String(baseUrl || '')).pathname.match(/^\/provider\/([^/]+)(?:\/|$)/)
    return match ? decodeURIComponent(match[1]) : ''
  } catch {
    return ''
  }
}
