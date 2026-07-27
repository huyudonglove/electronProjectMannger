import { createHash } from 'node:crypto'

import type { JsonValue, RunLimits } from '@electron-manager/agent-core'

import type {
  AgentConfigCatalog,
  AgentConfigLayer,
  AgentConfigSelections,
  AgentConfigSnapshot,
  ConfigIssue,
  ConfigScope,
  ConfigSource,
  MemoryProfile,
  ModelCapabilities,
  ModelProfile,
  ModelRequirements,
  ModelRoute,
  PromptProfile,
  ResolveAgentConfigInput,
  ResolveAgentConfigResult,
  ResolvedAgentConfig,
  SlotDefinition,
  ToolInventory,
  VersionedProfile,
} from './types.js'
import { AGENT_CONFIG_SCHEMA_VERSION } from './types.js'

const scopeOrder: Record<ConfigScope, number> = {
  built_in: 0,
  user: 1,
  project: 2,
  run: 3,
}

const selectionKeys: (keyof AgentConfigSelections)[] = [
  'modelRouteId',
  'promptProfileId',
  'workflowProfileId',
  'toolPolicyId',
  'memoryProfileId',
  'slotPolicyId',
]

const limitKeys: (keyof RunLimits)[] = [
  'maxSteps',
  'maxDurationMs',
  'maxInputTokens',
  'maxOutputTokens',
  'maxRepeatedFailures',
]

const normalizedModelErrorCodes = new Set([
  'rate_limit',
  'timeout',
  'service_unavailable',
  'transport',
  'invalid_output',
  'authentication',
  'permission',
  'invalid_request',
  'capability_mismatch',
  'budget_exhausted',
  'cancelled',
  'unknown',
])

export function resolveAgentConfig(input: ResolveAgentConfigInput): ResolveAgentConfigResult {
  const issues: ConfigIssue[] = []
  validateUniqueCatalogIds(input.catalog, issues)
  const layers = normalizeLayers(input.layers, issues)
  const selections = resolveSelections(layers)

  const route = findProfile(input.catalog.modelRoutes, selections.values.modelRouteId, 'modelRouteId', issues, selections.sources.modelRouteId)
  const prompt = findProfile(input.catalog.promptProfiles, selections.values.promptProfileId, 'promptProfileId', issues, selections.sources.promptProfileId)
  const workflow = findProfile(input.catalog.workflowProfiles, selections.values.workflowProfileId, 'workflowProfileId', issues, selections.sources.workflowProfileId)
  const toolPolicy = findProfile(input.catalog.toolPolicies, selections.values.toolPolicyId, 'toolPolicyId', issues, selections.sources.toolPolicyId)
  const memory = findProfile(input.catalog.memoryProfiles, selections.values.memoryProfileId, 'memoryProfileId', issues, selections.sources.memoryProfileId)
  const slotPolicy = findProfile(input.catalog.slotPolicies, selections.values.slotPolicyId, 'slotPolicyId', issues, selections.sources.slotPolicyId)

  if (!route || !prompt || !workflow || !toolPolicy || !memory || !slotPolicy) return { ok: false, issues }

  const sourceMap: Record<string, ConfigSource> = {}
  for (const key of selectionKeys) {
    const source = selections.sources[key]
    if (source) sourceMap[`selections.${key}`] = source
  }

  const primary = findProfile(input.catalog.modelProfiles, route.primaryProfileId, 'model.primaryProfileId', issues, selections.sources.modelRouteId)
  const fallbacks = route.fallbackProfileIds
    .map((id, index) => findProfile(input.catalog.modelProfiles, id, `model.fallbackProfileIds[${index}]`, issues, selections.sources.modelRouteId))
    .filter((profile): profile is ModelProfile => Boolean(profile))
  validateModelRoute(route, primary, fallbacks, issues, selections.sources.modelRouteId)
  validatePromptCacheProfiles(memory, [primary, ...fallbacks], issues, selections.sources.memoryProfileId)

  const promptVariables = defaultsForPrompt(prompt)
  promptVariables.workLevel = input.workLevel
  for (const layer of layers) {
    for (const [name, value] of Object.entries(layer.overrides?.promptVariables ?? {})) {
      promptVariables[name] = value
      sourceMap[`prompt.variables.${name}`] = sourceOf(layer)
    }
  }
  validatePrompt(prompt, promptVariables, issues, selections.sources.promptProfileId)

  const promptOverride = prompt.workLevelOverrides?.[input.workLevel]
  const limits: RunLimits = {
    ...workflow.limits,
    ...workflow.limitsByWorkLevel?.[input.workLevel],
  }
  for (const layer of layers) {
    for (const key of limitKeys) {
      const value = layer.overrides?.workflowLimits?.[key]
      if (value === undefined) continue
      limits[key] = value
      sourceMap[`workflow.limits.${key}`] = sourceOf(layer)
    }
  }
  validateLimits(limits, primary, memory, issues)
  if (memory.summarizerRouteId && !input.catalog.modelRoutes.some((candidate) => candidate.id === memory.summarizerRouteId)) {
    issue(issues, 'memory.summarizerRouteId', 'missing_profile', `Unknown summarizer route: ${memory.summarizerRouteId}`)
  }

  let enabledToolNames = [...toolPolicy.enabledToolNames]
  let backendPreferences = { ...toolPolicy.backendPreferences }
  let toolListSource = selections.sources.toolPolicyId
  for (const layer of layers) {
    if (layer.overrides?.enabledToolNames) {
      enabledToolNames = [...layer.overrides.enabledToolNames]
      toolListSource = sourceOf(layer)
      sourceMap['tools.enabledToolNames'] = toolListSource
    }
    for (const [name, backend] of Object.entries(layer.overrides?.backendPreferences ?? {})) {
      backendPreferences[name] = backend
      sourceMap[`tools.backendPreferences.${name}`] = sourceOf(layer)
    }
  }
  enabledToolNames = [...new Set(enabledToolNames)].sort()
  validateTools(enabledToolNames, backendPreferences, input.toolInventory, issues, toolListSource)

  const slotSelections: Record<string, boolean> = Object.fromEntries(
    input.catalog.slotDefinitions.map((slot) => [slot.id, slot.defaultEnabled]),
  )
  Object.assign(slotSelections, slotPolicy.selections)
  for (const layer of layers) {
    for (const [id, enabled] of Object.entries(layer.overrides?.slotSelections ?? {})) {
      slotSelections[id] = enabled
      sourceMap[`slots.selections.${id}`] = sourceOf(layer)
    }
  }
  validateSlots(slotSelections, input.catalog.slotDefinitions, issues, selections.sources.slotPolicyId)

  if (issues.length || !primary) return { ok: false, issues }

  const config: ResolvedAgentConfig = {
    schemaVersion: AGENT_CONFIG_SCHEMA_VERSION,
    workLevel: input.workLevel,
    model: {
      route: copyModelRoute(route),
      primary: copyModelProfile(primary),
      fallbacks: fallbacks.map(copyModelProfile),
    },
    prompt: {
      id: prompt.id,
      revision: prompt.revision,
      systemTemplate: promptOverride?.systemTemplate ?? prompt.systemTemplate,
      developerTemplate: promptOverride?.developerTemplate ?? prompt.developerTemplate,
      variables: promptVariables,
    },
    workflow: {
      id: workflow.id,
      revision: workflow.revision,
      limits,
      verification: {
        required: workflow.verification.required,
        maxRepairAttempts: workflow.verification.maxRepairAttempts,
      },
    },
    tools: {
      id: toolPolicy.id,
      revision: toolPolicy.revision,
      enabledToolNames,
      backendPreferences,
    },
    memory: copyMemoryProfile(memory),
    slots: {
      id: slotPolicy.id,
      revision: slotPolicy.revision,
      selections: slotSelections,
    },
    sources: sourceMap,
  }
  return { ok: true, config, snapshot: createAgentConfigSnapshot(config, input.toolInventory, layers) }
}

export function createAgentConfigSnapshot(
  config: ResolvedAgentConfig,
  toolInventory: ToolInventory,
  layers: AgentConfigLayer[],
): AgentConfigSnapshot {
  const data = jsonRecord({
    workLevel: config.workLevel,
    layerRevisions: [...layers]
      .sort((left, right) => scopeOrder[left.scope] - scopeOrder[right.scope])
      .map((layer) => ({ scope: layer.scope, revision: layer.revision, profileId: layer.profileId })),
    profileRefs: {
      modelRoute: profileRef(config.model.route),
      modelProfiles: [config.model.primary, ...config.model.fallbacks].map(profileRef),
      prompt: profileRef(config.prompt),
      workflow: profileRef(config.workflow),
      tools: profileRef(config.tools),
      memory: profileRef(config.memory),
      slots: profileRef(config.slots),
    },
    toolInventory: {
      revision: toolInventory.revision,
      enabled: config.tools.enabledToolNames.map((name) => {
        const tool = toolInventory.tools.find((entry) => entry.name === name)!
        return {
          name,
          descriptorRevision: tool.descriptorRevision,
          backend: config.tools.backendPreferences[name] ?? tool.selectedBackend ?? '',
        }
      }),
    },
    resolved: config,
  })
  return {
    schemaVersion: AGENT_CONFIG_SCHEMA_VERSION,
    revision: hash(canonicalJson(data)),
    data,
  }
}

function normalizeLayers(layers: AgentConfigLayer[], issues: ConfigIssue[]) {
  const sorted = [...layers].sort((left, right) => scopeOrder[left.scope] - scopeOrder[right.scope])
  for (const scope of Object.keys(scopeOrder) as ConfigScope[]) {
    const matching = sorted.filter((layer) => layer.scope === scope)
    if (matching.length > 1) issue(issues, `layers.${scope}`, 'duplicate', `Only one ${scope} layer is allowed`)
  }
  if (!sorted.some((layer) => layer.scope === 'built_in')) {
    issue(issues, 'layers.built_in', 'invalid_value', 'A built_in layer is required')
  }
  for (const layer of sorted) {
    if (!layer.revision.trim()) issue(issues, `layers.${layer.scope}.revision`, 'invalid_value', 'Layer revision is required', sourceOf(layer))
  }
  return sorted
}

function resolveSelections(layers: AgentConfigLayer[]) {
  const values: AgentConfigSelections = {}
  const sources: Partial<Record<keyof AgentConfigSelections, ConfigSource>> = {}
  for (const layer of layers) {
    for (const key of selectionKeys) {
      const value = layer.selections?.[key]
      if (!value) continue
      values[key] = value
      sources[key] = sourceOf(layer)
    }
  }
  return { values, sources }
}

function validateUniqueCatalogIds(catalog: AgentConfigCatalog, issues: ConfigIssue[]) {
  const groups: [string, VersionedProfile[]][] = [
    ['modelProfiles', catalog.modelProfiles],
    ['modelRoutes', catalog.modelRoutes],
    ['promptProfiles', catalog.promptProfiles],
    ['workflowProfiles', catalog.workflowProfiles],
    ['toolPolicies', catalog.toolPolicies],
    ['memoryProfiles', catalog.memoryProfiles],
    ['slotPolicies', catalog.slotPolicies],
  ]
  for (const [path, profiles] of groups) {
    const seen = new Set<string>()
    for (const profile of profiles) {
      if (seen.has(profile.id)) issue(issues, `${path}.${profile.id}`, 'duplicate', `Duplicate profile id: ${profile.id}`)
      seen.add(profile.id)
      if (!profile.id.trim() || !profile.revision.trim()) issue(issues, `${path}.${profile.id}`, 'invalid_value', 'Profile id and revision are required')
    }
  }
  const slots = new Set<string>()
  for (const slot of catalog.slotDefinitions) {
    if (slots.has(slot.id)) issue(issues, `slotDefinitions.${slot.id}`, 'duplicate', `Duplicate slot id: ${slot.id}`)
    slots.add(slot.id)
  }
}

function findProfile<T extends VersionedProfile>(
  profiles: T[],
  id: string | undefined,
  path: string,
  issues: ConfigIssue[],
  source?: ConfigSource,
): T | undefined {
  if (!id) {
    issue(issues, `selections.${path}`, 'missing_profile', `No ${path} was selected`, source)
    return undefined
  }
  const profile = profiles.find((candidate) => candidate.id === id)
  if (!profile) issue(issues, `selections.${path}`, 'missing_profile', `Unknown profile: ${id}`, source)
  return profile
}

function validateModelRoute(
  route: ModelRoute,
  primary: ModelProfile | undefined,
  fallbacks: ModelProfile[],
  issues: ConfigIssue[],
  source?: ConfigSource,
) {
  const ids = [route.primaryProfileId, ...route.fallbackProfileIds]
  if (new Set(ids).size !== ids.length) issue(issues, 'model.route', 'duplicate', 'Model route profiles must be unique', source)
  const retryValues = [route.retry.maxAttempts, route.retry.totalTimeoutMs, route.retry.totalTokenBudget]
  if (retryValues.some((value) => !Number.isInteger(value) || value <= 0)) {
    issue(issues, 'model.route.retry', 'invalid_value', 'Retry attempts, timeout and token budget must be positive integers', source)
  }
  if (route.retry.retryableErrors.some((code) => !normalizedModelErrorCodes.has(code))) {
    issue(issues, 'model.route.retry.retryableErrors', 'invalid_value', 'Retry policy contains an unknown normalized model error', source)
  }
  for (const profile of [primary, ...fallbacks]) {
    if (profile) validateCapabilities(profile, route.requirements, issues, source)
  }
}

function validateCapabilities(profile: ModelProfile, requirements: ModelRequirements, issues: ConfigIssue[], source?: ConfigSource) {
  const capabilities: (keyof ModelCapabilities)[] = ['structuredOutput', 'toolCalls', 'contextWindow', 'maxOutputTokens', 'promptCache']
  for (const key of capabilities) {
    const value = profile.capabilities[key]
    if (key === 'contextWindow' || key === 'maxOutputTokens') {
      if (!Number.isInteger(value) || Number(value) <= 0) issue(issues, `modelProfiles.${profile.id}.capabilities.${key}`, 'invalid_value', `${key} must be a positive integer`, source)
    }
  }
  const mismatch =
    (requirements.structuredOutput === true && !profile.capabilities.structuredOutput)
    || (requirements.toolCalls === true && !profile.capabilities.toolCalls)
    || (requirements.minContextWindow !== undefined && profile.capabilities.contextWindow < requirements.minContextWindow)
    || (requirements.minOutputTokens !== undefined && profile.capabilities.maxOutputTokens < requirements.minOutputTokens)
    || (requirements.promptCache !== undefined && promptCacheRank(profile.capabilities.promptCache) < promptCacheRank(requirements.promptCache))
  if (mismatch) issue(issues, `modelProfiles.${profile.id}.capabilities`, 'capability_mismatch', `Model ${profile.id} does not satisfy route requirements`, source)
}

function validatePromptCacheProfiles(
  memory: MemoryProfile,
  profiles: Array<ModelProfile | undefined>,
  issues: ConfigIssue[],
  source?: ConfigSource,
) {
  const required = memory.promptCache.mode
  if (required === 'none') return
  for (const profile of profiles) {
    if (profile && promptCacheRank(profile.capabilities.promptCache) < promptCacheRank(required)) {
      issue(issues, `modelProfiles.${profile.id}.capabilities.promptCache`, 'capability_mismatch', `Model ${profile.id} cannot satisfy memory prompt cache mode ${required}`, source)
    }
  }
}

function promptCacheRank(mode: ModelCapabilities['promptCache']) {
  return mode === 'explicit' ? 2 : mode === 'implicit' ? 1 : 0
}

function defaultsForPrompt(prompt: PromptProfile) {
  return Object.fromEntries(
    Object.entries(prompt.variables)
      .filter(([, definition]) => definition.defaultValue !== undefined)
      .map(([name, definition]) => [name, definition.defaultValue!]),
  )
}

function validatePrompt(prompt: PromptProfile, values: Record<string, string>, issues: ConfigIssue[], source?: ConfigSource) {
  const declared = new Set(Object.keys(prompt.variables))
  const templates = [prompt.systemTemplate, prompt.developerTemplate, ...Object.values(prompt.workLevelOverrides ?? {}).flatMap((override) => [override.systemTemplate ?? '', override.developerTemplate ?? ''])]
  const used = new Set(templates.flatMap((template) => [...template.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g)].map((match) => match[1]!)))
  for (const name of used) {
    if (!declared.has(name)) issue(issues, `prompt.variables.${name}`, 'unknown_variable', `Template variable is not declared: ${name}`, source)
  }
  for (const [name, definition] of Object.entries(prompt.variables)) {
    if (definition.required && !values[name]?.trim()) issue(issues, `prompt.variables.${name}`, 'missing_variable', `Required prompt variable is missing: ${name}`, source)
  }
  for (const name of Object.keys(values)) {
    if (!declared.has(name)) issue(issues, `prompt.variables.${name}`, 'unknown_variable', `Prompt value is not declared: ${name}`, source)
  }
}

function validateLimits(limits: RunLimits, primary: ModelProfile | undefined, memory: MemoryProfile, issues: ConfigIssue[]) {
  for (const key of limitKeys) {
    if (!Number.isInteger(limits[key]) || limits[key] <= 0) issue(issues, `workflow.limits.${key}`, 'invalid_value', `${key} must be a positive integer`)
  }
  if (primary && limits.maxInputTokens > primary.capabilities.contextWindow) {
    issue(issues, 'workflow.limits.maxInputTokens', 'budget_exceeded', 'Input token limit exceeds the primary model context window')
  }
  if (primary && limits.maxOutputTokens > primary.capabilities.maxOutputTokens) {
    issue(issues, 'workflow.limits.maxOutputTokens', 'budget_exceeded', 'Output token limit exceeds the primary model output limit')
  }
  const sourceBudget = Object.values(memory.sourceBudgets).reduce((total, value) => total + value, 0)
  if (Object.values(memory.sourceBudgets).some((value) => !Number.isInteger(value) || value < 0)) {
    issue(issues, 'memory.sourceBudgets', 'invalid_value', 'Memory source budgets must be non-negative integers')
  }
  if (sourceBudget > limits.maxInputTokens) issue(issues, 'memory.sourceBudgets', 'budget_exceeded', 'Memory source budgets exceed the workflow input budget')
  const compression = memory.compression
  if (!Number.isInteger(compression.warningTokens)
    || !Number.isInteger(compression.compactTokens)
    || !Number.isInteger(compression.targetTokens)
    || !Number.isInteger(compression.hardStopTokens)
    || compression.targetTokens <= 0
    || compression.targetTokens >= compression.warningTokens
    || compression.warningTokens >= compression.compactTokens
    || compression.compactTokens >= compression.hardStopTokens) {
    issue(issues, 'memory.compression', 'invalid_value', 'Compression thresholds must satisfy target < warning < compact < hard-stop')
  }
  if (compression.hardStopTokens > limits.maxInputTokens) {
    issue(issues, 'memory.compression.hardStopTokens', 'budget_exceeded', 'Compression hard-stop exceeds the workflow input budget')
  }
}

function validateTools(
  enabled: string[],
  preferences: Record<string, string>,
  inventory: ToolInventory,
  issues: ConfigIssue[],
  source?: ConfigSource,
) {
  if (!inventory.revision.trim()) issue(issues, 'toolInventory.revision', 'invalid_value', 'Tool inventory revision is required')
  const byName = new Map(inventory.tools.map((tool) => [tool.name, tool]))
  if (byName.size !== inventory.tools.length) issue(issues, 'toolInventory.tools', 'duplicate', 'Tool inventory names must be unique')
  for (const tool of inventory.tools) {
    if (!tool.name.trim() || !tool.descriptorRevision.trim()) {
      issue(issues, `toolInventory.tools.${tool.name}`, 'invalid_value', 'Tool name and descriptor revision are required')
    }
  }
  for (const name of enabled) {
    const tool = byName.get(name)
    if (!tool?.available) issue(issues, `tools.enabledToolNames.${name}`, 'unavailable_tool', `Enabled tool is unavailable: ${name}`, source)
    const backend = preferences[name]
    if (backend && !tool?.availableBackendIds.includes(backend)) {
      issue(issues, `tools.backendPreferences.${name}`, 'unavailable_backend', `Backend ${backend} is unavailable for ${name}`, source)
    }
  }
  for (const name of Object.keys(preferences)) {
    if (!enabled.includes(name)) issue(issues, `tools.backendPreferences.${name}`, 'invalid_value', `Backend preference targets a disabled tool: ${name}`, source)
  }
}

function validateSlots(selections: Record<string, boolean>, definitions: SlotDefinition[], issues: ConfigIssue[], source?: ConfigSource) {
  const byId = new Map(definitions.map((slot) => [slot.id, slot]))
  for (const id of Object.keys(selections)) {
    if (!byId.has(id)) issue(issues, `slots.selections.${id}`, 'unavailable_slot', `Unknown slot: ${id}`, source)
  }
  for (const [id, enabled] of Object.entries(selections)) {
    if (!enabled) continue
    const slot = byId.get(id)
    if (!slot) continue
    if (!slot.available) issue(issues, `slots.selections.${id}`, 'unavailable_slot', slot.unavailableReason || `Slot is unavailable: ${id}`, source)
    for (const dependency of slot.requires) {
      if (!selections[dependency]) issue(issues, `slots.selections.${id}`, 'missing_dependency', `${id} requires ${dependency}`, source)
    }
    for (const conflict of slot.conflictsWith) {
      if (selections[conflict]) issue(issues, `slots.selections.${id}`, 'slot_conflict', `${id} conflicts with ${conflict}`, source)
    }
  }
}

function profileRef(profile: VersionedProfile) {
  return { id: profile.id, revision: profile.revision }
}

function copyModelProfile(profile: ModelProfile): ModelProfile {
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

function copyModelRoute(route: ResolvedAgentConfig['model']['route']): ResolvedAgentConfig['model']['route'] {
  return {
    id: route.id,
    revision: route.revision,
    primaryProfileId: route.primaryProfileId,
    fallbackProfileIds: [...route.fallbackProfileIds],
    requirements: {
      ...(route.requirements.structuredOutput === undefined ? {} : { structuredOutput: route.requirements.structuredOutput }),
      ...(route.requirements.toolCalls === undefined ? {} : { toolCalls: route.requirements.toolCalls }),
      ...(route.requirements.minContextWindow === undefined ? {} : { minContextWindow: route.requirements.minContextWindow }),
      ...(route.requirements.minOutputTokens === undefined ? {} : { minOutputTokens: route.requirements.minOutputTokens }),
      ...(route.requirements.promptCache === undefined ? {} : { promptCache: route.requirements.promptCache }),
    },
    retry: {
      maxAttempts: route.retry.maxAttempts,
      totalTimeoutMs: route.retry.totalTimeoutMs,
      totalTokenBudget: route.retry.totalTokenBudget,
      retryableErrors: [...route.retry.retryableErrors],
    },
  }
}

function copyMemoryProfile(profile: MemoryProfile): MemoryProfile {
  return {
    id: profile.id,
    revision: profile.revision,
    mode: profile.mode,
    sourceBudgets: {
      runFacts: profile.sourceBudgets.runFacts,
      session: profile.sourceBudgets.session,
      project: profile.sourceBudgets.project,
      user: profile.sourceBudgets.user,
    },
    compression: {
      warningTokens: profile.compression.warningTokens,
      compactTokens: profile.compression.compactTokens,
      targetTokens: profile.compression.targetTokens,
      hardStopTokens: profile.compression.hardStopTokens,
    },
    promptCache: {
      mode: profile.promptCache.mode,
      stablePrefixRevision: profile.promptCache.stablePrefixRevision,
    },
    ...(profile.summarizerRouteId ? { summarizerRouteId: profile.summarizerRouteId } : {}),
    allowLongTermUserMemoryWrite: profile.allowLongTermUserMemoryWrite,
  }
}

function sourceOf(layer: AgentConfigLayer): ConfigSource {
  return {
    scope: layer.scope,
    revision: layer.revision,
    ...(layer.profileId ? { profileId: layer.profileId } : {}),
  }
}

function issue(issues: ConfigIssue[], path: string, code: ConfigIssue['code'], message: string, source?: ConfigSource) {
  issues.push({ path, code, message, ...(source ? { source } : {}) })
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

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}
