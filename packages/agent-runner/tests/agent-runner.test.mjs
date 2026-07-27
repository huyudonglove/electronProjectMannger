import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import {
  FakeModelProvider,
  FakePermissionPolicy,
} from '@electron-manager/agent-core'
import {
  DEFAULT_MEMORY_PROFILE,
  DEFAULT_PROMPT_PROFILE,
  DEFAULT_SLOT_POLICY,
  DEFAULT_TOOL_POLICY,
  DEFAULT_WORKFLOW_PROFILE,
  createBuiltinConfigLayer,
} from '@electron-manager/agent-config'
import { computeActionDigest } from '@electron-manager/agent-runtime-local'

import { createHeadlessAgentRunner } from '../dist/index.js'

const exec = promisify(execFile)
const enabledTools = ['apply_patch', 'exec_command', 'git_diff', 'read_file']

function turn(action) {
  return [
    { type: 'usage', inputTokens: 100, outputTokens: 20, cachedInputTokens: 40 },
    { type: 'action', action },
    { type: 'completed', finishReason: action.kind === 'finish' ? 'stop' : 'tool_calls' },
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

function provider(responses) {
  return new FakeModelProvider(responses, {
    id: 'fixture-provider',
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
    promptCache: 'implicit',
  })
}

function runnerOptions(root, checkpointPath, modelProvider, extraLayers = []) {
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
    projectRoot: root,
    checkpointPath,
    workLevel: 'light',
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
    layers: [createBuiltinConfigLayer(route.id, enabledTools), ...extraLayers],
    providers: [{ profileId: model.id, provider: modelProvider }],
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'fixture scope' }),
    runtimeOptions: { timeoutMs: 45_000 },
    projectRulesRevision: 'fixture-rules-v1',
  }
}

function runInput(runId) {
  return {
    runId,
    goal: 'Update both fixture values',
    acceptanceCriteria: [{ id: 'acceptance-1', description: 'Both values and tests are updated' }],
    constraints: ['Preserve unrelated files'],
    intent: 'change',
    verificationPlan: {
      checks: [{ id: 'unit', label: 'Fixture unit test', command: ['npm', 'test'] }],
    },
  }
}

test('headless runner composes config, context, router, runtime and SQLite across restart', async (t) => {
  const fixture = await createFixture(t)
  const firstProvider = provider([
    turn({ kind: 'inspect', request: request('read-1', 'read_file', { path: 'src/a.js' }) }),
  ])
  let runner = await createHeadlessAgentRunner(runnerOptions(fixture.root, fixture.checkpointPath, firstProvider))
  const created = await runner.createRun(runInput('run-headless'))
  assert.equal(created.snapshot.revision, 1)
  assert.ok(created.snapshot.configSnapshot)
  assert.ok(created.snapshot.modelRouteSnapshot)
  assert.ok(created.snapshot.toolRegistrySnapshot)
  assert.ok(created.snapshot.memorySnapshot)

  const inspected = await runner.advance('run-headless')
  assert.equal(inspected.decision.kind, 'continue')
  assert.equal(inspected.checkpoint.snapshot.ledger.inspectedFiles[0].path, 'src/a.js')
  assert.match(firstProvider.requests[0].messages.map((message) => message.content).join('\n'), /requested work level: light/)
  assert.equal(firstProvider.requests[0].promptCacheBinding.capability, 'implicit')
  assert.ok(firstProvider.requests[0].promptCacheBinding.cacheKey)
  runner.close()

  const remainingProvider = provider([
    turn({
      kind: 'tool',
      request: request('patch-1', 'apply_patch', {
        operations: [
          { path: 'src/a.js', oldText: 'value = 1', newText: 'value = 10' },
          { path: 'src/b.js', oldText: 'value = 2', newText: 'value = 20' },
        ],
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
      summary: 'Updated and verified both files',
      acceptanceEvidence: [{
        criterionId: 'acceptance-1',
        summary: 'Patch and unit check passed',
        refs: ['patch-1', 'unit'],
      }],
      diff: {
        toolRequestId: 'diff-1',
        changedFiles: ['src/a.js', 'src/b.js'],
        summary: 'Two source files updated',
      },
    }),
  ])
  runner = await createHeadlessAgentRunner(runnerOptions(fixture.root, fixture.checkpointPath, remainingProvider))
  const completed = await runner.runUntilPause('run-headless')
  assert.equal(completed.decision.kind, 'terminal')
  assert.equal(completed.checkpoint.snapshot.ledger.status, 'completed')
  assert.deepEqual(completed.checkpoint.snapshot.ledger.changes.map((item) => item.path), ['src/a.js', 'src/b.js'])
  assert.equal(completed.checkpoint.snapshot.ledger.verifications[0].status, 'passed')
  assert.equal(completed.checkpoint.snapshot.ledger.modelAttempts.length, 5)
  assert.match(await readFile(path.join(fixture.root, 'src', 'a.js'), 'utf8'), /value = 10/)
  assert.match(await readFile(path.join(fixture.root, 'src', 'b.js'), 'utf8'), /value = 20/)
  assert.equal((await runner.list())[0].runId, 'run-headless')
  runner.close()
})

test('headless runner refuses to resume with a different resolved component snapshot', async (t) => {
  const fixture = await createFixture(t)
  let runner = await createHeadlessAgentRunner(runnerOptions(fixture.root, fixture.checkpointPath, provider([
    turn({ kind: 'inspect', request: request('read-1', 'read_file', { path: 'src/a.js' }) }),
  ])))
  await runner.createRun(runInput('run-drift'))
  runner.close()

  runner = await createHeadlessAgentRunner(runnerOptions(fixture.root, fixture.checkpointPath, provider([]), [{
    scope: 'project',
    revision: 'project-config-v2',
    overrides: { promptVariables: { workLevel: 'changed-after-restart' } },
  }]))
  await assert.rejects(
    () => runner.advance('run-drift'),
    (error) => error.code === 'CHECKPOINT_ERROR' && /config does not match/.test(error.message),
  )
  runner.close()
})

async function createFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-runner-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const root = path.join(directory, 'project')
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(path.join(root, 'src', 'a.js'), 'export const value = 1\n', 'utf8')
  await writeFile(path.join(root, 'src', 'b.js'), 'export const value = 2\n', 'utf8')
  await writeFile(path.join(root, 'untouched.txt'), 'keep me\n', 'utf8')
  await writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    private: true,
    type: 'module',
    scripts: { test: 'node test.mjs' },
  }, null, 2)}\n`, 'utf8')
  await writeFile(path.join(root, 'test.mjs'), "import assert from 'node:assert/strict'; import { value as a } from './src/a.js'; import { value as b } from './src/b.js'; assert.equal(a, 10); assert.equal(b, 20); console.log('fixture passed')\n", 'utf8')
  await exec('git', ['init', '-q'], { cwd: root })
  await exec('git', ['config', 'user.email', 'fixture@example.com'], { cwd: root })
  await exec('git', ['config', 'user.name', 'Fixture'], { cwd: root })
  await exec('git', ['add', '.'], { cwd: root })
  await exec('git', ['commit', '-qm', 'fixture'], { cwd: root })
  return { root, checkpointPath: path.join(directory, 'runs.sqlite') }
}
