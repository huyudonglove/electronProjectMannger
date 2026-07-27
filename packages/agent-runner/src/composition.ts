import { createHash } from 'node:crypto'
import path from 'node:path'

import {
  AGENT_TURN_ACTION_SCHEMA_REVISION,
  AgentCoreError,
  type JsonValue,
  type RuntimeToolSnapshot,
  type VersionedRunComponentSnapshot,
} from '@electron-manager/agent-core'
import {
  resolveAgentConfig,
  toolInventoryFromRegistrySnapshot,
  type AgentConfigSnapshot,
  type ResolvedAgentConfig,
} from '@electron-manager/agent-config'
import {
  CachingTokenEstimator,
  ContextAssembler,
  ContextSourceRegistry,
  DeterministicTokenEstimator,
  InMemoryPromptArtifactCache,
  createLedgerContextSources,
  createPromptCachePolicyTemplate,
  type ContextBudget,
  type ContextSource,
} from '@electron-manager/agent-context'
import { DeterministicSessionCompactor, sessionCompactionPolicyFromProfile } from '@electron-manager/agent-memory'
import { ModelProviderRegistry, ModelRouter } from '@electron-manager/agent-model-router'
import {
  LocalAgentRuntime,
  type ToolRegistrySnapshot,
} from '@electron-manager/agent-runtime-local'

import type { HeadlessAgentRunnerOptions } from './types.js'

export async function composeHeadlessAgent(options: HeadlessAgentRunnerOptions) {
  const projectRoot = path.resolve(options.projectRoot)
  const clock = options.clock || (() => new Date().toISOString())
  const runtime = new LocalAgentRuntime(projectRoot, {
    ...options.runtimeOptions,
    clock,
  })
  const registrySnapshot = await runtime.probeTools()
  const toolInventory = toolInventoryFromRegistrySnapshot(registrySnapshot)
  const resolved = resolveAgentConfig({
    workLevel: options.workLevel,
    catalog: options.catalog,
    layers: options.layers,
    toolInventory,
  })
  if (!resolved.ok) {
    throw new AgentCoreError('INVALID_INPUT', 'Agent configuration could not be resolved', {
      details: { issues: toJson(resolved.issues) },
    })
  }

  const toolsByName = new Map(runtime.toolDefinitions().map((tool) => [tool.name, tool]))
  const tools = resolved.config.tools.enabledToolNames.map((name) => {
    const tool = toolsByName.get(name)
    if (!tool) throw new AgentCoreError('INVALID_INPUT', `Resolved tool is not registered in the local runtime: ${name}`)
    return tool
  })
  const providerByProfile = registrations(options)
  const selectedProfiles = [resolved.config.model.primary, ...resolved.config.model.fallbacks]
  const providerRegistry = new ModelProviderRegistry(selectedProfiles.map((profile) => {
    const provider = providerByProfile.get(profile.id)
    if (!provider) throw new AgentCoreError('INVALID_INPUT', `No provider registered for selected model profile: ${profile.id}`)
    return { profile, provider }
  }))
  const router = new ModelRouter({
    route: resolved.config.model,
    registry: providerRegistry,
    clock,
    ...(options.now ? { now: options.now } : {}),
  })

  const estimator = new CachingTokenEstimator(new DeterministicTokenEstimator())
  const compactor = new DeterministicSessionCompactor({
    policy: sessionCompactionPolicyFromProfile(resolved.config.memory),
    tokenEstimator: estimator,
  })
  const sources = [
    configuredPromptSource(resolved.config),
    ...createLedgerContextSources().map((source) => applySourceBudget(source, resolved.config)),
    ...(options.extraContextSources ?? []),
  ]
  const contextAssembler = new ContextAssembler({
    registry: new ContextSourceRegistry(sources),
    budget: contextBudget(resolved.config),
    tokenEstimator: estimator,
    compactor,
    artifactCache: new InMemoryPromptArtifactCache(),
  })
  const toolRegistrySnapshot = runtimeToolSnapshot(registrySnapshot)
  const projectRulesRevision = nonEmptyRevision(options.projectRulesRevision, 'none')
  const privacyScopeRevision = nonEmptyRevision(options.privacyScopeRevision, hash(`project:${projectRoot}`))
  const promptCachePolicy = createPromptCachePolicyTemplate({
    memory: resolved.config.memory,
    promptProfileRevision: `${resolved.config.prompt.id}@${resolved.config.prompt.revision}`,
    toolRegistryRevision: toolRegistrySnapshot.revision,
    actionSchemaRevision: nonEmptyRevision(options.actionSchemaRevision, AGENT_TURN_ACTION_SCHEMA_REVISION),
    projectRulesRevision,
    privacyScopeRevision,
  })

  return {
    projectRoot,
    clock,
    runtime,
    tools,
    router,
    contextAssembler,
    promptCachePolicy,
    config: resolved.config,
    snapshots: {
      configSnapshot: resolved.snapshot,
      modelRouteSnapshot: router.snapshot(),
      toolRegistrySnapshot,
      memorySnapshot: memorySnapshot(resolved.config),
    },
  }
}

function registrations(options: HeadlessAgentRunnerOptions) {
  const entries = new Map<string, HeadlessAgentRunnerOptions['providers'][number]['provider']>()
  for (const registration of options.providers) {
    if (!registration.profileId.trim()) throw new AgentCoreError('INVALID_INPUT', 'Provider profile id is required')
    if (entries.has(registration.profileId)) {
      throw new AgentCoreError('INVALID_INPUT', `Duplicate provider registration: ${registration.profileId}`)
    }
    entries.set(registration.profileId, registration.provider)
  }
  return entries
}

function configuredPromptSource(config: ResolvedAgentConfig): ContextSource {
  const content = [
    render(config.prompt.systemTemplate, config.prompt.variables),
    render(config.prompt.developerTemplate, config.prompt.variables),
  ].filter((value) => value.trim()).join('\n\n')
  if (!content) throw new AgentCoreError('INVALID_INPUT', 'Resolved prompt profile rendered to empty content')
  const revision = hash(canonicalJson({
    id: config.prompt.id,
    revision: config.prompt.revision,
    content,
  }))
  return {
    descriptor: {
      id: 'configured.prompt',
      revision,
      region: 'stable_system_prefix',
      scope: 'system',
      trust: 'trusted_system',
      priority: 110,
      required: true,
      compressible: false,
      maxTokens: Math.max(1, Math.min(16_000, config.workflow.limits.maxInputTokens - config.workflow.limits.maxOutputTokens)),
    },
    collect: () => [{
      id: 'configured-prompt',
      role: 'system',
      content,
      sourceRefs: [`prompt:${config.prompt.id}@${config.prompt.revision}`],
    }],
  }
}

function applySourceBudget(source: ContextSource, config: ResolvedAgentConfig): ContextSource {
  const available = config.workflow.limits.maxInputTokens - config.workflow.limits.maxOutputTokens
  const scopeBudget = source.descriptor.scope === 'run'
    ? config.memory.sourceBudgets.runFacts
    : source.descriptor.scope === 'session'
      ? config.memory.sourceBudgets.session
      : source.descriptor.scope === 'project'
        ? config.memory.sourceBudgets.project
        : source.descriptor.scope === 'user'
          ? config.memory.sourceBudgets.user
          : available
  return {
    descriptor: {
      ...source.descriptor,
      maxTokens: Math.max(1, Math.min(source.descriptor.maxTokens, scopeBudget, available)),
    },
    collect: source.collect,
  }
}

function contextBudget(config: ResolvedAgentConfig): ContextBudget {
  const maxInputTokens = config.workflow.limits.maxInputTokens
  const reservedOutputTokens = config.workflow.limits.maxOutputTokens
  const available = maxInputTokens - reservedOutputTokens
  const memory = config.memory.sourceBudgets
  return {
    maxInputTokens,
    reservedOutputTokens,
    regionTokens: {
      stable_system_prefix: available,
      stable_capability_prefix: available,
      compacted_history: Math.max(1, Math.min(available, memory.session)),
      recent_dynamic_context: Math.max(1, Math.min(available, memory.runFacts + memory.session + memory.project + memory.user)),
      newest_message: Math.max(1, Math.min(available, 2_000)),
    },
  }
}

function runtimeToolSnapshot(snapshot: ToolRegistrySnapshot): RuntimeToolSnapshot {
  return {
    schemaVersion: snapshot.schemaVersion,
    revision: snapshot.revision,
    data: { tools: toJson(snapshot.tools) },
  }
}

function memorySnapshot(config: ResolvedAgentConfig): VersionedRunComponentSnapshot {
  const data = {
    profile: toJson(config.memory),
  }
  return {
    schemaVersion: 1,
    revision: hash(canonicalJson(data)),
    data,
  }
}

function render(template: string, variables: Record<string, string>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, name: string) => variables[name] ?? '')
}

function nonEmptyRevision(value: string | undefined, fallback: string) {
  const resolved = value ?? fallback
  if (!resolved.trim()) throw new AgentCoreError('INVALID_INPUT', 'Context revision values must be non-empty')
  return resolved
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

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

export type HeadlessComposition = Awaited<ReturnType<typeof composeHeadlessAgent>>
export type HeadlessComponentSnapshots = {
  configSnapshot: AgentConfigSnapshot
  modelRouteSnapshot: ReturnType<ModelRouter['snapshot']>
  toolRegistrySnapshot: RuntimeToolSnapshot
  memorySnapshot: VersionedRunComponentSnapshot
}
