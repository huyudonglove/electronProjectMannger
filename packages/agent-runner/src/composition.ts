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
  type ResolvedModelRoute,
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
import {
  DeterministicSessionCompactor,
  ModelBackedSessionCompactor,
  PROJECT_MEMORY_RETRIEVAL_REVISION,
  ProjectMemoryIndex,
  createProjectMemoryContextSources,
  sessionCompactionPolicyFromProfile,
} from '@electron-manager/agent-memory'
import { ModelProviderRegistry, ModelRouter } from '@electron-manager/agent-model-router'
import {
  DEFAULT_MAX_OUTPUT_ARTIFACT_BYTES,
  DEFAULT_OUTPUT_PREVIEW_CHARACTERS,
  LocalContentAddressedOutputStore,
  OutputExternalizingRuntime,
} from '@electron-manager/agent-output'
import {
  buildRepoMap,
  createCodeMapContextSource,
  createRepoMapContextSource,
  resolveRepoMapOptions,
  type RepoMapOptions,
  type ResolvedRepoMapOptions,
} from '@electron-manager/agent-repo-map'
import {
  LocalAgentRuntime,
  type ToolRegistrySnapshot,
} from '@electron-manager/agent-runtime-local'

import type { HeadlessAgentRunnerOptions } from './types.js'
import { createModelRouteSessionSummarizer } from './route-summarizer.js'
import { encodeProjectMemorySnapshot } from './project-memory-snapshot.js'

export async function composeHeadlessAgent(options: HeadlessAgentRunnerOptions) {
  const projectRoot = path.resolve(options.projectRoot)
  const clock = options.clock || (() => new Date().toISOString())
  const localRuntime = new LocalAgentRuntime(projectRoot, {
    ...options.runtimeOptions,
    clock,
  })
  const registrySnapshot = await localRuntime.probeTools()
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
  const maxOutputArtifactBytes = options.maxOutputArtifactBytes ?? DEFAULT_MAX_OUTPUT_ARTIFACT_BYTES
  const outputPreviewCharacters = options.outputPreviewCharacters ?? DEFAULT_OUTPUT_PREVIEW_CHARACTERS
  const outputStore = new LocalContentAddressedOutputStore(
    options.outputDirectory || `${path.resolve(options.checkpointPath)}.outputs`,
    { maxArtifactBytes: maxOutputArtifactBytes, clock },
  )
  const repoMapConfig = resolveRunnerRepoMapConfig(
    resolved.config.memory.mode,
    resolved.config.memory.sourceBudgets.project,
    maxOutputArtifactBytes,
    options.repoMapOptions,
  )
  const codeMap = repoMapConfig.enabled ? options.codeMapSnapshot : undefined
  const repoMap = repoMapConfig.enabled
    ? codeMap?.repoMap || await buildRepoMap(projectRoot, repoMapConfig.options)
    : undefined
  const repoMapArtifact = repoMap ? await outputStore.put(codeMap?.content || repoMap.content) : undefined

  const toolsByName = new Map(localRuntime.toolDefinitions().map((tool) => [tool.name, tool]))
  const tools = resolved.config.tools.enabledToolNames.map((name) => {
    const tool = toolsByName.get(name)
    if (!tool) throw new AgentCoreError('INVALID_INPUT', `Resolved tool is not registered in the local runtime: ${name}`)
    return tool
  })
  const providerByProfile = registrations(options)
  const summarizerRoute = resolved.config.memory.summarizerRouteId
    ? resolveConfiguredRoute(options, resolved.config.memory.summarizerRouteId)
    : undefined
  const selectedProfiles = uniqueProfiles([
    resolved.config.model.primary,
    ...resolved.config.model.fallbacks,
    ...(summarizerRoute ? [summarizerRoute.primary, ...summarizerRoute.fallbacks] : []),
  ])
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
    ...(options.onModelAttempt ? { onAttempt: options.onModelAttempt } : {}),
  })
  const summarizerRouter = summarizerRoute ? new ModelRouter({
    route: summarizerRoute,
    registry: providerRegistry,
    clock,
    ...(options.now ? { now: options.now } : {}),
    ...(options.onModelAttempt ? { onAttempt: options.onModelAttempt } : {}),
  }) : undefined

  const estimator = new CachingTokenEstimator(new DeterministicTokenEstimator())
  const compactorOptions = {
    policy: sessionCompactionPolicyFromProfile(resolved.config.memory),
    tokenEstimator: estimator,
  }
  const sessionSummarizer = summarizerRouter && summarizerRoute
    ? createModelRouteSessionSummarizer(
      summarizerRouter,
      summarizerRoute.route.id,
      summarizerRoute.route.revision,
    )
    : undefined
  const compactor = summarizerRouter && summarizerRoute
    ? new ModelBackedSessionCompactor({
      ...compactorOptions,
      summarizer: sessionSummarizer!,
      onDiagnostic: options.onMemoryDiagnostic,
    })
    : new DeterministicSessionCompactor(compactorOptions)
  const projectMemoryIndex = resolved.config.memory.mode === 'minimal' || !(options.projectMemoryDocuments?.length)
    ? undefined
    : new ProjectMemoryIndex(options.projectMemoryDocuments, {
      retrievalRevision: options.projectMemoryRetrievalRevision,
    })
  const projectMemorySnapshot = projectMemoryIndex
    ? encodeProjectMemorySnapshot(options.projectMemoryDocuments!)
    : undefined
  const projectMemorySnapshotArtifact = projectMemorySnapshot
    ? await outputStore.put(projectMemorySnapshot.content)
    : undefined
  const sources = [
    configuredPromptSource(resolved.config),
    ...createLedgerContextSources().map((source) => applySourceBudget(source, resolved.config)),
    ...(repoMap && repoMapConfig.enabled ? [codeMap ? createCodeMapContextSource(
      codeMap,
      repoMapConfig.maxTokens,
      repoMapArtifact ? [repoMapArtifact.ref] : [],
    ) : createRepoMapContextSource(
      repoMap,
      repoMapConfig.maxTokens,
      repoMapArtifact ? [repoMapArtifact.ref] : [],
    )] : []),
    ...(projectMemoryIndex ? createProjectMemoryContextSources(projectMemoryIndex, {
      maxTokens: resolved.config.memory.sourceBudgets.project,
      maxResults: resolved.config.memory.mode === 'extended' ? 16 : 8,
    }) : []),
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
  const runtime = new OutputExternalizingRuntime(localRuntime, outputStore, {
    previewCharacters: outputPreviewCharacters,
  })
  const configSnapshot = withCompositionConfigSnapshot(resolved.snapshot, {
    output: {
      maxArtifactBytes: maxOutputArtifactBytes,
      previewCharacters: outputPreviewCharacters,
    },
    repoMap: repoMapConfig,
  })

  return {
    projectRoot,
    clock,
    runtime,
    localRuntime,
    outputStore,
    repoMap,
    codeMap,
    repoMapOutputRef: repoMapArtifact?.ref,
    projectMemorySnapshotRef: projectMemorySnapshotArtifact?.ref,
    tools,
    router,
    summarizerRouter,
    sessionSummarizer,
    sessionCompactor: compactor,
    contextAssembler,
    promptCachePolicy,
    config: resolved.config,
    snapshots: {
      configSnapshot,
      modelRouteSnapshot: router.snapshot(),
      toolRegistrySnapshot,
      memorySnapshot: memorySnapshot(
        resolved.config,
        projectMemoryIndex,
        projectMemorySnapshotArtifact?.ref,
        summarizerRouter?.snapshot(),
      ),
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

function resolveConfiguredRoute(options: HeadlessAgentRunnerOptions, routeId: string): ResolvedModelRoute {
  const route = options.catalog.modelRoutes.find((candidate) => candidate.id === routeId)
  if (!route) throw new AgentCoreError('INVALID_INPUT', `Configured summarizer route does not exist: ${routeId}`)
  const profile = (profileId: string) => {
    const value = options.catalog.modelProfiles.find((candidate) => candidate.id === profileId)
    if (!value) throw new AgentCoreError('INVALID_INPUT', `Summarizer route model profile does not exist: ${profileId}`)
    return value
  }
  return {
    route: structuredClone(route),
    primary: structuredClone(profile(route.primaryProfileId)),
    fallbacks: route.fallbackProfileIds.map((profileId) => structuredClone(profile(profileId))),
  }
}

function uniqueProfiles(profiles: ResolvedModelRoute['primary'][]) {
  return [...new Map(profiles.map((profile) => [profile.id, profile])).values()]
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
    scopeTokens: {
      project: Math.min(available, memory.project),
    },
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

function memorySnapshot(
  config: ResolvedAgentConfig,
  projectMemoryIndex?: ProjectMemoryIndex,
  projectMemorySnapshotRef?: string,
  summarizerRouteSnapshot?: VersionedRunComponentSnapshot,
): VersionedRunComponentSnapshot {
  const data = {
    profile: toJson(config.memory),
    ...(projectMemoryIndex ? { projectMemoryRevision: projectMemoryIndex.revision } : {}),
    ...(projectMemoryIndex?.retrievalRevision === PROJECT_MEMORY_RETRIEVAL_REVISION
      ? { retrievalRevision: projectMemoryIndex.retrievalRevision }
      : {}),
    ...(projectMemorySnapshotRef ? { projectMemorySnapshotRef } : {}),
    ...(summarizerRouteSnapshot ? { summarizerRoute: toJson(summarizerRouteSnapshot) } : {}),
  }
  return {
    schemaVersion: 1,
    revision: hash(canonicalJson(data)),
    data,
  }
}

function withCompositionConfigSnapshot(
  snapshot: AgentConfigSnapshot,
  composition: {
    output: { maxArtifactBytes: number; previewCharacters: number }
    repoMap: RunnerRepoMapConfig
  },
): AgentConfigSnapshot {
  const data = {
    ...snapshot.data,
    output: {
      store: 'local-content-addressed',
      schemaVersion: 1,
      maxArtifactBytes: composition.output.maxArtifactBytes,
      previewCharacters: composition.output.previewCharacters,
    },
    repoMap: toJson(composition.repoMap),
  }
  return {
    schemaVersion: snapshot.schemaVersion,
    revision: hash(canonicalJson(data)),
    data,
  }
}

type RunnerRepoMapConfig =
  | { enabled: false }
  | { enabled: true; maxTokens: number; options: ResolvedRepoMapOptions }

function resolveRunnerRepoMapConfig(
  mode: ResolvedAgentConfig['memory']['mode'],
  projectTokens: number,
  maxArtifactBytes: number,
  overrides: RepoMapOptions | undefined,
): RunnerRepoMapConfig {
  if (mode === 'minimal' || projectTokens <= 0) return { enabled: false }
  const maxTokens = Math.min(projectTokens, mode === 'extended' ? 12_000 : 8_000)
  const defaultOutputBytes = mode === 'extended' ? 48_000 : 32_000
  const maxOutputBytes = Math.min(
    overrides?.maxOutputBytes ?? defaultOutputBytes,
    maxTokens * 4,
    maxArtifactBytes,
  )
  if (maxOutputBytes < 256) {
    throw new AgentCoreError('INVALID_INPUT', 'Repo map requires at least 256 bytes of output artifact capacity')
  }
  return {
    enabled: true,
    maxTokens,
    options: resolveRepoMapOptions({
      maxFiles: mode === 'extended' ? 10_000 : 5_000,
      maxDepth: mode === 'extended' ? 6 : 4,
      ...overrides,
      maxOutputBytes,
    }),
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
