import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import { FakeModelProvider, FakePermissionPolicy } from '@electron-manager/agent-core'
import {
  DEFAULT_MEMORY_PROFILE,
  DEFAULT_PROMPT_PROFILE,
  DEFAULT_SLOT_POLICY,
  DEFAULT_TOOL_POLICY,
  DEFAULT_WORKFLOW_PROFILE,
  createBuiltinConfigLayer,
} from '@electron-manager/agent-config'
import { computeActionDigest } from '@electron-manager/agent-runtime-local'
import { appendTask, getDashboard, initProject } from '@electron-manager/project-core'

import {
  DesktopAgentCoordinator,
  createHeadlessDesktopAgentBackend,
  toDesktopRunView,
} from '../dist/index.js'

const exec = promisify(execFile)
const enabledTools = ['apply_patch', 'exec_command', 'git_diff', 'read_file']

test('desktop coordinator runs a project task, publishes persisted events and synchronizes one log', async (t) => {
  const fixture = await createFixture(t, 'completed')
  const modelProvider = provider([
    turn({ kind: 'inspect', request: request('read-1', 'read_file', { path: 'src/value.js' }) }),
    turn({ kind: 'plan', id: 'plan-1', summary: 'Update and verify the fixture', rationale: 'Standard runs require a plan', actionDigest: 'plan-1-digest' }),
    turn({
      kind: 'tool',
      request: request('patch-1', 'apply_patch', {
        operations: [{ path: 'src/value.js', oldText: 'value = 1', newText: 'value = 2' }],
      }),
    }),
    turn({
      kind: 'verify',
      checkId: 'unit',
      request: request('verify-1', 'exec_command', { command: 'npm', args: ['test'] }),
    }),
    turn({ kind: 'tool', request: request('diff-1', 'git_diff', {}) }),
    turn({
      kind: 'finish',
      summary: 'Updated and verified the value',
      acceptanceEvidence: [{
        criterionId: 'acceptance-001',
        summary: 'Value and unit test passed',
        refs: ['patch-1', 'unit'],
      }],
      diff: {
        toolRequestId: 'diff-1',
        changedFiles: ['src/value.js'],
        summary: 'Updated src/value.js',
      },
    }),
  ])
  const coordinator = createCoordinator(fixture, modelProvider)
  const notifications = []
  coordinator.subscribe((notification) => notifications.push(notification))

  const started = await coordinator.startTask({
    projectRoot: fixture.projectRoot,
    taskId: fixture.task.shortId,
    runId: 'desktop-run-completed',
    verificationPlan: {
      checks: [{ id: 'unit', label: 'Fixture unit test', command: ['npm', 'test'] }],
    },
  })
  assert.equal(started.run.status, 'running')
  assert.equal(started.run.task.status, 'doing')
  assert.equal(started.run.recordSync, 'not_required')

  const completed = await coordinator.advanceRun({
    projectRoot: fixture.projectRoot,
    runId: 'desktop-run-completed',
  })
  assert.equal(completed.run.status, 'completed', JSON.stringify(completed, null, 2))
  assert.equal(completed.run.task.status, 'done')
  assert.equal(completed.run.recordSync, 'applied')
  assert.ok(completed.run.logShortId)
  assert.deepEqual(completed.run.progress.changedFiles, ['src/value.js'])
  assert.equal(completed.run.progress.verificationPassed, 1)
  assert.ok(completed.run.diff.outputRef)
  assert.ok(completed.events.some((event) => event.type === 'run.completed'))

  const output = await coordinator.readOutput(fixture.projectRoot, completed.run.diff.outputRef)
  assert.match(output.content, /value = 2/)
  assert.equal((await coordinator.listRuns(fixture.projectRoot))[0].runId, 'desktop-run-completed')
  assert.ok(notifications.some((item) => item.events.some((event) => event.type === 'tool.completed')))
  assert.equal(notifications.at(-1).run.recordSync, 'applied')

  const dashboard = await getDashboard(fixture.managerDataRoot, fixture.projectRoot)
  assert.equal(dashboard.logs.filter((log) => log.source === 'agent-run:desktop-run-completed').length, 1)
  assert.match(await readFile(path.join(fixture.projectRoot, 'src', 'value.js'), 'utf8'), /value = 2/)

  const reopened = createCoordinator(fixture, provider([]))
  const restored = await reopened.getRun(fixture.projectRoot, 'desktop-run-completed')
  assert.equal(restored.run.recordSync, 'applied')
  const retried = await reopened.advanceRun({ projectRoot: fixture.projectRoot, runId: 'desktop-run-completed' })
  assert.equal(retried.run.status, 'completed')
  const afterRetry = await getDashboard(fixture.managerDataRoot, fixture.projectRoot)
  assert.equal(afterRetry.logs.filter((log) => log.source === 'agent-run:desktop-run-completed').length, 1)
})

test('blocked run with file changes writes one log and returns the project task to todo', async (t) => {
  const fixture = await createFixture(t, 'blocked')
  const coordinator = createCoordinator(fixture, provider([
    turn({ kind: 'inspect', request: request('read-1', 'read_file', { path: 'src/value.js' }) }),
    turn({ kind: 'plan', id: 'plan-1', summary: 'Update the fixture', rationale: 'Standard runs require a plan', actionDigest: 'plan-1-digest' }),
    turn({
      kind: 'tool',
      request: request('patch-1', 'apply_patch', {
        operations: [{ path: 'src/value.js', oldText: 'value = 1', newText: 'value = 3' }],
      }),
    }),
    turn({ kind: 'blocked', summary: 'Dependency decision is required', reason: 'fixture blocker' }),
  ]))
  await coordinator.startTask({
    projectRoot: fixture.projectRoot,
    taskId: fixture.task.id,
    runId: 'desktop-run-blocked',
  })
  const blocked = await coordinator.advanceRun({ projectRoot: fixture.projectRoot, runId: 'desktop-run-blocked' })
  assert.equal(blocked.run.status, 'blocked', JSON.stringify(blocked, null, 2))
  assert.equal(blocked.run.task.status, 'todo')
  assert.equal(blocked.run.recordSync, 'applied')

  const dashboard = await getDashboard(fixture.managerDataRoot, fixture.projectRoot)
  const logs = dashboard.logs.filter((log) => log.source === 'agent-run:desktop-run-blocked')
  assert.equal(logs.length, 1)
  assert.equal(logs[0].recordLevel, 'standard')
  assert.match(logs[0].result, /任务已回到 todo/)
  assert.deepEqual(logs[0].changedFiles, ['src/value.js'])
})

test('coordinator claims a project run before loading it and rejects a concurrent operation', async (t) => {
  const fixture = await createFixture(t, 'concurrent-operation')
  const backend = createBackend(fixture, provider([]))
  const starter = new DesktopAgentCoordinator({
    managerDataRoot: fixture.managerDataRoot,
    backend,
  })
  await starter.startTask({
    projectRoot: fixture.projectRoot,
    taskId: fixture.task.id,
    runId: 'shared-run-id',
  })

  const checkpointRepository = await backend.openRepository(fixture.projectRoot)
  const checkpoint = await checkpointRepository.load('shared-run-id')
  checkpointRepository.close()
  assert.ok(checkpoint)

  const loadEntered = deferred()
  const releaseLoads = deferred()
  let loadCount = 0
  let operationSignal
  const guardedBackend = {
    async openRepository(projectRoot) {
      const repository = await backend.openRepository(projectRoot)
      return {
        async load(runId) {
          loadCount += 1
          loadEntered.resolve()
          await releaseLoads.promise
          return await repository.load(runId)
        },
        list: () => repository.list(),
        readOutput: (ref) => repository.readOutput(ref),
        close: () => repository.close(),
      }
    },
    async openRunner() {
      const result = { checkpoint }
      return {
        createRun: async () => checkpoint,
        advance: async (_runId, signal) => {
          operationSignal = signal
          return result
        },
        runUntilPause: async (_runId, signal) => {
          operationSignal = signal
          return result
        },
        resolveApproval: async (_runId, _resolution, signal) => {
          operationSignal = signal
          return result
        },
        close() {},
      }
    },
  }
  const coordinator = new DesktopAgentCoordinator({
    managerDataRoot: fixture.managerDataRoot,
    backend: guardedBackend,
  })

  const first = coordinator.advanceRun({
    projectRoot: fixture.projectRoot,
    runId: 'shared-run-id',
  })
  await loadEntered.promise
  const second = coordinator.advanceRun({
    projectRoot: fixture.projectRoot,
    runId: 'shared-run-id',
  }).then(() => null, (error) => error)
  await new Promise((resolve) => setImmediate(resolve))
  const observedLoadCount = loadCount
  const cancelledCount = coordinator.cancelAllActiveRuns()
  releaseLoads.resolve()

  const [firstResult, secondError] = await Promise.all([first, second])
  assert.equal(observedLoadCount, 1, 'a concurrent operation must be rejected before repository loading starts')
  assert.equal(cancelledCount, 1)
  assert.equal(operationSignal?.aborted, true)
  assert.equal(firstResult.run.runId, 'shared-run-id')
  assert.equal(secondError?.code, 'RUN_OPERATION_ACTIVE')
})

test('desktop run memory view exposes bounded snapshot and compaction metadata without summary text', async (t) => {
  const fixture = await createFixture(t, 'memory-view')
  const backend = createBackend(fixture, provider([]))
  const coordinator = new DesktopAgentCoordinator({ managerDataRoot: fixture.managerDataRoot, backend })
  await coordinator.startTask({
    projectRoot: fixture.projectRoot,
    taskId: fixture.task.id,
    runId: 'desktop-run-memory-view',
  })
  const repository = await backend.openRepository(fixture.projectRoot)
  const checkpoint = await repository.load('desktop-run-memory-view')
  repository.close()
  assert.ok(checkpoint)
  checkpoint.snapshot.memorySnapshot.data.projectMemoryRevision = 'r'.repeat(300)
  checkpoint.snapshot.memorySnapshot.data.projectMemorySnapshotRef = 'output:sha256:fixture'
  checkpoint.snapshot.ledger.compactions = [{
    strategy: 'model',
    trigger: 'compact_threshold',
    beforeTokens: 75_000,
    afterTokens: 49_000,
    createdAt: '2026-07-28T10:00:00.000Z',
    summary: {
      knownFacts: ['sensitive fact'],
      decisions: ['sensitive decision'],
      failures: ['sensitive failure'],
      unresolved: ['sensitive unresolved'],
      observations: [{ excerpt: 'sensitive observation' }, { excerpt: 'another sensitive observation' }],
      sourceRefs: ['private:one', 'private:two'],
      nextAction: 'sensitive next action',
    },
  }]
  const view = toDesktopRunView(checkpoint, await getDashboard(fixture.managerDataRoot, fixture.projectRoot))
  assert.equal(view.memory.projectMemoryRevision.length, 128)
  assert.equal(view.memory.hasProjectMemorySnapshot, true)
  assert.equal(view.memory.compactions.count, 1)
  assert.deepEqual(view.memory.compactions.latest.summary, {
    knownFacts: 1,
    decisions: 1,
    failures: 1,
    unresolved: 1,
    observations: 2,
    sourceRefs: 2,
    hasNextAction: true,
  })
  assert.doesNotMatch(JSON.stringify(view.memory), /sensitive|private:one|output:sha256:fixture/)
})

function createCoordinator(fixture, modelProvider) {
  const backend = createBackend(fixture, modelProvider)
  return new DesktopAgentCoordinator({
    managerDataRoot: fixture.managerDataRoot,
    backend,
    createRunId: () => 'generated-run-id',
  })
}

function createBackend(fixture, modelProvider) {
  return createHeadlessDesktopAgentBackend({
    storageFor: () => ({
      checkpointPath: fixture.checkpointPath,
      outputDirectory: fixture.outputDirectory,
    }),
    runnerOptionsFor: () => runnerOptions(modelProvider),
  })
}

function runnerOptions(modelProvider) {
  const model = {
    id: 'model.fixture',
    revision: '1',
    provider: 'fixture',
    model: 'fixture-coder',
    credentialRef: 'credential.fixture',
    capabilities: {
      structuredOutput: true,
      toolCalls: true,
      contextWindow: 128_000,
      maxOutputTokens: 16_000,
      promptCache: 'implicit',
    },
  }
  const route = {
    id: 'route.fixture',
    revision: '1',
    primaryProfileId: model.id,
    fallbackProfileIds: [],
    requirements: {
      structuredOutput: true,
      toolCalls: true,
      minContextWindow: 32_000,
      promptCache: 'implicit',
    },
    retry: {
      maxAttempts: 1,
      totalTimeoutMs: 60_000,
      totalTokenBudget: 20_000,
      retryableErrors: ['timeout'],
    },
  }
  return {
    catalog: {
      modelProfiles: [model],
      modelRoutes: [route],
      promptProfiles: [DEFAULT_PROMPT_PROFILE],
      workflowProfiles: [DEFAULT_WORKFLOW_PROFILE],
      toolPolicies: [DEFAULT_TOOL_POLICY],
      memoryProfiles: [DEFAULT_MEMORY_PROFILE],
      slotPolicies: [DEFAULT_SLOT_POLICY],
      slotDefinitions: [],
    },
    layers: [createBuiltinConfigLayer(route.id, enabledTools)],
    providers: [{ profileId: model.id, provider: modelProvider }],
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'fixture scope' }),
    runtimeOptions: { timeoutMs: 45_000 },
    outputPreviewCharacters: 80,
    projectRulesRevision: 'fixture-rules-v1',
  }
}

function provider(responses) {
  return new FakeModelProvider(responses, {
    id: 'fixture-provider',
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
    promptCache: 'implicit',
  })
}

function turn(action) {
  return [
    { type: 'action', action },
    {
      type: 'completed',
      finishReason: ['tool', 'inspect', 'verify'].includes(action.kind) ? 'tool_calls' : 'stop',
    },
  ]
}

function request(id, name, input) {
  return {
    id,
    name,
    input,
    requestedAt: new Date().toISOString(),
    actionDigest: computeActionDigest(name, input),
  }
}

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function createFixture(t, suffix) {
  const root = await mkdtemp(path.join(os.tmpdir(), `electron-manager-desktop-coordinator-${suffix}-`))
  t.after(() => rm(root, { recursive: true, force: true }))
  const managerDataRoot = path.join(root, 'manager')
  const projectRoot = path.join(root, 'project')
  const checkpointPath = path.join(root, 'runs.sqlite')
  const outputDirectory = path.join(root, 'outputs')
  await mkdir(path.join(projectRoot, 'src'), { recursive: true })
  await writeFile(path.join(projectRoot, 'src', 'value.js'), 'export const value = 1\n', 'utf8')
  await writeFile(path.join(projectRoot, 'test.mjs'), "import assert from 'node:assert/strict'\nimport { value } from './src/value.js'\nassert.ok(value >= 2)\n", 'utf8')
  await writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({
    name: 'desktop-coordinator-fixture',
    private: true,
    type: 'module',
    scripts: { test: 'node test.mjs' },
  }, null, 2), 'utf8')
  await exec('git', ['init'], { cwd: projectRoot })
  await exec('git', ['config', 'user.email', 'fixture@example.com'], { cwd: projectRoot })
  await exec('git', ['config', 'user.name', 'Fixture'], { cwd: projectRoot })
  await exec('git', ['add', '.'], { cwd: projectRoot })
  await exec('git', ['commit', '-m', 'fixture'], { cwd: projectRoot })

  await initProject(managerDataRoot, projectRoot, `fixture-${suffix}`)
  const dashboard = await appendTask(managerDataRoot, projectRoot, {
    title: `Desktop coordinator ${suffix}`,
    workLevel: 'standard',
    executionDefinition: 'Update the fixture through the desktop coordinator.',
    acceptance: '- Value and unit test pass',
    constraints: '- Preserve project records',
  })
  const task = dashboard.tasks.find((item) => item.title === `Desktop coordinator ${suffix}`)
  assert.ok(task)
  return { managerDataRoot, projectRoot, checkpointPath, outputDirectory, task }
}
