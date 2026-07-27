import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { FakePermissionPolicy } from '@electron-manager/agent-core'
import { EncryptedCredentialVault } from '@electron-manager/agent-credential-vault'
import {
  DesktopAgentCoordinator,
  createHeadlessDesktopAgentBackend,
} from '@electron-manager/agent-desktop-coordinator'
import { createHeadlessAgentRunner } from '@electron-manager/agent-runner'
import { appendTask, getDashboard, initProject } from '@electron-manager/project-core'

import {
  DesktopAgentConfigService,
  DesktopAgentSettingsService,
  DesktopAgentSettingsStore,
  DesktopModelProviderFactory,
  desktopAgentProjectStoragePaths,
  desktopAgentSettingsPath,
  settingsInputFrom,
} from '../dist/index.js'

test('settings service exposes only credential status and applies revision-checked model settings', async (t) => {
  const root = await temporaryRoot(t, 'settings-service')
  const store = new DesktopAgentSettingsStore(path.join(root, 'settings.json'))
  const credentials = new EncryptedCredentialVault(path.join(root, 'credentials.json'), new FixtureCipher())
  const service = new DesktopAgentSettingsService({ store, credentials })
  const initial = await service.getView()
  assert.equal(initial.models[0].credentialConfigured, false)
  assert.equal(JSON.stringify(initial).includes('sk-fixture-secret'), false)

  const configured = await service.setModelCredential({
    profileId: initial.models[0].profileId,
    value: 'sk-fixture-secret',
    expectedCredentialRevision: initial.credentialRevision,
  })
  assert.equal(configured.models[0].credentialConfigured, true)
  assert.equal(JSON.stringify(configured).includes('sk-fixture-secret'), false)

  const updated = await service.updateOpenAIModel({
    expectedRevision: configured.settingsRevision,
    profileId: configured.models[0].profileId,
    organization: ' org-fixture ',
    project: '',
    reasoningEffort: 'high',
    verbosity: 'medium',
  })
  assert.equal(updated.models[0].organization, 'org-fixture')
  assert.equal(updated.models[0].project, undefined)
  assert.equal(updated.models[0].reasoningEffort, 'high')
  await assert.rejects(
    () => service.updateOpenAIModel({
      expectedRevision: configured.settingsRevision,
      profileId: configured.models[0].profileId,
      reasoningEffort: 'low',
      verbosity: 'low',
    }),
    /revision conflict/,
  )

  const removed = await service.deleteModelCredential({
    profileId: updated.models[0].profileId,
    expectedCredentialRevision: updated.credentialRevision,
  })
  assert.equal(removed.models[0].credentialConfigured, false)
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

test('config service resolves project layers and creates providers without persisting credentials', async (t) => {
  const root = await temporaryRoot(t, 'service')
  const managerDataRoot = path.join(root, 'manager')
  const projectRoot = path.join(root, 'project')
  const settingsPath = path.join(managerDataRoot, 'agent-settings.json')
  await mkdir(projectRoot, { recursive: true })
  await writeFile(path.join(projectRoot, 'README.md'), '# Fixture\n', 'utf8')
  await initProject(managerDataRoot, projectRoot, 'desktop-config-fixture')
  const dashboard = await getDashboard(managerDataRoot, projectRoot)
  const store = new DesktopAgentSettingsStore(settingsPath)
  const initial = await store.loadOrCreate()
  await store.update(initial.revision, (draft) => {
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
  const resolved = await service.resolve(projectRoot, {
    scope: 'run',
    revision: 'run-layer-v1',
    overrides: { workflowLimits: { maxSteps: 8 } },
  })
  assert.deepEqual(resolved.layers.map((layer) => layer.scope), ['built_in', 'user', 'project', 'run'])
  assert.equal(resolved.providers.length, 1)
  assert.equal(resolved.providers[0].provider.profile.contextWindow, 1_000_000)
  assert.equal(resolved.providers[0].provider.profile.maxOutputTokens, 128_000)
  assert.equal(transportInputs[0].apiKey, 'sk-fixture-secret')
  assert.equal(transportInputs[0].profileId, 'desktop.model.openai.default')
  assert.match(resolved.projectRulesRevision, /^[a-f0-9]{64}$/)

  const runner = await createHeadlessAgentRunner({
    projectRoot,
    checkpointPath: path.join(root, 'runs.sqlite'),
    workLevel: 'light',
    catalog: resolved.catalog,
    layers: resolved.layers,
    providers: resolved.providers,
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'fixture scope' }),
    projectRulesRevision: resolved.projectRulesRevision,
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
  await assert.rejects(
    () => service.resolve(projectRoot),
    /capability metadata is unavailable/,
  )
})

async function temporaryRoot(t, suffix) {
  const root = await mkdtemp(path.join(os.tmpdir(), `electron-manager-desktop-config-${suffix}-`))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

class FixtureCipher {
  id = 'fixture.desktop-config.v1'

  isAvailable() {
    return true
  }

  encrypt(value) {
    return Buffer.from(value).map((byte) => byte ^ 0x31)
  }

  decrypt(value) {
    return Buffer.from(value).map((byte) => byte ^ 0x31).toString('utf8')
  }
}
