import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AgentStepper,
  FakeAgentRuntime,
  FakeModelProvider,
  FakePermissionPolicy,
  createRunLedger,
} from '@electron-manager/agent-core'
import { ContextAssembler, ContextSourceRegistry } from '@electron-manager/agent-context'
import { DeterministicSessionCompactor, sessionCompactionPolicyFromProfile } from '../dist/index.js'

const estimator = {
  estimate(text) {
    if (text.includes('deterministic_session_summary')) return 20
    const value = Number(text)
    return Number.isFinite(value) ? value : Math.max(1, Math.ceil(Buffer.byteLength(text, 'utf8') / 4))
  },
}

function policy(overrides = {}) {
  return {
    revision: 'memory-policy-v1',
    targetTokens: 100,
    warningTokens: 120,
    compactTokens: 140,
    hardStopTokens: 220,
    ...overrides,
  }
}

function budget() {
  return {
    maxInputTokens: 300,
    reservedOutputTokens: 50,
    regionTokens: {
      stable_system_prefix: 80,
      stable_capability_prefix: 80,
      compacted_history: 100,
      recent_dynamic_context: 180,
      newest_message: 40,
    },
  }
}

function ledger() {
  return createRunLedger({
    runId: 'run-memory',
    projectRoot: '/workspace/project',
    goal: 'Preserve facts while compacting old session context',
    acceptanceCriteria: [{ id: 'criterion-1', description: 'Context remains traceable', required: true }],
    constraints: ['Never compact run facts'],
    workLevel: 'deep',
    intent: 'change',
    verificationPlan: { checks: [] },
    limits: {
      maxSteps: 10,
      maxDurationMs: 3_600_000,
      maxInputTokens: 300,
      maxOutputTokens: 50,
      maxRepeatedFailures: 3,
    },
  }, '2026-07-27T06:20:00.000Z')
}

function entry(id, region, estimatedTokens, overrides = {}) {
  return {
    id,
    role: region === 'stable_system_prefix' ? 'system' : 'user',
    content: String(estimatedTokens),
    sourceRefs: [`ref:${id}`],
    ...(region.startsWith('stable_') ? {} : { sequence: overrides.sequence ?? 1 }),
    sourceId: `source:${id}`,
    sourceRevision: '1',
    region,
    scope: region.startsWith('stable_') ? 'system' : 'session',
    trust: overrides.trust ?? (region.startsWith('stable_') ? 'trusted_system' : 'trusted_run'),
    priority: 50,
    required: overrides.required ?? (region.startsWith('stable_') || region === 'newest_message'),
    compressible: overrides.compressible ?? (region === 'recent_dynamic_context'),
    maxTokens: 300,
    estimatedTokens,
  }
}

function input(entries, ledgerValue = ledger()) {
  return {
    runId: ledgerValue.runId,
    ledger: ledgerValue,
    tools: [],
    entries,
    budget: budget(),
  }
}

test('pressure stays observable without compacting below the compact threshold', () => {
  const compactor = new DeterministicSessionCompactor({ policy: policy(), tokenEstimator: estimator })
  const healthy = compactor.compact(input([
    entry('system', 'stable_system_prefix', 20),
    entry('newest', 'newest_message', 10, { sequence: 2, compressible: false }),
  ]))
  const warning = compactor.compact(input([
    entry('system', 'stable_system_prefix', 40),
    entry('recent', 'recent_dynamic_context', 80, { sequence: 1 }),
    entry('newest', 'newest_message', 10, { sequence: 2, compressible: false }),
  ]))

  assert.equal(healthy.pressure.level, 'healthy')
  assert.equal(warning.pressure.level, 'warning')
  assert.equal(warning.compaction, undefined)
  assert.deepEqual(warning.entries.map((item) => item.id), ['system', 'recent', 'newest'])
})

test('MemoryProfile compression settings map without package coupling', () => {
  assert.deepEqual(sessionCompactionPolicyFromProfile({
    id: 'memory.balanced',
    revision: '3',
    compression: {
      targetTokens: 100,
      warningTokens: 120,
      compactTokens: 140,
      hardStopTokens: 220,
    },
  }), {
    revision: 'memory.balanced@3',
    targetTokens: 100,
    warningTokens: 120,
    compactTokens: 140,
    hardStopTokens: 220,
  })
})

test('deterministic compaction replaces only old compressible context and retains traceability', () => {
  const compactor = new DeterministicSessionCompactor({ policy: policy(), tokenEstimator: estimator })
  const result = compactor.compact(input([
    entry('system', 'stable_system_prefix', 20),
    entry('run-facts', 'recent_dynamic_context', 30, { sequence: 1, compressible: false, required: true }),
    entry('old-tool-1', 'recent_dynamic_context', 70, { sequence: 2, trust: 'untrusted' }),
    entry('old-tool-2', 'recent_dynamic_context', 60, { sequence: 3 }),
    entry('newest', 'newest_message', 10, { sequence: 4, compressible: false }),
  ]))

  assert.equal(result.pressure.level, 'compacted')
  assert.equal(result.compaction.strategy, 'deterministic')
  assert.deepEqual(result.compaction.replacedFragmentIds, ['old-tool-1', 'old-tool-2'])
  assert.deepEqual(result.compaction.coveredFragmentIds, ['old-tool-1', 'old-tool-2'])
  assert.deepEqual(result.compaction.sourceRefs, ['ref:old-tool-1', 'ref:old-tool-2'])
  assert.equal(result.compaction.summary.observations[0].trust, 'untrusted')
  assert.equal(result.entries.some((item) => item.id === 'run-facts'), true)
  assert.equal(result.entries.some((item) => item.id === 'newest'), true)
  assert.equal(result.entries.at(-1).id.startsWith('compaction-summary-'), true)
  assert.ok(result.compaction.afterTokens < result.compaction.beforeTokens)
})

test('restored compaction hides covered raw fragments and a later compaction extends coverage', () => {
  const compactor = new DeterministicSessionCompactor({ policy: policy(), tokenEstimator: estimator })
  const raw = [
    entry('system', 'stable_system_prefix', 20),
    entry('old-1', 'recent_dynamic_context', 100, { sequence: 1 }),
    entry('old-2', 'recent_dynamic_context', 70, { sequence: 2 }),
    entry('newest', 'newest_message', 10, { sequence: 3, compressible: false }),
  ]
  const first = compactor.compact(input(raw))
  const restoredLedger = { ...ledger(), compactions: [first.compaction], updatedAt: '2026-07-27T06:21:00.000Z' }
  const second = compactor.compact(input([
    ...raw,
    entry('new-tool', 'recent_dynamic_context', 100, { sequence: 4 }),
  ], restoredLedger))

  assert.equal(second.entries.some((item) => item.id === 'old-1'), false)
  assert.equal(second.entries.some((item) => item.id === 'old-2'), false)
  assert.deepEqual(second.compaction.coveredFragmentIds, ['new-tool', 'old-1', 'old-2'])
  assert.equal(second.compaction.id, 'run-memory:compaction:2')
})

test('a restored summary keeps its active revision without creating a duplicate record', () => {
  const compactor = new DeterministicSessionCompactor({ policy: policy(), tokenEstimator: estimator })
  const raw = [
    entry('system', 'stable_system_prefix', 20),
    entry('old-1', 'recent_dynamic_context', 100, { sequence: 1 }),
    entry('old-2', 'recent_dynamic_context', 70, { sequence: 2 }),
    entry('newest', 'newest_message', 10, { sequence: 3, compressible: false }),
  ]
  const first = compactor.compact(input(raw))
  const restoredLedger = { ...ledger(), compactions: [first.compaction], updatedAt: '2026-07-27T06:21:00.000Z' }
  const restored = compactor.compact(input(raw, restoredLedger))

  assert.equal(restored.compaction, undefined)
  assert.equal(restored.compactionRevision, first.compaction.revision)
  assert.equal(restored.entries.some((item) => item.id === first.compaction.summaryFragmentId), true)
  assert.equal(restored.entries.some((item) => item.id === 'old-1'), false)
})

test('hard-stop fails clearly when protected context cannot be reduced', () => {
  const compactor = new DeterministicSessionCompactor({ policy: policy(), tokenEstimator: estimator })
  assert.throws(() => compactor.compact(input([
    entry('system', 'stable_system_prefix', 120),
    entry('run-facts', 'recent_dynamic_context', 100, { sequence: 1, compressible: false, required: true }),
    entry('newest', 'newest_message', 10, { sequence: 2, compressible: false }),
  ])), (error) => error.code === 'CONTEXT_BUDGET_EXCEEDED' && /hard-stop/.test(error.message))
})

test('ContextAssembler and AgentStepper persist one compaction and keep newest message last', async () => {
  const sources = [
    source('system', 'stable_system_prefix', '20', { compressible: false, required: true }),
    source('run-facts', 'recent_dynamic_context', '30', { sequence: 1, compressible: false, required: true }),
    source('old-tool-1', 'recent_dynamic_context', '70', { sequence: 2, trust: 'untrusted' }),
    source('old-tool-2', 'recent_dynamic_context', '60', { sequence: 3 }),
    source('newest', 'newest_message', '10', { sequence: 4, compressible: false, required: true }),
  ]
  const contextAssembler = new ContextAssembler({
    registry: new ContextSourceRegistry(sources),
    budget: budget(),
    tokenEstimator: estimator,
    compactor: new DeterministicSessionCompactor({ policy: policy(), tokenEstimator: estimator }),
  })
  const provider = new FakeModelProvider([[
    { type: 'action', action: { kind: 'blocked', summary: 'Compaction captured', reason: 'fixture' } },
    { type: 'completed', finishReason: 'stop' },
  ]])
  const stepper = new AgentStepper({
    provider,
    contextAssembler,
    runtime: new FakeAgentRuntime(),
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'fixture' }),
    tools: [],
    clock: () => '2026-07-27T06:22:00.000Z',
  })
  const result = await stepper.step(ledger())
  const request = provider.requests[0]

  assert.equal(result.ledger.compactions.length, 1, JSON.stringify({
    disposition: result.disposition,
    phase: result.ledger.phase,
    events: result.events,
    providerRequests: provider.requests.length,
  }))
  assert.equal(result.ledger.contextEnvelopes[0].compactionRevision, result.ledger.compactions[0].revision)
  assert.equal(result.events.filter((event) => event.type === 'context.compacted').length, 1)
  assert.equal(request.messages.at(-1).content, '10')
  assert.equal(request.contextRevision, result.ledger.contextEnvelopes[0].revision)
})

function source(id, region, content, overrides = {}) {
  return {
    descriptor: {
      id: `source:${id}`,
      revision: '1',
      region,
      scope: region.startsWith('stable_') ? 'system' : 'session',
      trust: overrides.trust ?? (region.startsWith('stable_') ? 'trusted_system' : 'trusted_run'),
      priority: 50,
      required: overrides.required ?? false,
      compressible: overrides.compressible ?? (region === 'recent_dynamic_context'),
      maxTokens: 300,
    },
    collect: () => [{
      id,
      role: region.startsWith('stable_') ? 'system' : 'user',
      content,
      sourceRefs: [`ref:${id}`],
      ...(overrides.sequence === undefined ? {} : { sequence: overrides.sequence }),
    }],
  }
}
