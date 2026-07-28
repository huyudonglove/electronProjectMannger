import { createHash } from 'node:crypto'

import {
  createBuiltinConfigLayer,
  type AgentConfigLayer,
} from '@electron-manager/agent-config'
import { getDashboard } from '@electron-manager/project-core'

import { DEFAULT_LOCAL_AGENT_TOOLS } from './defaults.js'
import { desktopAgentProjectStoragePaths } from './paths.js'
import { DesktopModelProviderFactory } from './provider-factory.js'
import { DesktopAgentSettingsStore } from './settings-store.js'
import { projectMemoryDocumentsFromDashboard } from './project-memory-documents.js'
import { desktopProjectMemoryStatus } from './project-memory-status.js'
import type { DesktopResolvedAgentConfiguration } from './types.js'

export interface DesktopAgentConfigServiceOptions {
  managerDataRoot: string
  store: DesktopAgentSettingsStore
  providers: DesktopModelProviderFactory
}

export class DesktopAgentConfigService {
  readonly #managerDataRoot: string
  readonly #store: DesktopAgentSettingsStore
  readonly #providers: DesktopModelProviderFactory

  constructor(options: DesktopAgentConfigServiceOptions) {
    if (!options.managerDataRoot.trim()) throw new Error('Manager data root is required')
    this.#managerDataRoot = options.managerDataRoot
    this.#store = options.store
    this.#providers = options.providers
  }

  async resolve(projectRoot: string, runLayer?: AgentConfigLayer): Promise<DesktopResolvedAgentConfiguration> {
    const [settings, dashboard] = await Promise.all([
      this.#store.loadOrCreate(),
      getDashboard(this.#managerDataRoot, projectRoot),
    ])
    const runtimeSettings = structuredClone(settings)
    for (const route of runtimeSettings.catalog.modelRoutes) {
      if (!route.retry.retryableErrors.includes('invalid_output')) route.retry.retryableErrors.push('invalid_output')
    }
    if (runLayer && runLayer.scope !== 'run') throw new Error('Desktop Agent run override must use run scope')
    const builtinRoute = runtimeSettings.catalog.modelRoutes[0]
    if (!builtinRoute) throw new Error('Desktop Agent settings have no model route')
    const userLayer = structuredClone(runtimeSettings.userLayer)
    const layers = [
      createBuiltinConfigLayer(builtinRoute.id, [...DEFAULT_LOCAL_AGENT_TOOLS]),
      userLayer,
      ...(runtimeSettings.projectLayers[dashboard.config.projectId]
        ? [structuredClone(runtimeSettings.projectLayers[dashboard.config.projectId])]
        : []),
      ...(runLayer ? [structuredClone(runLayer)] : []),
    ]
    userLayer.revision = effectiveUserLayerRevision(runtimeSettings, layers)
    return {
      settingsRevision: settings.revision,
      catalog: structuredClone(runtimeSettings.catalog),
      layers,
      providers: await this.#providers.createRegistrations(runtimeSettings, layers),
      projectRulesRevision: projectRulesRevision(dashboard),
      projectMemoryDocuments: projectMemoryDocumentsFromDashboard(dashboard),
    }
  }

  async getProjectMemoryStatus(projectRoot: string) {
    const [settings, dashboard] = await Promise.all([
      this.#store.loadOrCreate(),
      getDashboard(this.#managerDataRoot, projectRoot),
    ])
    const builtinRoute = settings.catalog.modelRoutes[0]
    if (!builtinRoute) throw new Error('Desktop Agent settings have no model route')
    const layers = [
      createBuiltinConfigLayer(builtinRoute.id, [...DEFAULT_LOCAL_AGENT_TOOLS]),
      structuredClone(settings.userLayer),
      ...(settings.projectLayers[dashboard.config.projectId]
        ? [structuredClone(settings.projectLayers[dashboard.config.projectId])]
        : []),
    ]
    return desktopProjectMemoryStatus({
      catalog: settings.catalog,
      layers,
      documents: projectMemoryDocumentsFromDashboard(dashboard),
    })
  }

  async storageFor(projectRoot: string) {
    const dashboard = await getDashboard(this.#managerDataRoot, projectRoot)
    return desktopAgentProjectStoragePaths(this.#managerDataRoot, dashboard.config.projectId)
  }
}

function effectiveUserLayerRevision(
  settings: Awaited<ReturnType<DesktopAgentSettingsStore['loadOrCreate']>>,
  layers: AgentConfigLayer[],
) {
  const routeId = layers.reduce((selected, layer) => layer.selections?.modelRouteId || selected, '')
  const route = settings.catalog.modelRoutes.find((candidate) => candidate.id === routeId)
  if (!route) throw new Error(`Selected model route does not exist: ${routeId || 'none'}`)
  const providerRuntime = [route.primaryProfileId, ...route.fallbackProfileIds].map((profileId) => ({
    profileId,
    settings: settings.providerSettings[profileId],
  }))
  return createHash('sha256').update(canonicalJson({
    declaredRevision: settings.userLayer.revision,
    providerRuntime,
  })).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function projectRulesRevision(dashboard: Awaited<ReturnType<typeof getDashboard>>) {
  const facts = {
    constraints: dashboard.constraints
      .filter((constraint) => constraint.status === 'active' || constraint.status === 'readonly')
      .map((constraint) => [constraint.id, constraint.updated, constraint.summary])
      .sort((left, right) => left[0].localeCompare(right[0])),
    instructions: [...dashboard.agentBrief.instructions],
  }
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex')
}
