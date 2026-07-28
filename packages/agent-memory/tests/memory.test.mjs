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
import {
  DeterministicSessionCompactor,
  ModelBackedSessionCompactor,
  ProjectMemoryIndex,
  createProjectMemoryContextSources,
  sessionCompactionPolicyFromProfile,
} from '../dist/index.js'

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

test('project memory retrieval ranks metadata, path, tags and full text deterministically', () => {
  const index = new ProjectMemoryIndex([
    {
      id: 'memory-api',
      path: 'docs/api.md',
      title: 'Provider API contract',
      summary: 'Stable provider routing rules',
      tags: ['provider', 'routing'],
      scope: 'project',
      trust: 'trusted_project',
      updatedAt: '2026-07-27T10:00:00.000Z',
      content: 'ModelRoute fallback preserves the same context revision.',
      sourceRefs: ['document:W002'],
    },
    {
      id: 'memory-ui',
      path: 'docs/ui.md',
      title: 'Desktop layout',
      tags: ['renderer'],
      scope: 'project',
      trust: 'trusted_project',
      updatedAt: '2026-07-28T10:00:00.000Z',
      content: 'Sidebar layout and visual settings.',
    },
  ])

  const byText = index.search({ text: 'ModelRoute fallback provider' })
  const byPath = index.search({ paths: ['docs/api.md'] })
  const byTag = index.search({ tags: ['routing'] })

  assert.equal(byText[0].document.id, 'memory-api')
  assert.deepEqual(byText[0].matchedBy, ['full_text', 'metadata', 'tag'])
  assert.equal(byPath[0].document.id, 'memory-api')
  assert.deepEqual(byPath[0].matchedBy, ['path'])
  assert.equal(byTag[0].document.id, 'memory-api')
  assert.deepEqual(byTag[0].matchedBy, ['tag'])
})

test('project memory retrieval recalls unsegmented Chinese queries with deterministic bigrams', () => {
  const index = new ProjectMemoryIndex([
    {
      id: 'memory-routing-fallback',
      path: 'docs/model-routing.md',
      title: '模型路由与故障处理',
      summary: '主模型失败后的处理规则',
      tags: ['模型路由'],
      scope: 'project',
      trust: 'trusted_project',
      content: '主模型失败时，系统会按配置顺序回退到备用模型，并保持上下文版本。',
    },
    {
      id: 'memory-model-settings',
      path: 'docs/model-settings.md',
      title: '项目模型配置',
      tags: ['模型'],
      scope: 'project',
      trust: 'trusted_project',
      content: '设置页面可以修改默认模型名称。',
    },
  ])

  const first = index.search({ text: '模型失败后的顺序回退规则' })
  const second = index.search({ text: '模型失败后的顺序回退规则' })

  assert.equal(first[0].document.id, 'memory-routing-fallback')
  assert.deepEqual(first, second)
  assert.ok(first[0].matchedTerms.includes('模型'))
  assert.ok(first[0].matchedTerms.includes('顺序'))
  assert.ok(first[0].matchedTerms.includes('回退'))
  assert.deepEqual(first[0].matchedBy, ['full_text', 'metadata'])
  assert.ok(first[0].score > first[1].score)
})

test('project memory retrieval revisions are explicit and limited to legacy and current semantics', () => {
  const documents = [{
    id: 'memory-revision-boundary',
    path: 'docs/retrieval.md',
    title: '检索版本边界',
    tags: [],
    scope: 'project',
    trust: 'trusted_project',
    content: '模型失败时，按配置顺序回退。',
  }]
  const current = new ProjectMemoryIndex(documents)
  const legacy = new ProjectMemoryIndex(documents, { retrievalRevision: 'lexical-v1' })

  assert.equal(current.retrievalRevision, 'cjk-bigram-v1')
  assert.equal(legacy.retrievalRevision, 'lexical-v1')
  assert.equal(current.search({ text: '模型失败后的顺序回退规则' })[0].document.id, 'memory-revision-boundary')
  assert.deepEqual(legacy.search({ text: '模型失败后的顺序回退规则' }), [])
  assert.throws(
    () => new ProjectMemoryIndex(documents, { retrievalRevision: 'unsupported-v9' }),
    /Unsupported Project Memory retrieval revision/,
  )
})

test('project memory Chinese retrieval stays bounded for maximum-size document content', () => {
  const content = `主模型失败时按顺序回退到备用模型。${'背景说明'.repeat(130_000)}`.slice(0, 512_000)
  const index = new ProjectMemoryIndex([{
    id: 'memory-large-chinese',
    path: 'docs/large-memory.md',
    title: '大型项目记忆',
    tags: [],
    scope: 'project',
    trust: 'trusted_project',
    content,
  }])
  const longQuery = `模型失败后的顺序回退规则${'背景说明'.repeat(10_000)}`
  const matches = index.search({ text: longQuery })

  assert.equal(matches[0].document.id, 'memory-large-chinese')
  assert.ok(matches[0].matchedTerms.length <= 64)
})

test('project memory context keeps source references and separates trust labels', async () => {
  const index = new ProjectMemoryIndex([
    {
      id: 'trusted-routing',
      path: 'docs/routing.md',
      title: 'Routing rules',
      tags: ['routing'],
      scope: 'project',
      trust: 'trusted_project',
      content: 'Preserve ModelRoute revisions during fallback.',
      sourceRefs: ['document:W002'],
    },
    {
      id: 'repository-note',
      path: 'notes/routing.txt',
      title: 'Repository note',
      tags: ['routing'],
      scope: 'project',
      trust: 'untrusted',
      content: 'Unverified repository guidance about routing.',
      sourceRefs: ['repo:notes/routing.txt'],
    },
  ])
  const sources = createProjectMemoryContextSources(index, { maxTokens: 500, maxResults: 2 })
  const retrievalLedger = { ...ledger(), objective: 'Inspect ModelRoute routing rules' }
  const collected = await Promise.all(sources.map(async (item) => ({
    trust: item.descriptor.trust,
    fragments: await item.collect({ runId: 'run-memory', ledger: retrievalLedger, tools: [] }),
  })))
  const trusted = collected.find((item) => item.trust === 'trusted_project').fragments[0]
  const untrusted = collected.find((item) => item.trust === 'untrusted').fragments[0]

  assert.ok(trusted.sourceRefs.includes('project-memory:trusted-routing'))
  assert.ok(trusted.sourceRefs.includes('document:W002'))
  assert.ok(untrusted.sourceRefs.includes('repo:notes/routing.txt'))
  assert.ok(trusted.sequence < 999)
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

test('model-backed compaction uses only validated observations and preserves deterministic run facts', async () => {
  const diagnostics = []
  const compactor = new ModelBackedSessionCompactor({
    policy: policy(),
    tokenEstimator: estimator,
    summarizer: {
      async summarize(input) {
        return {
          routeId: 'route.summary',
          routeRevision: '2',
          attemptCount: 1,
          usage: { inputTokens: 40, outputTokens: 10 },
          summary: {
            ...input.deterministicSummary,
            objective: 'replace the real objective',
            knownFacts: ['invented fact'],
            observations: [{
              sourceId: 'summary.model',
              trust: 'trusted_run',
              sourceRefs: ['ref:old-tool-1'],
              excerpt: 'Condensed verified-looking observation',
            }],
          },
        }
      },
    },
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  })
  const result = await compactor.compact(input([
    entry('system', 'stable_system_prefix', 20),
    entry('run-facts', 'recent_dynamic_context', 30, { sequence: 1, compressible: false, required: true }),
    entry('old-tool-1', 'recent_dynamic_context', 70, { sequence: 2, trust: 'untrusted' }),
    entry('old-tool-2', 'recent_dynamic_context', 60, { sequence: 3 }),
    entry('newest', 'newest_message', 10, { sequence: 4, compressible: false }),
  ]))

  assert.equal(result.compaction.strategy, 'model')
  assert.equal(result.compaction.summary.objective, ledger().objective)
  assert.notDeepEqual(result.compaction.summary.knownFacts, ['invented fact'])
  assert.equal(result.compaction.summary.observations[0].trust, 'untrusted')
  assert.deepEqual(result.compaction.sourceRefs, ['ref:old-tool-1', 'ref:old-tool-2'])
  assert.equal(result.entries.some((item) => item.id === 'run-facts'), true)
  assert.deepEqual(diagnostics[0].usage, { inputTokens: 40, outputTokens: 10 })
  assert.equal(diagnostics[0].outcome, 'succeeded')
})

test('model-backed compaction deterministically falls back on summarizer failure', async () => {
  const compactor = new ModelBackedSessionCompactor({
    policy: policy(),
    tokenEstimator: estimator,
    summarizer: { summarize: async () => { throw new Error('summary route unavailable') } },
  })
  const result = await compactor.compact(input([
    entry('system', 'stable_system_prefix', 20),
    entry('old-1', 'recent_dynamic_context', 100, { sequence: 1 }),
    entry('old-2', 'recent_dynamic_context', 70, { sequence: 2 }),
    entry('newest', 'newest_message', 10, { sequence: 3, compressible: false }),
  ]))

  assert.equal(result.compaction.strategy, 'deterministic')
  assert.match(result.compaction.fallbackReason, /^summarizer_failed:summary route unavailable/)
  assert.equal(compactor.diagnostics()[0].outcome, 'fallback')
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
