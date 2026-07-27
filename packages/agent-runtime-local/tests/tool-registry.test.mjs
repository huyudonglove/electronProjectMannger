import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  LocalAgentRuntime,
  ToolRegistry,
  localToolDescriptors,
} from '../dist/index.js'

function descriptor(name, overrides = {}) {
  return {
    name,
    version: '1.0.0',
    title: name,
    description: `Run ${name}`,
    useWhen: `Use ${name} in its fixture`,
    avoidWhen: `Avoid ${name} outside its fixture`,
    risk: 'read',
    riskCategory: 'read',
    baseRiskLevel: 'low',
    recovery: 'safe_replay',
    sideEffects: [],
    retryable: true,
    backends: [{ id: 'fixture-native', kind: 'native' }],
    preferredBackendId: 'fixture-native',
    inputSchema: { type: 'object', additionalProperties: false },
    ...overrides,
  }
}

function module(name, overrides = {}) {
  const toolDescriptor = descriptor(name, overrides.descriptor)
  return {
    descriptor: toolDescriptor,
    probe: overrides.probe || (async () => ({
      toolName: name,
      checkedAt: '2026-07-27T05:00:00.000Z',
      available: true,
      selectedBackend: 'fixture-native',
      backends: [{ backendId: 'fixture-native', available: true, version: '1' }],
    })),
    execute: overrides.execute || (async (request) => ({
      requestId: request.id,
      ok: true,
      summary: `Executed ${name}`,
      startedAt: '2026-07-27T05:00:00.000Z',
      completedAt: '2026-07-27T05:00:01.000Z',
    })),
  }
}

test('registry ordering and revision stay stable regardless of registration order', async () => {
  const mutable = module('beta')
  const first = new ToolRegistry([mutable, module('alpha')])
  const second = new ToolRegistry([module('alpha'), module('beta')])
  mutable.descriptor.description = 'mutated after registration'
  const firstSnapshot = await first.probe()
  const secondSnapshot = await second.probe()

  assert.deepEqual(first.definitions().map((tool) => tool.name), ['alpha', 'beta'])
  assert.equal(firstSnapshot.revision, secondSnapshot.revision)
  assert.equal(first.descriptors().find((tool) => tool.name === 'beta').description, 'Run beta')
  assert.deepEqual(firstSnapshot.tools.map((tool) => tool.name), ['alpha', 'beta'])
  assert.equal(firstSnapshot.tools.every((tool) => tool.availability.available), true)
})

test('registry rejects duplicate names and records probe failures as unavailable', async () => {
  assert.throws(() => new ToolRegistry([module('same'), module('same')]), /Duplicate tool registration/)
  const registry = new ToolRegistry([module('offline', {
    probe: async () => { throw new Error('binary missing') },
  })])
  const snapshot = await registry.probe()
  assert.equal(snapshot.tools[0].availability.available, false)
  assert.match(snapshot.tools[0].availability.backends[0].reason, /binary missing/)
})

test('all built-in tools expose risk, recovery and backend metadata', () => {
  assert.deepEqual(localToolDescriptors.map((tool) => tool.name), [
    'list_files',
    'search_text',
    'read_file',
    'git_status',
    'git_diff',
    'create_file',
    'apply_patch',
    'exec_command',
  ])
  for (const tool of localToolDescriptors) {
    assert.ok(tool.version)
    assert.ok(tool.useWhen)
    assert.ok(tool.avoidWhen)
    assert.ok(tool.baseRiskLevel)
    assert.equal(tool.riskCategory, tool.risk)
    assert.ok(tool.recovery)
    assert.ok(tool.backends.some((backend) => backend.id === tool.preferredBackendId))
  }
  assert.equal(localToolDescriptors.find((tool) => tool.name === 'read_file').baseRiskLevel, 'low')
  assert.equal(localToolDescriptors.find((tool) => tool.name === 'apply_patch').recovery, 'reconcile_then_resume')
  assert.equal(localToolDescriptors.find((tool) => tool.name === 'exec_command').baseRiskLevel, 'high')
})

test('runtime accepts a new registered module without adding a central dispatch branch', async (t) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-registry-'))
  t.after(() => rm(projectRoot, { recursive: true, force: true }))
  const custom = module('custom_read')
  const runtime = new LocalAgentRuntime(projectRoot, { modules: [custom] })
  const request = {
    id: 'custom-1',
    name: 'custom_read',
    input: {},
    requestedAt: '2026-07-27T05:00:00.000Z',
    actionDigest: 'custom-digest',
  }
  const result = await runtime.execute(request, {
    runId: 'run-1',
    projectRoot,
    permission: { effect: 'allow', reason: 'fixture' },
  })

  assert.equal(result.ok, true)
  assert.equal(result.summary, 'Executed custom_read')
  assert.deepEqual(runtime.toolDefinitions().map((tool) => tool.name), ['custom_read'])
})

test('built-in runtime snapshot records availability for all eight tools', async (t) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-availability-'))
  t.after(() => rm(projectRoot, { recursive: true, force: true }))
  const runtime = new LocalAgentRuntime(projectRoot)
  const snapshot = await runtime.probeTools()

  assert.equal(snapshot.schemaVersion, 1)
  assert.match(snapshot.revision, /^[a-f0-9]{64}$/)
  assert.equal(snapshot.tools.length, 8)
  assert.equal(snapshot.tools.find((tool) => tool.name === 'read_file').availability.selectedBackend, 'node-native')
  assert.equal(snapshot.tools.find((tool) => tool.name === 'list_files').availability.available, true)
  assert.equal(snapshot.tools.find((tool) => tool.name === 'git_status').availability.available, true)
  assert.equal(snapshot.tools.find((tool) => tool.name === 'exec_command').availability.available, true)
})
