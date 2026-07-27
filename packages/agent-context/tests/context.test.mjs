import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AgentStepper,
  FakeAgentRuntime,
  FakeModelProvider,
  FakePermissionPolicy,
  createRunLedger,
  recordAgentStep,
} from '@electron-manager/agent-core'
import {
  ContextAssembler,
  ContextSourceRegistry,
  DeterministicTokenEstimator,
  assertAppendOnlyContext,
  createLedgerContextAssembler,
} from '../dist/index.js'

function ledger() {
  return createRunLedger({
    runId: 'run-context',
    projectRoot: '/workspace/project',
    goal: 'Assemble deterministic context',
    acceptanceCriteria: [],
    constraints: ['Preserve run facts'],
    workLevel: 'light',
    intent: 'analysis',
    verificationPlan: { checks: [] },
    limits: {
      maxSteps: 10,
      maxDurationMs: 60_000,
      maxInputTokens: 20_000,
      maxOutputTokens: 4_000,
      maxRepeatedFailures: 3,
    },
  }, '2026-07-27T05:30:00.000Z')
}

function source(id, region, fragments, overrides = {}) {
  return {
    descriptor: {
      id,
      revision: '1',
      region,
      scope: region.startsWith('stable_') ? 'system' : 'session',
      trust: region.startsWith('stable_') ? 'trusted_system' : 'trusted_run',
      priority: 50,
      required: region === 'stable_system_prefix' || region === 'stable_capability_prefix' || region === 'newest_message',
      compressible: region === 'compacted_history' || region === 'recent_dynamic_context',
      maxTokens: 100,
      ...overrides,
    },
    collect: async () => structuredClone(fragments),
  }
}

function budget(overrides = {}) {
  return {
    maxInputTokens: 1_000,
    reservedOutputTokens: 100,
    regionTokens: {
      stable_system_prefix: 200,
      stable_capability_prefix: 200,
      compacted_history: 200,
      recent_dynamic_context: 400,
      newest_message: 100,
    },
    ...overrides,
  }
}

function baseSources(dynamic = []) {
  return [
    source('system', 'stable_system_prefix', [{ id: 'system-1', role: 'system', content: 'System protocol', sourceRefs: ['system:1'] }], { priority: 100, compressible: false }),
    source('capabilities', 'stable_capability_prefix', [{ id: 'capabilities-1', role: 'system', content: 'Tool capabilities', sourceRefs: ['tools:1'] }], { priority: 90, compressible: false }),
    ...dynamic,
  ]
}

async function assemble(sources, options = {}) {
  return await new ContextAssembler({
    registry: new ContextSourceRegistry(sources),
    budget: options.budget || budget(),
    ...(options.tokenEstimator ? { tokenEstimator: options.tokenEstimator } : {}),
  }).assemble({ runId: 'run-context', ledger: ledger(), tools: [] })
}

test('envelope ordering and hashes stay deterministic regardless of source registration order', async () => {
  const sources = baseSources([
    source('history', 'recent_dynamic_context', [
      { id: 'message-1', role: 'user', content: 'Earlier message', sourceRefs: ['message:1'], sequence: 1 },
    ]),
    source('newest', 'newest_message', [
      { id: 'message-2', role: 'user', content: 'Newest message', sourceRefs: ['message:2'], sequence: 2 },
    ], { priority: 100, compressible: false }),
  ])
  const first = await assemble(sources)
  const second = await assemble([...sources].reverse())

  assert.equal(first.revision, second.revision)
  assert.equal(first.stablePrefixRevision, second.stablePrefixRevision)
  assert.match(first.revision, /^[a-f0-9]{64}$/)
  assert.deepEqual(first.messages.map((message) => message.content), [
    'System protocol',
    'Tool capabilities',
    'Earlier message',
    'Newest message',
  ])
  assert.equal(first.messages.at(-1).content, 'Newest message')
  assert.equal(first.regions.recent_dynamic_context[0].trust, 'trusted_run')
  assert.deepEqual(first.regions.recent_dynamic_context[0].sourceRefs, ['message:1'])
})

test('optional context is selected by priority and reports deterministic budget drops', async () => {
  const estimator = { estimate: (text) => Number(text) }
  const sources = baseSources([
    source('optional-low', 'recent_dynamic_context', [
      { id: 'optional-low-1', role: 'user', content: '8', sourceRefs: ['low'], sequence: 2 },
    ], { priority: 10, required: false, maxTokens: 20 }),
    source('optional-high', 'recent_dynamic_context', [
      { id: 'optional-high-1', role: 'user', content: '8', sourceRefs: ['high'], sequence: 1 },
    ], { priority: 90, required: false, maxTokens: 20 }),
    source('newest', 'newest_message', [
      { id: 'newest-1', role: 'user', content: '2', sourceRefs: ['newest'], sequence: 3 },
    ], { priority: 100, compressible: false, maxTokens: 5 }),
  ]).map((item) => {
    if (item.descriptor.id === 'system' || item.descriptor.id === 'capabilities') {
      return { ...item, collect: async () => [{ id: `${item.descriptor.id}-1`, role: 'system', content: '2', sourceRefs: [item.descriptor.id] }] }
    }
    return item
  })
  const envelope = await assemble(sources, {
    tokenEstimator: estimator,
    budget: budget({
      maxInputTokens: 25,
      reservedOutputTokens: 5,
      regionTokens: {
        stable_system_prefix: 5,
        stable_capability_prefix: 5,
        compacted_history: 5,
        recent_dynamic_context: 10,
        newest_message: 5,
      },
    }),
  })

  assert.deepEqual(envelope.regions.recent_dynamic_context.map((entry) => entry.id), ['optional-high-1'])
  assert.deepEqual(envelope.dropped, [{
    sourceId: 'optional-low',
    fragmentId: 'optional-low-1',
    estimatedTokens: 8,
    reason: 'region_budget',
  }])
  assert.equal(envelope.budget.usedInputTokens, 14)
})

test('required context fails clearly instead of truncating authoritative facts', async () => {
  const estimator = { estimate: (text) => Number(text) }
  const sources = [
    source('system', 'stable_system_prefix', [{ id: 'system-1', role: 'system', content: '20', sourceRefs: ['system'] }], { priority: 100, compressible: false }),
    source('capabilities', 'stable_capability_prefix', [{ id: 'capabilities-1', role: 'system', content: '2', sourceRefs: ['caps'] }], { compressible: false }),
    source('newest', 'newest_message', [{ id: 'newest-1', role: 'user', content: '2', sourceRefs: ['newest'], sequence: 1 }], { compressible: false }),
  ]

  await assert.rejects(
    assemble(sources, {
      tokenEstimator: estimator,
      budget: budget({ regionTokens: { ...budget().regionTokens, stable_system_prefix: 10 } }),
    }),
    (error) => error.code === 'CONTEXT_BUDGET_EXCEEDED' && /Required context/.test(error.message),
  )
})

test('append-only transition keeps old dynamic order and places one newer message at the bottom', async () => {
  const previous = await assemble(baseSources([
    source('history', 'recent_dynamic_context', [{ id: 'message-1', role: 'user', content: 'One', sourceRefs: ['m1'], sequence: 1 }]),
    source('newest', 'newest_message', [{ id: 'message-2', role: 'user', content: 'Two', sourceRefs: ['m2'], sequence: 2 }], { compressible: false }),
  ]))
  const next = await assemble(baseSources([
    source('history', 'recent_dynamic_context', [
      { id: 'message-1', role: 'user', content: 'One', sourceRefs: ['m1'], sequence: 1 },
      { id: 'message-2', role: 'user', content: 'Two', sourceRefs: ['m2'], sequence: 2 },
    ]),
    source('newest', 'newest_message', [{ id: 'message-3', role: 'user', content: 'Three', sourceRefs: ['m3'], sequence: 3 }], { compressible: false }),
  ]))

  assert.doesNotThrow(() => assertAppendOnlyContext(previous, next))
  assert.equal(next.messages.at(-1).content, 'Three')

  const reordered = structuredClone(next)
  reordered.regions.recent_dynamic_context.reverse()
  assert.throws(() => assertAppendOnlyContext(previous, reordered), /cannot be reordered/)
})

test('default ledger assembler keeps stable prefixes fixed while dynamic revision changes', async () => {
  const assembler = createLedgerContextAssembler(budget({
    maxInputTokens: 20_000,
    reservedOutputTokens: 4_000,
    regionTokens: {
      stable_system_prefix: 3_000,
      stable_capability_prefix: 6_000,
      compacted_history: 2_000,
      recent_dynamic_context: 8_000,
      newest_message: 1_000,
    },
  }))
  const firstLedger = ledger()
  const secondLedger = recordAgentStep(firstLedger, '2026-07-27T05:31:00.000Z')
  const first = await assembler.assemble({ runId: firstLedger.runId, ledger: firstLedger, tools: [] })
  const second = await assembler.assemble({ runId: secondLedger.runId, ledger: secondLedger, tools: [] })

  assert.equal(first.stablePrefixRevision, second.stablePrefixRevision)
  assert.notEqual(first.revision, second.revision)
  assert.match(second.messages.at(-1).content, /step 1/)
  assert.equal(second.regions.recent_dynamic_context[0].compressible, false)
})

test('AgentStepper sends an assembled context revision and preserves newest-message order', async () => {
  const contextAssembler = createLedgerContextAssembler(budget({
    maxInputTokens: 20_000,
    reservedOutputTokens: 4_000,
    regionTokens: {
      stable_system_prefix: 3_000,
      stable_capability_prefix: 6_000,
      compacted_history: 2_000,
      recent_dynamic_context: 8_000,
      newest_message: 1_000,
    },
  }))
  const provider = new FakeModelProvider([[
    { type: 'action', action: { kind: 'blocked', summary: 'Context captured', reason: 'fixture' } },
    { type: 'completed', finishReason: 'stop' },
  ]])
  const stepper = new AgentStepper({
    provider,
    contextAssembler,
    runtime: new FakeAgentRuntime(),
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'fixture' }),
    tools: [],
    clock: () => '2026-07-27T05:31:00.000Z',
  })
  const result = await stepper.step(ledger())
  const request = provider.requests[0]

  assert.equal(result.disposition, 'blocked')
  assert.equal(result.ledger.contextEnvelopes.length, 1)
  assert.equal(result.ledger.contextEnvelopes[0].revision, request.contextRevision)
  assert.equal(result.events.filter((event) => event.type === 'context.assembled').length, 1)
  assert.match(request.contextRevision, /^[a-f0-9]{64}$/)
  assert.match(request.messages.at(-1).content, /Select the next action/)
  assert.equal(request.turnId, 'run-context:step:1')
})

test('deterministic estimator is stable for ASCII and multibyte text', () => {
  const estimator = new DeterministicTokenEstimator()
  assert.equal(estimator.estimate(''), 0)
  assert.equal(estimator.estimate('1234'), 1)
  assert.equal(estimator.estimate('你好'), 2)
})
