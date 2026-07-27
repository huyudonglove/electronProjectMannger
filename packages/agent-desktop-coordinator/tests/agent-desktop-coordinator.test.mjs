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

test('blocked run with file changes writes one log but keeps the project task doing', async (t) => {
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
  assert.equal(blocked.run.task.status, 'doing')
  assert.equal(blocked.run.recordSync, 'applied')

  const dashboard = await getDashboard(fixture.managerDataRoot, fixture.projectRoot)
  const logs = dashboard.logs.filter((log) => log.source === 'agent-run:desktop-run-blocked')
  assert.equal(logs.length, 1)
  assert.equal(logs[0].recordLevel, 'standard')
  assert.match(logs[0].result, /任务保持进行中/)
  assert.deepEqual(logs[0].changedFiles, ['src/value.js'])
})

function createCoordinator(fixture, modelProvider) {
  const backend = createHeadlessDesktopAgentBackend({
    storageFor: () => ({
      checkpointPath: fixture.checkpointPath,
      outputDirectory: fixture.outputDirectory,
    }),
    runnerOptionsFor: () => runnerOptions(modelProvider),
  })
  return new DesktopAgentCoordinator({
    managerDataRoot: fixture.managerDataRoot,
    backend,
    createRunId: () => 'generated-run-id',
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
