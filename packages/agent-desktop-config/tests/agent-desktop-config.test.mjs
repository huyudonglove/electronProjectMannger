import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { FakePermissionPolicy } from '@electron-manager/agent-core'
import {
  DesktopAgentCoordinator,
  createHeadlessDesktopAgentBackend,
} from '@electron-manager/agent-desktop-coordinator'
import { createHeadlessAgentRunner } from '@electron-manager/agent-runner'
import { appendConstraint, appendTask, getDashboard, initProject } from '@electron-manager/project-core'

import {
  DesktopAgentConfigService,
  DesktopBackendProviderCatalog,
  DesktopAgentPermissionPolicy,
  DesktopAgentSettingsService,
  DesktopAgentSettingsStore,
  DesktopModelProviderFactory,
  desktopOpenAIModelCapabilities,
  desktopAgentProjectStoragePaths,
  desktopAgentSettingsPath,
  desktopProjectMemoryStatus,
  inferDesktopVerificationPlan,
  projectMemoryDocumentsFromDashboard,
  settingsInputFrom,
} from '../dist/index.js'

test('desktop verification plan selects one deterministic repository script', async (t) => {
  const root = await temporaryRoot(t, 'verification-plan')
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    scripts: { test: 'node --test', build: 'tsc' },
  }), 'utf8')
  await writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n', 'utf8')
  assert.deepEqual(await inferDesktopVerificationPlan(root), {
    checks: [{
      id: 'package-script-test',
      label: '运行项目 test 脚本',
      required: true,
      command: ['pnpm', 'run', 'test'],
      timeoutMs: 120_000,
    }],
  })

  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    scripts: { test: 'echo "Error: no test specified" && exit 1', build: 'vite build' },
  }), 'utf8')
  assert.equal((await inferDesktopVerificationPlan(root)).checks[0].id, 'package-script-build')
})

test('desktop permission policy allows project-local work and denies unsupported risks', () => {
  const policy = new DesktopAgentPermissionPolicy()
  const ledger = {}
  const request = { id: 'request-1', name: 'fixture', input: {}, requestedAt: 'now', actionDigest: 'digest' }
  const tool = (name, risk) => ({ name, description: name, inputSchema: { type: 'object' }, risk })

  assert.equal(policy.decide(request, tool('read_file', 'read'), ledger).effect, 'allow')
  assert.equal(policy.decide(request, tool('apply_patch', 'project_write'), ledger).effect, 'allow')
  assert.equal(policy.decide(request, tool('exec_command', 'process'), ledger).effect, 'ask')
  const approvedLedger = {
    approvals: [{ scope: 'tool', decision: 'approved', actionDigest: 'approved-command' }],
    toolExecutions: [{ request: { name: 'exec_command', actionDigest: 'approved-command' } }],
  }
  assert.equal(policy.decide(request, tool('exec_command', 'process'), approvedLedger).effect, 'allow')
  assert.equal(policy.decide(request, tool('another_process', 'process'), approvedLedger).effect, 'ask')
  assert.equal(policy.decide(request, tool('remote_write', 'external_write'), ledger).effect, 'deny')
})

test('settings service exposes the backend provider catalog and saves only dropdown selections', async (t) => {
  const root = await temporaryRoot(t, 'settings-service')
  const store = new DesktopAgentSettingsStore(path.join(root, 'settings.json'))
  const providers = fixtureProviderCatalog()
  const service = new DesktopAgentSettingsService({ store, providers })
  const initial = await service.getView()
  assert.equal(initial.providerCatalog.available, true)
  assert.equal(initial.models[0].providerId, 'openai')
  assert.equal(initial.models[0].connectionConfigured, false)
  assert.equal(initial.effectiveModelRoute.source, 'user')
  assert.equal(JSON.stringify(initial).includes('fixture-secret'), false)

  const updated = await service.updateOpenAIModel({
    expectedRevision: initial.settingsRevision,
    profileId: initial.models[0].profileId,
    providerId: 'deepseek',
    model: 'deepseek-chat',
    reasoningEffort: 'high',
    verbosity: 'medium',
  })
  assert.equal(updated.models[0].providerId, 'deepseek')
  assert.equal(updated.models[0].model, 'deepseek-chat')
  assert.equal(updated.models[0].reasoningEffort, 'high')
  await assert.rejects(
    () => service.updateOpenAIModel({
      expectedRevision: initial.settingsRevision,
      profileId: initial.models[0].profileId,
      providerId: 'deepseek',
      model: 'deepseek-chat',
      reasoningEffort: 'low',
      verbosity: 'low',
    }),
    /revision conflict/,
  )

  const persisted = await store.load()
  assert.equal(persisted.catalog.modelProfiles[0].model, 'deepseek-chat')
  assert.equal(persisted.providerSettings[persisted.catalog.modelProfiles[0].id].providerId, 'deepseek')
  assert.equal(persisted.providerSettings[persisted.catalog.modelProfiles[0].id].baseUrl, 'http://127.0.0.1:8787/provider/deepseek')
  assert.equal(persisted.providerSettings[persisted.catalog.modelProfiles[0].id].connectionSource, 'telance-local-proxy')
  assert.equal(persisted.providerSettings[persisted.catalog.modelProfiles[0].id].apiStyle, 'auto')
  assert.equal(persisted.catalog.modelProfiles[0].capabilities.contextWindow, 128_000)
  assert.equal(persisted.catalog.modelProfiles[0].capabilities.maxOutputTokens, 16_000)
  await assert.rejects(
    () => service.updateOpenAIModel({
      expectedRevision: updated.settingsRevision,
      profileId: updated.models[0].profileId,
      providerId: 'deepseek',
      model: 'not-in-backend-list',
      reasoningEffort: 'medium',
      verbosity: 'low',
    }),
    /模型不属于后台 Provider/,
  )
  await assert.rejects(
    () => service.updateOpenAIModel({
      expectedRevision: updated.settingsRevision,
      profileId: updated.models[0].profileId,
      providerId: 'openai',
      model: 'gpt-fixture',
      reasoningEffort: 'medium',
      verbosity: 'low',
    }),
    /尚未配置连接凭据/,
  )
})

test('project model routes keep primary and ordered fallbacks isolated per project', async (t) => {
  const root = await temporaryRoot(t, 'project-model-routes')
  const store = new DesktopAgentSettingsStore(path.join(root, 'settings.json'))
  const service = new DesktopAgentSettingsService({ store, providers: fixtureProviderCatalog() })
  const created = await store.loadOrCreate()
  await store.update(created.revision, (draft) => {
    draft.projectLayers['project-a'] = {
      scope: 'project',
      revision: 'existing-project-overrides',
      selections: { workflowProfileId: draft.catalog.workflowProfiles[0].id },
      overrides: { workflowLimits: { maxSteps: 17 } },
    }
  })
  const initial = await service.getView('project-a')
  const projectA = await service.updateProjectModelRoute({
    expectedRevision: initial.settingsRevision,
    projectId: 'project-a',
    primary: { providerId: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high', verbosity: 'medium' },
    fallbacks: [{ providerId: 'sensenova', model: 'sensenova-lite' }],
  })
  await assert.rejects(
    () => service.updateProjectModelRoute({
      expectedRevision: initial.settingsRevision,
      projectId: 'project-a',
      primary: { providerId: 'deepseek', model: 'deepseek-chat' },
      fallbacks: [],
    }),
    /revision conflict/,
  )
  const projectB = await service.updateProjectModelRoute({
    expectedRevision: projectA.settingsRevision,
    projectId: 'project-b',
    primary: { providerId: 'sensenova', model: 'sensenova-pro' },
    fallbacks: [{ providerId: 'deepseek', model: 'deepseek-chat' }],
  })

  const viewA = await service.getView('project-a')
  const viewB = await service.getView('project-b')
  assert.equal(viewA.effectiveModelRoute.source, 'project')
  assert.equal(viewB.effectiveModelRoute.source, 'project')
  assert.deepEqual(viewA.effectiveModelRoute.selections.map((selection) => selection.model), ['deepseek-chat', 'sensenova-lite'])
  assert.deepEqual(viewB.effectiveModelRoute.selections.map((selection) => selection.model), ['sensenova-pro', 'deepseek-chat'])
  assert.ok(viewA.effectiveModelRoute.selections.every((selection) => selection.desktopAvailable))
  assert.notEqual(viewA.effectiveModelRoute.routeId, viewB.effectiveModelRoute.routeId)
  assert.notEqual(viewA.effectiveModelRoute.selections[0].profileId, viewB.effectiveModelRoute.selections[1].profileId)
  assert.equal(JSON.stringify(projectB).includes('127.0.0.1'), false)

  const persisted = await store.load()
  assert.equal(persisted.projectLayers['project-a'].overrides.workflowLimits.maxSteps, 17)
  assert.equal(persisted.projectLayers['project-a'].selections.workflowProfileId, persisted.catalog.workflowProfiles[0].id)
  assert.notEqual(persisted.projectLayers['project-a'].selections.modelRouteId, persisted.projectLayers['project-b'].selections.modelRouteId)
  const routeA = persisted.catalog.modelRoutes.find((route) => route.id === persisted.projectLayers['project-a'].selections.modelRouteId)
  const routeB = persisted.catalog.modelRoutes.find((route) => route.id === persisted.projectLayers['project-b'].selections.modelRouteId)
  assert.deepEqual([routeA.primaryProfileId, ...routeA.fallbackProfileIds], viewA.effectiveModelRoute.selections.map((selection) => selection.profileId))
  assert.deepEqual([routeB.primaryProfileId, ...routeB.fallbackProfileIds], viewB.effectiveModelRoute.selections.map((selection) => selection.profileId))
  const factory = new DesktopModelProviderFactory({ credentials: { resolveCredential: async () => null } })
  const builtinLayer = {
    scope: 'built_in',
    revision: 'fixture-built-in',
    selections: {
      modelRouteId: persisted.catalog.modelRoutes[0].id,
      memoryProfileId: persisted.catalog.memoryProfiles[0].id,
    },
  }
  const registrationsA = await factory.createRegistrations(persisted, [builtinLayer, persisted.userLayer, persisted.projectLayers['project-a']])
  const registrationsB = await factory.createRegistrations(persisted, [builtinLayer, persisted.userLayer, persisted.projectLayers['project-b']])
  assert.deepEqual(registrationsA.map((registration) => registration.profileId), [routeA.primaryProfileId, ...routeA.fallbackProfileIds])
  assert.deepEqual(registrationsB.map((registration) => registration.profileId), [routeB.primaryProfileId, ...routeB.fallbackProfileIds])

  const removedFallbackProfileId = viewA.effectiveModelRoute.selections[1].profileId
  const projectAUpdated = await service.updateProjectModelRoute({
    expectedRevision: projectB.settingsRevision,
    projectId: 'project-a',
    primary: { providerId: 'deepseek', model: 'deepseek-chat' },
    fallbacks: [],
  })
  const cleaned = await store.load()
  assert.equal(cleaned.catalog.modelProfiles.some((profile) => profile.id === removedFallbackProfileId), false)
  assert.equal(removedFallbackProfileId in cleaned.providerSettings, false)
  assert.equal(projectAUpdated.models.length, 1)
})

test('backend provider catalog degrades safely without exposing connection details', async () => {
  const providers = new DesktopBackendProviderCatalog({
    fetch: async () => { throw new Error('offline') },
  })
  const view = await providers.getView()
  assert.equal(view.available, false)
  assert.deepEqual(view.providers, [])
  assert.match(view.error, /offline/)
})

test('settings store creates defaults, writes atomically and rejects stale or corrupted updates', async (t) => {
  const root = await temporaryRoot(t, 'store')
  const filePath = path.join(root, 'agent-settings.json')
  const store = new DesktopAgentSettingsStore(filePath, { clock: () => '2026-07-27T10:00:00.000Z' })
  const created = await store.loadOrCreate()
  assert.equal(created.schemaVersion, 1)
  assert.equal(created.userLayer.scope, 'user')
  assert.match(created.catalog.modelProfiles[0].credentialRef, /^credential\./)

  const same = await store.save(settingsInputFrom(created), created.revision)
  assert.deepEqual(same, created)
  const updated = await store.update(created.revision, (draft) => {
    draft.userLayer.revision = 'desktop-user-v2'
    draft.providerSettings[draft.catalog.modelProfiles[0].id].baseUrl = 'https://example.invalid/v1'
  })
  assert.notEqual(updated.revision, created.revision)
  assert.equal((await store.load()).providerSettings[updated.catalog.modelProfiles[0].id].baseUrl, 'https://example.invalid/v1')
  await assert.rejects(() => store.update(created.revision, () => undefined), /revision conflict/)

  const raw = await readFile(filePath, 'utf8')
  assert.doesNotMatch(raw, /sk-fixture-secret/)
  await writeFile(filePath, '{broken', 'utf8')
  await assert.rejects(() => store.loadOrCreate(), /not valid JSON/)
})

test('settings store migrates fixed local proxy formats to automatic protocol adaptation', async (t) => {
  const root = await temporaryRoot(t, 'responses-migration')
  const store = new DesktopAgentSettingsStore(path.join(root, 'agent-settings.json'))
  const created = await store.loadOrCreate()
  const legacy = settingsInputFrom(created)
  const profileId = legacy.catalog.modelProfiles[0].id
  legacy.providerSettings[profileId] = {
    provider: 'openai', providerId: 'fixture', connectionSource: 'telance-local-proxy',
    apiStyle: 'chat-completions', baseUrl: 'http://127.0.0.1:8787/provider/fixture',
  }
  const saved = await store.save(legacy, created.revision)
  assert.equal(saved.providerSettings[profileId].apiStyle, 'chat-completions')

  const migrated = await store.loadOrCreate()
  assert.equal(migrated.providerSettings[profileId].apiStyle, 'auto')
  assert.notEqual(migrated.revision, saved.revision)
})

test('desktop OpenAI model capabilities cover built-ins and use a conservative custom-model fallback', () => {
  assert.deepEqual(desktopOpenAIModelCapabilities('gpt-5.6'), {
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
  })
  assert.deepEqual(desktopOpenAIModelCapabilities('gpt-5.6-sol'), {
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
  })
  assert.deepEqual(desktopOpenAIModelCapabilities('gpt-5.6-terra'), {
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
  })
  assert.deepEqual(desktopOpenAIModelCapabilities('gpt-5.6-luna'), {
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
  })
  assert.deepEqual(desktopOpenAIModelCapabilities('ft:gpt-custom:org:suffix:id'), {
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
  })
})

test('config service resolves project layers and creates providers without persisting credentials', async (t) => {
  const root = await temporaryRoot(t, 'service')
  const managerDataRoot = path.join(root, 'manager')
  const projectRoot = path.join(root, 'project')
  const settingsPath = path.join(managerDataRoot, 'agent-settings.json')
  await mkdir(projectRoot, { recursive: true })
  await writeFile(path.join(projectRoot, 'README.md'), '# Fixture\n', 'utf8')
  await initProject(managerDataRoot, projectRoot, 'desktop-config-fixture')
  const dashboard = await getDashboard(managerDataRoot, projectRoot)
  await mkdir(path.join(dashboard.config.dataRoot, 'documents'), { recursive: true })
  await writeFile(path.join(dashboard.config.dataRoot, 'documents', 'W900-fixture-memory.md'), projectDocument('Original stable memory'), 'utf8')
  await mkdir(path.join(managerDataRoot, 'knowledge'), { recursive: true })
  await writeFile(path.join(managerDataRoot, 'knowledge', 'K900-fixture-knowledge.md'), knowledgeDocument(), 'utf8')
  await writeFile(path.join(managerDataRoot, 'knowledge', 'K901-foreign-knowledge.md'), knowledgeDocument({
    id: 'knowledge-foreign',
    shortId: 'K901',
    sourceProject: 'another-project',
  }), 'utf8')
  await appendConstraint(managerDataRoot, projectRoot, {
    title: 'Fixture memory constraint',
    content: 'Never promote task and work-log records into Project Memory.',
  })
  const store = new DesktopAgentSettingsStore(settingsPath)
  const initialSettings = await store.loadOrCreate()
  const configuredModel = await store.update(initialSettings.revision, (draft) => {
    const profile = draft.catalog.modelProfiles[0]
    profile.model = 'gpt-5.6-configured'
    profile.capabilities.contextWindow = 128_000
    profile.capabilities.maxOutputTokens = 16_000
    draft.providerSettings[profile.id].baseUrl = 'https://gateway.example/v1'
  })
  await store.update(configuredModel.revision, (draft) => {
    draft.projectLayers[dashboard.config.projectId] = {
      scope: 'project',
      revision: 'project-layer-v1',
      overrides: { workflowLimits: { maxSteps: 20 } },
    }
  })

  const transportInputs = []
  const providers = new DesktopModelProviderFactory({
    credentials: {
      resolveCredential: async (ref) => ref === 'credential.openai.default' ? 'sk-fixture-secret' : null,
    },
    openAITransportFactory: (input) => {
      transportInputs.push({ ...input })
      return { async *stream() {} }
    },
  })
  const service = new DesktopAgentConfigService({ managerDataRoot, store, providers })
  assert.equal(desktopAgentSettingsPath(managerDataRoot), path.join(managerDataRoot, 'agent', 'settings.json'))
  assert.deepEqual(await service.storageFor(projectRoot), desktopAgentProjectStoragePaths(managerDataRoot, dashboard.config.projectId))
  const runLayer = {
    scope: 'run',
    revision: 'run-layer-v1',
    overrides: { workflowLimits: { maxSteps: 8 } },
  }
  const resolved = await service.resolve(projectRoot, runLayer)
  assert.deepEqual(resolved.layers.map((layer) => layer.scope), ['built_in', 'user', 'project', 'run'])
  assert.equal(resolved.providers.length, 1)
  assert.equal(resolved.catalog.modelProfiles[0].model, 'gpt-5.6-configured')
  assert.equal(resolved.providers[0].provider.profile.id, 'openai:gpt-5.6-configured')
  assert.equal(resolved.providers[0].provider.profile.contextWindow, 128_000)
  assert.equal(resolved.providers[0].provider.profile.maxOutputTokens, 16_000)
  assert.equal(transportInputs[0].apiKey, 'sk-fixture-secret')
  assert.equal(transportInputs[0].profileId, 'desktop.model.openai.default')
  assert.equal(transportInputs[0].baseUrl, 'https://gateway.example/v1')
  assert.match(resolved.projectRulesRevision, /^[a-f0-9]{64}$/)
  assert.equal(resolved.projectMemoryDocuments.some((item) => item.id === 'document:W900' && item.trust === 'untrusted'), true)
  assert.equal(resolved.projectMemoryDocuments.some((item) => item.id.includes('knowledge:') && item.trust === 'untrusted'), true)
  assert.equal(resolved.projectMemoryDocuments.some((item) => item.id.includes('knowledge-foreign')), false)
  assert.equal(resolved.projectMemoryDocuments.some((item) => item.id.includes('constraint:') && item.trust === 'trusted_project'), true)
  assert.equal(resolved.projectMemoryDocuments.some((item) => item.path.includes('工程任务') || item.path.includes('工作记录')), false)
  const memoryStatus = await service.getProjectMemoryStatus(projectRoot)
  assert.equal(memoryStatus.enabled, true)
  assert.equal(memoryStatus.profile.mode, 'balanced')
  assert.deepEqual(memoryStatus.sources.byKind, {
    constraints: resolved.projectMemoryDocuments.filter((item) => item.id.startsWith('constraint:')).length,
    documents: 1,
    knowledge: 1,
  })
  assert.deepEqual(memoryStatus.sources.byTrust, {
    trustedProject: memoryStatus.sources.byKind.constraints,
    untrusted: 2,
  })
  assert.equal(JSON.stringify(memoryStatus).includes('Original stable memory'), false)

  const runner = await createHeadlessAgentRunner({
    projectRoot,
    checkpointPath: path.join(root, 'runs.sqlite'),
    workLevel: 'light',
    catalog: resolved.catalog,
    layers: resolved.layers,
    providers: resolved.providers,
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'fixture scope' }),
    projectRulesRevision: resolved.projectRulesRevision,
    projectMemoryDocuments: resolved.projectMemoryDocuments,
  })
  const checkpoint = await runner.createRun({
    runId: 'config-service-run',
    goal: 'Prove desktop configuration can create a run',
    acceptanceCriteria: [{ id: 'acceptance-001', description: 'Checkpoint is created' }],
    constraints: [],
    intent: 'analysis',
    verificationPlan: { checks: [] },
  })
  const snapshotJson = JSON.stringify(checkpoint.snapshot)
  assert.match(snapshotJson, /credential\.openai\.default/)
  assert.doesNotMatch(snapshotJson, /sk-fixture-secret/)
  assert.doesNotMatch(await readFile(settingsPath, 'utf8'), /sk-fixture-secret/)
  runner.close()

  await writeFile(path.join(dashboard.config.dataRoot, 'documents', 'W900-fixture-memory.md'), projectDocument('Changed stable memory'), 'utf8')
  const changedMemory = await service.resolve(projectRoot, runLayer)
  const memoryDriftRunner = await createHeadlessAgentRunner({
    projectRoot,
    checkpointPath: path.join(root, 'runs.sqlite'),
    workLevel: 'light',
    catalog: changedMemory.catalog,
    layers: changedMemory.layers,
    providers: changedMemory.providers,
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'fixture scope' }),
    projectRulesRevision: changedMemory.projectRulesRevision,
    projectMemoryDocuments: changedMemory.projectMemoryDocuments,
  })
  await assert.rejects(
    () => memoryDriftRunner.advance('config-service-run'),
    /memory does not match the run snapshot/,
  )
  memoryDriftRunner.close()

  const beforeRuntimeChange = await store.load()
  await store.update(beforeRuntimeChange.revision, (draft) => {
    draft.providerSettings[draft.catalog.modelProfiles[0].id].reasoningEffort = 'high'
  })
  const changedRuntime = await service.resolve(projectRoot)
  const driftRunner = await createHeadlessAgentRunner({
    projectRoot,
    checkpointPath: path.join(root, 'runs.sqlite'),
    workLevel: 'light',
    catalog: changedRuntime.catalog,
    layers: changedRuntime.layers,
    providers: changedRuntime.providers,
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'fixture scope' }),
    projectRulesRevision: changedRuntime.projectRulesRevision,
    projectMemoryDocuments: changedRuntime.projectMemoryDocuments,
  })
  await assert.rejects(
    () => driftRunner.advance('config-service-run'),
    /config does not match the run snapshot/,
  )
  driftRunner.close()

  const taskDashboard = await appendTask(managerDataRoot, projectRoot, {
    title: 'Start through configured desktop backend',
    workLevel: 'light',
    executionDefinition: 'Create a persisted run through the desktop configuration service.',
    acceptance: '- Run checkpoint exists',
  })
  const task = taskDashboard.tasks.find((item) => item.title === 'Start through configured desktop backend')
  assert.ok(task)
  const permissionPolicy = new FakePermissionPolicy({ effect: 'allow', reason: 'fixture scope' })
  const backend = createHeadlessDesktopAgentBackend({
    storageFor: (targetRoot) => service.storageFor(targetRoot),
    runnerOptionsFor: async ({ projectRoot: targetRoot }) => ({
      ...await service.resolve(targetRoot),
      permissionPolicy,
    }),
  })
  const coordinator = new DesktopAgentCoordinator({ managerDataRoot, backend })
  const started = await coordinator.startTask({
    projectRoot,
    taskId: task.id,
    runId: 'configured-desktop-run',
  })
  assert.equal(started.run.status, 'running')
  assert.equal(started.run.task.status, 'doing')
  await writeFile(path.join(dashboard.config.dataRoot, 'documents', 'W900-fixture-memory.md'), projectDocument('Changed after desktop Run creation'), 'utf8')
  const resumedWithPinnedMemory = await coordinator.advanceRun({
    projectRoot,
    runId: 'configured-desktop-run',
    untilPause: false,
  })
  assert.equal(resumedWithPinnedMemory.run.status, 'failed')

  const missingCredentialFactory = new DesktopModelProviderFactory({
    credentials: { resolveCredential: async () => null },
  })
  const missingCredentialService = new DesktopAgentConfigService({
    managerDataRoot,
    store,
    providers: missingCredentialFactory,
  })
  await assert.rejects(() => missingCredentialService.resolve(projectRoot), /Credential is unavailable/)

  const customEndpointSettings = await store.load()
  await store.update(customEndpointSettings.revision, (draft) => {
    draft.providerSettings[draft.catalog.modelProfiles[0].id].baseUrl = 'https://compatible.example/v1'
  })
  const compatibleEndpoint = await service.resolve(projectRoot)
  assert.equal(compatibleEndpoint.providers.length, 1)
  assert.equal(transportInputs.at(-1).baseUrl, 'https://compatible.example/v1')
})

test('project memory conversion is bounded and rejects unsafe collaboration paths', () => {
  const document = {
    path: 'documents/W001-safe.md',
    folder: 'documents',
    title: 'Safe document',
    type: 'document',
    status: 'active',
    shortId: 'W001',
    updated: '2026-07-28 10:00',
    version: 'V001',
    tags: ['memory'],
    summary: 'Safe',
    content: 'x'.repeat(40_000),
  }
  const dashboard = {
    constraints: [],
    documents: [document, { ...document, path: 'documents/W002-archived.md', shortId: 'W002', status: 'archived' }],
    knowledge: [],
  }
  const converted = projectMemoryDocumentsFromDashboard(dashboard)
  assert.equal(converted.length, 1)
  assert.equal(converted[0].content.length, 32_000)
  assert.equal(converted[0].content.endsWith('…'), true)
  assert.throws(
    () => projectMemoryDocumentsFromDashboard({
      ...dashboard,
      documents: [{ ...document, path: '../outside/W001.md' }],
    }),
    /path is unsafe/,
  )
})

test('project memory status marks minimal mode disabled while retaining bounded available-source counts', () => {
  const minimal = {
    id: 'memory.minimal.fixture',
    revision: 'minimal-v1',
    mode: 'minimal',
    sourceBudgets: { runFacts: 100, session: 200, project: 300, user: 400 },
  }
  const documents = Array.from({ length: 140 }, (_, index) => ({
    id: `${index % 2 ? 'document' : 'constraint'}:${index}`,
    path: index % 2 ? `documents/W${index}.md` : `constraints/C${index}.md`,
    title: `Document ${index}`,
    summary: 'secret summary must not cross the DTO',
    tags: [],
    scope: 'project',
    trust: index % 2 ? 'untrusted' : 'trusted_project',
    content: 'secret original must not cross the DTO',
  }))
  const status = desktopProjectMemoryStatus({
    catalog: { memoryProfiles: [minimal] },
    layers: [{ scope: 'built_in', revision: '1', selections: { memoryProfileId: minimal.id } }],
    documents,
  })
  assert.equal(status.enabled, false)
  assert.equal(status.sources.total, 128)
  assert.deepEqual(status.sources.byTrust, { trustedProject: 64, untrusted: 64 })
  assert.doesNotMatch(JSON.stringify(status), /secret/)
})

function projectDocument(body) {
  return `# Fixture Project Memory\n\nshort_id:: W900\ntype:: document\nstatus:: active\nupdated:: 2026-07-28 10:00\nversion:: V001\ntags:: fixture,memory\nsummary:: Stable project memory fixture.\n\n${body}\n`
}

function knowledgeDocument(overrides = {}) {
  const id = overrides.id || 'knowledge-fixture'
  const shortId = overrides.shortId || 'K900'
  const sourceProject = overrides.sourceProject || 'desktop-config-fixture'
  return `# Fixture Knowledge\n\nid:: ${id}\nshort_id:: ${shortId}\ntype:: knowledge\nstatus:: active\nupdated:: 2026-07-28 10:00\ntags:: fixture,knowledge\nsource_project:: ${sourceProject}\nsource:: W900\nsummary:: Shared fixture knowledge.\n\nStable shared knowledge content.\n`
}

function fixtureProviderCatalog() {
  return new DesktopBackendProviderCatalog({
    fetch: async () => new Response(JSON.stringify({
      ok: true,
      activeProvider: 'groq',
      providers: {
        groq: {
          name: 'Groq Fixture',
          models: ['llama-fixture'],
          defaultModel: 'llama-fixture',
          free: true,
          configured: true,
          baseUrl: 'https://secret-upstream.example/v1',
          apiKey: 'fixture-secret-that-must-not-pass-through',
        },
        deepseek: {
          name: 'DeepSeek Fixture',
          models: ['deepseek-chat'],
          defaultModel: 'deepseek-chat',
          configured: true,
        },
        sensenova: {
          name: 'SenseNova Fixture',
          models: ['sensenova-lite', 'sensenova-pro'],
          defaultModel: 'sensenova-lite',
          configured: true,
        },
        openai: {
          name: 'OpenAI Fixture',
          models: ['gpt-fixture'],
          defaultModel: 'gpt-fixture',
          configured: false,
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  })
}

async function temporaryRoot(t, suffix) {
  const root = await mkdtemp(path.join(os.tmpdir(), `electron-manager-desktop-config-${suffix}-`))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
