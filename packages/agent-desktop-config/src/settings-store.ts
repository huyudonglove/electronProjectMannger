import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { AgentConfigRegistry } from '@electron-manager/agent-config'

import { createDefaultDesktopAgentSettingsInput } from './defaults.js'
import { normalizeDesktopModelName } from './model-name.js'
import { normalizeDesktopOpenAIBaseUrl } from './openai-endpoint.js'
import {
  DESKTOP_AGENT_SETTINGS_SCHEMA_VERSION,
  type DesktopAgentSettings,
  type DesktopAgentSettingsInput,
} from './types.js'

export class DesktopAgentSettingsStore {
  readonly filePath: string
  readonly #clock: () => string
  #queue: Promise<void> = Promise.resolve()

  constructor(filePath: string, options: { clock?: () => string } = {}) {
    if (!filePath.trim()) throw new Error('Desktop Agent settings path is required')
    this.filePath = path.resolve(filePath)
    this.#clock = options.clock || (() => new Date().toISOString())
  }

  async load(): Promise<DesktopAgentSettings | null> {
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (isNotFound(error)) return null
      throw error
    }
    let parsed: DesktopAgentSettings
    try {
      parsed = JSON.parse(raw) as DesktopAgentSettings
    } catch (error) {
      throw new Error(`Desktop Agent settings are not valid JSON: ${this.filePath}`, { cause: error })
    }
    validateStoredSettings(parsed)
    return structuredClone(parsed)
  }

  async loadOrCreate(): Promise<DesktopAgentSettings> {
    return await this.#exclusive(async () => {
      const existing = await this.load()
      if (existing) return existing
      return await this.#write(createDefaultDesktopAgentSettingsInput())
    })
  }

  async save(input: DesktopAgentSettingsInput, expectedRevision?: string): Promise<DesktopAgentSettings> {
    return await this.#exclusive(async () => {
      const current = await this.load()
      if (expectedRevision !== undefined && current?.revision !== expectedRevision) {
        throw new Error(`Desktop Agent settings revision conflict: expected ${expectedRevision}, actual ${current?.revision || 'missing'}`)
      }
      validateSettingsInput(input)
      const nextRevision = revisionOf(input)
      if (current?.revision === nextRevision) return current
      return await this.#write(input)
    })
  }

  async update(
    expectedRevision: string,
    mutate: (draft: DesktopAgentSettingsInput) => void | DesktopAgentSettingsInput,
  ): Promise<DesktopAgentSettings> {
    return await this.#exclusive(async () => {
      const current = await this.load()
      if (!current || current.revision !== expectedRevision) {
        throw new Error(`Desktop Agent settings revision conflict: expected ${expectedRevision}, actual ${current?.revision || 'missing'}`)
      }
      const draft = settingsInputFrom(current)
      const changed = mutate(draft) || draft
      validateSettingsInput(changed)
      if (revisionOf(changed) === current.revision) return current
      return await this.#write(changed)
    })
  }

  async #write(input: DesktopAgentSettingsInput) {
    validateSettingsInput(input)
    const settings: DesktopAgentSettings = {
      ...structuredClone(input),
      revision: revisionOf(input),
      updatedAt: this.#clock(),
    }
    await atomicWrite(this.filePath, `${JSON.stringify(settings, null, 2)}\n`)
    return structuredClone(settings)
  }

  async #exclusive<T>(operation: () => Promise<T>) {
    const previous = this.#queue
    let release!: () => void
    this.#queue = new Promise<void>((resolve) => { release = resolve })
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

export function validateSettingsInput(input: DesktopAgentSettingsInput) {
  if (!input || input.schemaVersion !== DESKTOP_AGENT_SETTINGS_SCHEMA_VERSION) {
    throw new Error(`Unsupported Desktop Agent settings schema: ${input?.schemaVersion}`)
  }
  new AgentConfigRegistry(input.catalog)
  if (!input.catalog.modelProfiles.length || !input.catalog.modelRoutes.length) {
    throw new Error('Desktop Agent settings require at least one model profile and route')
  }
  if (input.userLayer.scope !== 'user' || !input.userLayer.revision.trim()) {
    throw new Error('Desktop Agent user layer must use user scope and a revision')
  }
  for (const [projectId, layer] of Object.entries(input.projectLayers)) {
    if (!projectId.trim() || layer.scope !== 'project' || !layer.revision.trim()) {
      throw new Error(`Desktop Agent project layer is invalid: ${projectId || 'empty'}`)
    }
  }
  const modelIds = new Set(input.catalog.modelProfiles.map((profile) => profile.id))
  const routeIds = new Set(input.catalog.modelRoutes.map((route) => route.id))
  for (const route of input.catalog.modelRoutes) {
    for (const profileId of [route.primaryProfileId, ...route.fallbackProfileIds]) {
      if (!modelIds.has(profileId)) throw new Error(`Model route references an unknown profile: ${route.id} -> ${profileId}`)
    }
  }
  for (const profile of input.catalog.modelProfiles) {
    if (profile.provider !== 'openai') throw new Error(`Unsupported desktop model provider: ${profile.provider}`)
    const normalizedModel = normalizeDesktopModelName(profile.model)
    if (profile.model !== normalizedModel) throw new Error(`OpenAI model name must be trimmed: ${profile.id}`)
    if (!profile.credentialRef || !/^credential\.[A-Za-z0-9._-]+$/.test(profile.credentialRef)) {
      throw new Error(`Model profile must use a credential reference: ${profile.id}`)
    }
    const provider = input.providerSettings[profile.id]
    if (!provider || provider.provider !== profile.provider) throw new Error(`Provider settings are missing for model profile: ${profile.id}`)
    if (provider.baseUrl) normalizeDesktopOpenAIBaseUrl(provider.baseUrl)
    if (provider.connectionSource === 'telance-local-proxy') validateTelanceProviderSettings(profile.id, provider)
  }
  for (const id of Object.keys(input.providerSettings)) {
    if (!modelIds.has(id)) throw new Error(`Provider settings reference an unknown model profile: ${id}`)
  }
  validateLayerSelections(input.userLayer, input.catalog, routeIds)
  for (const layer of Object.values(input.projectLayers)) validateLayerSelections(layer, input.catalog, routeIds)
}

function validateTelanceProviderSettings(
  profileId: string,
  provider: DesktopAgentSettingsInput['providerSettings'][string],
) {
  if (!provider.providerId || !/^[A-Za-z0-9._-]+$/.test(provider.providerId)) {
    throw new Error(`Telance provider id is invalid: ${profileId}`)
  }
  if (provider.apiStyle !== 'chat-completions') {
    throw new Error(`Telance provider must use Chat Completions: ${profileId}`)
  }
  const url = new URL(String(provider.baseUrl || ''))
  if (
    url.protocol !== 'http:'
    || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.port !== '8787'
    || url.pathname !== `/provider/${encodeURIComponent(provider.providerId)}`
    || url.search
    || url.hash
  ) {
    throw new Error(`Telance provider must use its loopback proxy route: ${profileId}`)
  }
}

export function settingsInputFrom(settings: DesktopAgentSettings): DesktopAgentSettingsInput {
  return semanticInput(settings)
}

function validateStoredSettings(settings: DesktopAgentSettings) {
  if (!settings || typeof settings.revision !== 'string' || !settings.revision || typeof settings.updatedAt !== 'string') {
    throw new Error('Desktop Agent settings metadata is invalid')
  }
  const input = semanticInput(settings)
  validateSettingsInput(input)
  if (settings.revision !== revisionOf(input)) throw new Error('Desktop Agent settings revision does not match its content')
}

function semanticInput(settings: DesktopAgentSettings): DesktopAgentSettingsInput {
  return {
    schemaVersion: settings.schemaVersion,
    catalog: structuredClone(settings.catalog),
    providerSettings: structuredClone(settings.providerSettings),
    userLayer: structuredClone(settings.userLayer),
    projectLayers: structuredClone(settings.projectLayers),
  }
}

function validateLayerSelections(
  layer: DesktopAgentSettingsInput['userLayer'],
  catalog: DesktopAgentSettingsInput['catalog'],
  routeIds: Set<string>,
) {
  const selections = layer.selections
  if (!selections) return
  const catalogs = {
    modelRouteId: routeIds,
    promptProfileId: new Set(catalog.promptProfiles.map((profile) => profile.id)),
    workflowProfileId: new Set(catalog.workflowProfiles.map((profile) => profile.id)),
    toolPolicyId: new Set(catalog.toolPolicies.map((profile) => profile.id)),
    memoryProfileId: new Set(catalog.memoryProfiles.map((profile) => profile.id)),
    slotPolicyId: new Set(catalog.slotPolicies.map((profile) => profile.id)),
  }
  for (const [key, ids] of Object.entries(catalogs)) {
    const selected = selections[key as keyof typeof selections]
    if (selected && !ids.has(selected)) throw new Error(`Config layer selects an unknown ${key}: ${selected}`)
  }
}

function revisionOf(input: DesktopAgentSettingsInput) {
  return createHash('sha256').update(canonicalJson(input)).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

async function atomicWrite(target: string, content: string) {
  await mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
