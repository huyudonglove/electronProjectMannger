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
  CachingTokenEstimator,
  DeterministicTokenEstimator,
  InMemoryPromptArtifactCache,
  assertAppendOnlyContext,
  createPromptCachePolicyTemplate,
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

test('project sources share one hard scope budget without consuming required run facts', async () => {
  const estimator = { estimate: (text) => Number(text) }
  const sources = baseSources([
    source('run-facts', 'recent_dynamic_context', [
      { id: 'run-facts-1', role: 'user', content: '7', sourceRefs: ['run:fact'], sequence: 1 },
    ], { scope: 'run', priority: 100, required: true, compressible: false, maxTokens: 20 }),
    source('project-memory-trusted', 'recent_dynamic_context', [
      { id: 'project-trusted-1', role: 'user', content: '6', sourceRefs: ['project:trusted'], sequence: 2 },
    ], { scope: 'project', priority: 75, required: false, maxTokens: 10 }),
    source('project-repo-map', 'recent_dynamic_context', [
      { id: 'project-repo-map-1', role: 'user', content: '5', sourceRefs: ['project:repo-map'], sequence: 3 },
    ], { scope: 'project', priority: 60, required: false, maxTokens: 10 }),
    source('project-memory-untrusted', 'recent_dynamic_context', [
      { id: 'project-untrusted-1', role: 'user', content: '4', sourceRefs: ['project:untrusted'], sequence: 4 },
    ], { scope: 'project', priority: 55, required: false, maxTokens: 10 }),
    source('newest', 'newest_message', [
      { id: 'newest-scope-budget', role: 'user', content: '2', sourceRefs: ['newest'], sequence: 5 },
    ], { priority: 100, compressible: false, maxTokens: 5 }),
  ]).map((item) => {
    if (item.descriptor.id === 'system' || item.descriptor.id === 'capabilities') {
      return { ...item, collect: async () => [{ id: `${item.descriptor.id}-scope`, role: 'system', content: '2', sourceRefs: [item.descriptor.id] }] }
    }
    return item
  })
  const envelope = await assemble(sources, {
    tokenEstimator: estimator,
    budget: budget({
      scopeTokens: { project: 10 },
      regionTokens: { ...budget().regionTokens, recent_dynamic_context: 100 },
    }),
  })

  assert.deepEqual(
    envelope.regions.recent_dynamic_context.map((entry) => entry.id),
    ['run-facts-1', 'project-trusted-1', 'project-untrusted-1'],
  )
  assert.equal(envelope.regions.recent_dynamic_context.find((entry) => entry.id === 'run-facts-1').required, true)
  assert.deepEqual(envelope.dropped, [{
    sourceId: 'project-repo-map',
    fragmentId: 'project-repo-map-1',
    estimatedTokens: 5,
    reason: 'scope_budget',
  }])
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

test('a compactor cannot remove protected context or move replacements outside compacted history', async () => {
  const sources = baseSources([
    source('history', 'recent_dynamic_context', [
      { id: 'protected-fact', role: 'user', content: 'Protected', sourceRefs: ['fact:1'], sequence: 1 },
    ], { required: true, compressible: false }),
    source('newest', 'newest_message', [
      { id: 'newest-1', role: 'user', content: 'Newest', sourceRefs: ['newest'], sequence: 2 },
    ], { priority: 100, compressible: false }),
  ])
  const assembler = new ContextAssembler({
    registry: new ContextSourceRegistry(sources),
    budget: budget(),
    compactor: {
      compact(input) {
        return {
          entries: input.entries.filter((entry) => entry.id !== 'protected-fact'),
          pressure: { level: 'compacted', beforeTokens: 10, afterTokens: 5 },
        }
      },
    },
  })

  await assert.rejects(
    assembler.assemble({ runId: 'run-context', ledger: ledger(), tools: [] }),
    (error) => error.code === 'INVALID_INPUT' && /protected context/.test(error.message),
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
  assert.match(second.messages.at(-1).content, /步骤：1/)
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
    promptCachePolicy: {
      mode: 'prefer',
      promptProfileRevision: 'prompt-v1',
      toolRegistryRevision: 'tools-v1',
      actionSchemaRevision: 'actions-v1',
      projectRulesRevision: 'rules-v1',
      privacyScopeRevision: 'scope-v1',
    },
    clock: () => '2026-07-27T05:31:00.000Z',
  })
  const result = await stepper.step(ledger())
  const request = provider.requests[0]

  assert.equal(result.disposition, 'blocked')
  assert.equal(result.ledger.contextEnvelopes.length, 1)
  assert.equal(result.ledger.contextEnvelopes[0].revision, request.contextRevision)
  assert.equal(result.events.filter((event) => event.type === 'context.assembled').length, 1)
  assert.match(request.contextRevision, /^[a-f0-9]{64}$/)
  assert.match(request.messages.at(-1).content, /当前阶段：inspecting；步骤：1/)
  assert.equal(request.turnId, 'run-context:step:1')
  assert.equal(request.promptCache.stablePrefixRevision, result.ledger.contextEnvelopes[0].stablePrefixRevision)
})

test('default ledger context keeps tool guidance compact and excludes operational telemetry', async () => {
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
  const envelope = await assembler.assemble({
    runId: 'run-context',
    ledger: ledger(),
    tools: [{
      name: 'read_file',
      description: 'Read a project file',
      risk: 'read',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false,
      },
    }],
  })
  const capability = envelope.messages.find((message) => message.content.startsWith('以下是当前可用工具及其风险信息：'))
  const facts = envelope.regions.recent_dynamic_context.find((entry) => entry.id.startsWith('run-facts-step-'))

  assert.match(capability.content, /read_file/)
  assert.doesNotMatch(capability.content, /inputSchema|properties/)
  assert.doesNotMatch(facts.content, /modelAttempts|compactions|contextEnvelopes/)
  assert.match(facts.content, /"successfulEvidenceRefs":\[\]/)
  assert.match(
    envelope.regions.stable_system_prefix.map((entry) => entry.content).join('\n'),
    /每个 standard 或 deep Run[\s\S]*即使任务只读也不得跳过计划门禁/,
  )
  assert.match(
    envelope.regions.stable_system_prefix.map((entry) => entry.content).join('\n'),
    /acceptanceEvidence\.refs[\s\S]*successfulEvidenceRefs/,
  )
})

test('deterministic estimator is stable for ASCII and multibyte text', () => {
  const estimator = new DeterministicTokenEstimator()
  assert.equal(estimator.estimate(''), 0)
  assert.equal(estimator.estimate('1234'), 1)
  assert.equal(estimator.estimate('你好'), 2)
})

test('local prompt artifacts and token estimates are bounded reusable caches', async () => {
  const artifacts = new InMemoryPromptArtifactCache(1)
  const sources = baseSources([
    source('newest', 'newest_message', [
      { id: 'newest-cache', role: 'user', content: 'Newest', sourceRefs: ['newest'], sequence: 1 },
    ], { compressible: false }),
  ])
  const assembler = new ContextAssembler({
    registry: new ContextSourceRegistry(sources),
    budget: budget(),
    artifactCache: artifacts,
  })
  const first = await assembler.assemble({ runId: 'run-context', ledger: ledger(), tools: [] })
  const second = await assembler.assemble({ runId: 'run-context', ledger: ledger(), tools: [] })

  assert.equal(first.localArtifactCacheHit, false)
  assert.equal(second.localArtifactCacheHit, true)
  assert.deepEqual(artifacts.stats(), { entries: 1, hits: 1, misses: 1 })

  let calls = 0
  const estimator = new CachingTokenEstimator({ estimate: (text) => { calls += 1; return text.length } }, 1)
  assert.equal(estimator.estimate('same'), 4)
  assert.equal(estimator.estimate('same'), 4)
  assert.equal(calls, 1)
  estimator.estimate('other')
  estimator.estimate('same')
  assert.equal(calls, 3)
})

test('MemoryProfile cache mode maps to a provider-independent policy template', () => {
  assert.deepEqual(createPromptCachePolicyTemplate({
    memory: { promptCache: { mode: 'explicit' } },
    promptProfileRevision: 'prompt-v1',
    toolRegistryRevision: 'tools-v2',
    actionSchemaRevision: 'actions-v3',
    projectRulesRevision: 'rules-v4',
    privacyScopeRevision: 'project-scope-v5',
  }), {
    mode: 'require_explicit',
    promptProfileRevision: 'prompt-v1',
    toolRegistryRevision: 'tools-v2',
    actionSchemaRevision: 'actions-v3',
    projectRulesRevision: 'rules-v4',
    privacyScopeRevision: 'project-scope-v5',
  })
})

test('a local artifact cache cannot replace the stable prefix with different content', async () => {
  const sources = baseSources([
    source('newest', 'newest_message', [
      { id: 'newest-poisoned', role: 'user', content: 'Newest', sourceRefs: ['newest'], sequence: 1 },
    ], { compressible: false }),
  ])
  const assembler = new ContextAssembler({
    registry: new ContextSourceRegistry(sources),
    budget: budget(),
    artifactCache: {
      get(revision) {
        return { revision, messages: [{ role: 'system', content: 'Poisoned prefix' }], estimatedTokens: 1 }
      },
      set() {},
    },
  })

  await assert.rejects(
    assembler.assemble({ runId: 'run-context', ledger: ledger(), tools: [] }),
    (error) => error.code === 'INVALID_INPUT' && /does not match/.test(error.message),
  )
})
