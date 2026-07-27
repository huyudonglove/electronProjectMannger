import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AgentStepper,
  FakeAgentRuntime,
  FakePermissionPolicy,
  createRunLedger,
} from '@electron-manager/agent-core'
import {
  ModelProviderRegistry,
  ModelRouter,
  createPromptCacheKey,
  normalizeProviderError,
} from '../dist/index.js'

class ScriptedProvider {
  constructor(id, responses, profile = {}) {
    this.responses = [...responses]
    this.requests = []
    this.profile = {
      id,
      supportsToolCalls: true,
      supportsParallelToolCalls: false,
      supportsStructuredOutput: true,
      contextWindow: 128_000,
      maxOutputTokens: 16_000,
      promptCache: 'implicit',
      ...profile,
    }
  }

  async *stream(request, signal) {
    if (signal?.aborted) throw signal.reason
    this.requests.push(structuredClone(request))
    const response = this.responses.shift()
    if (!response) throw new Error(`No response queued for ${this.profile.id}`)
    for (const event of response) {
      if (signal?.aborted) throw signal.reason
      if (event instanceof Error) throw event
      yield structuredClone(event)
    }
  }
}

class WaitingProvider extends ScriptedProvider {
  constructor(id) {
    super(id, [])
  }

  async *stream(request, signal) {
    this.requests.push(structuredClone(request))
    await new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason)
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  }
}

function profile(id, overrides = {}) {
  return {
    id,
    revision: '1',
    provider: 'fixture',
    model: id,
    credentialRef: `credential.${id}`,
    capabilities: {
      structuredOutput: true,
      toolCalls: true,
      contextWindow: 128_000,
      maxOutputTokens: 16_000,
      promptCache: 'implicit',
    },
    ...overrides,
  }
}

function setup(options = {}) {
  const primaryProfile = profile('model.primary')
  const fallbackProfile = profile('model.fallback')
  const primary = options.primary || new ScriptedProvider('provider-primary', [])
  const fallback = options.fallback || new ScriptedProvider('provider-fallback', [])
  const route = {
    route: {
      id: 'route.coding',
      revision: '4',
      primaryProfileId: primaryProfile.id,
      fallbackProfileIds: [fallbackProfile.id],
      requirements: { structuredOutput: true, toolCalls: true, minContextWindow: 64_000 },
      retry: {
        maxAttempts: options.maxAttempts || 2,
        totalTimeoutMs: options.totalTimeoutMs || 60_000,
        totalTokenBudget: options.totalTokenBudget || 20_000,
        retryableErrors: options.retryableErrors || ['rate_limit', 'timeout', 'service_unavailable', 'transport', 'invalid_output'],
      },
    },
    primary: primaryProfile,
    fallbacks: [fallbackProfile],
  }
  const registry = new ModelProviderRegistry([
    { profile: primaryProfile, provider: primary },
    { profile: fallbackProfile, provider: fallback },
  ])
  return { route, registry, primary, fallback }
}

function request() {
  return {
    runId: 'run-router',
    turnId: 'run-router:step:1',
    contextRevision: 'context-router-1',
    messages: [{ role: 'user', content: 'Choose one action' }],
    tools: [],
    maxOutputTokens: 4_000,
    promptCache: {
      mode: 'prefer',
      stablePrefixRevision: 'stable-prefix-v1',
      promptProfileRevision: 'prompt-v1',
      toolRegistryRevision: 'tools-v1',
      actionSchemaRevision: 'actions-v1',
      projectRulesRevision: 'rules-v1',
      privacyScopeRevision: 'scope-v1',
    },
  }
}

function blocked(summary = 'Done') {
  return { kind: 'blocked', summary, reason: 'fixture' }
}

function completed(action = blocked()) {
  return [
    { type: 'usage', inputTokens: 100, outputTokens: 20, cachedInputTokens: 60, cacheWriteTokens: 10, reasoningTokens: 4 },
    { type: 'action', action },
    { type: 'completed', finishReason: 'stop' },
  ]
}

function rateLimited() {
  return [
    { type: 'text_delta', text: 'discarded partial output' },
    { type: 'usage', inputTokens: 40, outputTokens: 5, cachedInputTokens: 20, reasoningTokens: 2 },
    {
      type: 'error',
      error: {
        code: 'MODEL_ERROR',
        message: 'Rate limited',
        retryable: true,
        details: { status: 429 },
      },
    },
  ]
}

async function collect(iterable) {
  const events = []
  for await (const event of iterable) events.push(event)
  return events
}

test('router suppresses failed partial output, records attempts and falls back in order', async () => {
  const primary = new ScriptedProvider('provider-primary', [rateLimited()])
  const fallback = new ScriptedProvider('provider-fallback', [completed(blocked('Fallback completed'))])
  const fixture = setup({ primary, fallback })
  const router = new ModelRouter({ route: fixture.route, registry: fixture.registry })
  const events = await collect(router.stream(request()))

  assert.deepEqual(events.map((event) => event.type), [
    'model_attempt',
    'model_attempt',
    'usage',
    'action',
    'completed',
  ])
  assert.equal(events[0].attempt.profileId, 'model.primary')
  assert.equal(events[0].attempt.error.category, 'rate_limit')
  assert.equal(events[1].attempt.profileId, 'model.fallback')
  assert.equal(events[1].attempt.acceptedAction, true)
  assert.deepEqual(events[2], {
    type: 'usage',
    inputTokens: 140,
    outputTokens: 25,
    cachedInputTokens: 80,
    cacheWriteTokens: 10,
    reasoningTokens: 6,
  })
  assert.equal(events.some((event) => event.type === 'text_delta'), false)
  assert.equal(primary.requests.length, 1)
  assert.equal(fallback.requests.length, 1)
  assert.equal(primary.requests[0].contextRevision, 'context-router-1')
  assert.equal(fallback.requests[0].contextRevision, primary.requests[0].contextRevision)
  assert.notEqual(primary.requests[0].promptCacheBinding.cacheKey, fallback.requests[0].promptCacheBinding.cacheKey)
  assert.equal(events[0].attempt.cachedInputTokens, 20)
  assert.equal(events[1].attempt.cachedInputTokens, 60)
  assert.equal(events[1].attempt.cacheCapability, 'implicit')
  assert.equal(events[0].attempt.contextRevision, 'context-router-1')
  assert.equal(events[1].attempt.contextRevision, 'context-router-1')
})

test('prompt cache keys isolate provider, credential and privacy scope deterministically', () => {
  const { registry } = setup()
  const binding = registry.resolve('model.primary')
  const base = request().promptCache
  const first = createPromptCacheKey(base, binding)
  const same = createPromptCacheKey(structuredClone(base), binding)
  const otherScope = createPromptCacheKey({ ...base, privacyScopeRevision: 'scope-v2' }, binding)
  const otherCredential = createPromptCacheKey(base, {
    ...binding,
    profile: { ...binding.profile, credentialRef: 'credential.other' },
  })

  assert.equal(first, same)
  assert.match(first, /^[a-f0-9]{64}$/)
  assert.notEqual(first, otherScope)
  assert.notEqual(first, otherCredential)
})

test('explicit cache requirements fail before invoking an incompatible provider', async () => {
  const fixture = setup({ primary: new ScriptedProvider('provider-primary', [completed()]) })
  const router = new ModelRouter({ route: fixture.route, registry: fixture.registry })
  const explicit = request()
  explicit.promptCache.mode = 'require_explicit'
  const events = await collect(router.stream(explicit))

  assert.deepEqual(events.map((event) => event.type), ['error'])
  assert.equal(events[0].error.details.modelErrorCategory, 'capability_mismatch')
  assert.equal(fixture.primary.requests.length, 0)
})

test('a stronger explicit provider receives an explicit cache binding for a preferred policy', async () => {
  const primary = new ScriptedProvider('provider-primary', [completed()], { promptCache: 'explicit' })
  const fixture = setup({ primary })
  const events = await collect(new ModelRouter({ route: fixture.route, registry: fixture.registry }).stream(request()))

  assert.equal(events.some((event) => event.type === 'action'), true)
  assert.equal(primary.requests[0].promptCacheBinding.capability, 'explicit')
  assert.match(primary.requests[0].promptCacheBinding.cacheKey, /^[a-f0-9]{64}$/)
})

test('preferred caching degrades to none without changing provider semantics', async () => {
  const noCacheProfile = profile('model.no-cache', {
    capabilities: {
      structuredOutput: true,
      toolCalls: true,
      contextWindow: 128_000,
      maxOutputTokens: 16_000,
      promptCache: 'none',
    },
  })
  const provider = new ScriptedProvider('provider-no-cache', [completed()], { promptCache: 'none' })
  const registry = new ModelProviderRegistry([{ profile: noCacheProfile, provider }])
  const route = {
    route: {
      id: 'route.no-cache',
      revision: '1',
      primaryProfileId: noCacheProfile.id,
      fallbackProfileIds: [],
      requirements: { structuredOutput: true, toolCalls: true },
      retry: { maxAttempts: 1, totalTimeoutMs: 60_000, totalTokenBudget: 20_000, retryableErrors: [] },
    },
    primary: noCacheProfile,
    fallbacks: [],
  }
  const events = await collect(new ModelRouter({ route, registry }).stream(request()))

  assert.equal(events.some((event) => event.type === 'action'), true)
  assert.equal(provider.requests[0].promptCacheBinding.capability, 'none')
  assert.equal(provider.requests[0].promptCacheBinding.cacheKey, undefined)
})

test('an action is not exposed until its attempt reaches a valid terminal event', async () => {
  const primary = new ScriptedProvider('provider-primary', [[
    { type: 'action', action: blocked('Incomplete primary action') },
    { type: 'error', error: { code: 'MODEL_ERROR', message: 'socket closed', retryable: true } },
  ]])
  const fallback = new ScriptedProvider('provider-fallback', [completed(blocked('Safe fallback action'))])
  const fixture = setup({ primary, fallback })
  const events = await collect(new ModelRouter({ route: fixture.route, registry: fixture.registry }).stream(request()))

  const actions = events.filter((event) => event.type === 'action')
  assert.equal(actions.length, 1)
  assert.equal(actions[0].action.summary, 'Safe fallback action')
  assert.equal(events[0].attempt.acceptedAction, false)
  assert.equal(events[0].attempt.error.category, 'transport')
})

test('maxAttempts deterministically cycles the route so a single profile can be retried', async () => {
  const primary = new ScriptedProvider('provider-primary', [rateLimited(), completed(blocked('Primary recovered'))])
  const fallback = new ScriptedProvider('provider-fallback', [rateLimited()])
  const fixture = setup({ primary, fallback, maxAttempts: 3 })
  const events = await collect(new ModelRouter({ route: fixture.route, registry: fixture.registry }).stream(request()))

  assert.deepEqual(
    events.filter((event) => event.type === 'model_attempt').map((event) => event.attempt.profileId),
    ['model.primary', 'model.fallback', 'model.primary'],
  )
  assert.equal(events.find((event) => event.type === 'action').action.summary, 'Primary recovered')
  assert.equal(primary.requests.length, 2)
  assert.equal(fallback.requests.length, 1)
})

test('non-retryable authentication errors stop without touching fallback', async () => {
  const primary = new ScriptedProvider('provider-primary', [[{
    type: 'error',
    error: {
      code: 'MODEL_ERROR',
      message: 'Invalid API key',
      retryable: false,
      details: { status: 401 },
    },
  }]])
  const fallback = new ScriptedProvider('provider-fallback', [completed()])
  const fixture = setup({ primary, fallback, retryableErrors: ['authentication', 'rate_limit'] })
  const events = await collect(new ModelRouter({ route: fixture.route, registry: fixture.registry }).stream(request()))

  assert.deepEqual(events.map((event) => event.type), ['model_attempt', 'error'])
  assert.equal(events[1].error.details.modelErrorCategory, 'authentication')
  assert.equal(fallback.requests.length, 0)
})

test('cumulative token budget rejects a buffered action and prevents fallback', async () => {
  const primary = new ScriptedProvider('provider-primary', [completed()])
  const fallback = new ScriptedProvider('provider-fallback', [completed()])
  const fixture = setup({ primary, fallback, totalTokenBudget: 110 })
  const events = await collect(new ModelRouter({ route: fixture.route, registry: fixture.registry }).stream(request()))

  assert.deepEqual(events.map((event) => event.type), ['model_attempt', 'usage', 'error'])
  assert.equal(events[0].attempt.error.category, 'budget_exhausted')
  assert.equal(events[0].attempt.acceptedAction, false)
  assert.equal(events[2].error.code, 'CONTEXT_BUDGET_EXCEEDED')
  assert.equal(fallback.requests.length, 0)
})

test('route timeout aborts the active provider and does not start a late fallback', async () => {
  const primary = new WaitingProvider('provider-primary')
  const fallback = new ScriptedProvider('provider-fallback', [completed()])
  const fixture = setup({ primary, fallback, totalTimeoutMs: 15 })
  const events = await collect(new ModelRouter({ route: fixture.route, registry: fixture.registry }).stream(request()))

  assert.deepEqual(events.map((event) => event.type), ['model_attempt', 'error'])
  assert.equal(events[0].attempt.error.category, 'timeout')
  assert.equal(events[1].error.details.modelErrorCategory, 'timeout')
  assert.equal(fallback.requests.length, 0)
})

test('registry validates real capabilities and route snapshot remains stable and secret-free', () => {
  const declared = profile('model.only')
  const incompatible = new ScriptedProvider('provider-small', [], { contextWindow: 32_000 })
  assert.throws(() => new ModelProviderRegistry([{ profile: declared, provider: incompatible }]), /does not satisfy/)
  const explicitDeclared = profile('model.explicit', {
    capabilities: { ...declared.capabilities, promptCache: 'explicit' },
  })
  assert.throws(() => new ModelProviderRegistry([{
    profile: explicitDeclared,
    provider: new ScriptedProvider('provider-implicit', []),
  }]), /does not satisfy/)
  assert.doesNotThrow(() => new ModelProviderRegistry([{
    profile: declared,
    provider: new ScriptedProvider('provider-explicit', [], { promptCache: 'explicit' }),
  }]))

  const fixture = setup()
  fixture.route.primary.apiKey = 'must-not-persist'
  const first = new ModelRouter({ route: fixture.route, registry: fixture.registry }).snapshot()
  const second = new ModelRouter({ route: fixture.route, registry: fixture.registry }).snapshot()
  assert.equal(first.revision, second.revision)
  assert.match(first.revision, /^[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(first).includes('must-not-persist'), false)
  assert.equal(first.data.route.primaryProfileId, 'model.primary')
})

test('AgentStepper persists router attempts as RunLedger facts and events', async () => {
  const primary = new ScriptedProvider('provider-primary', [rateLimited()])
  const fallback = new ScriptedProvider('provider-fallback', [completed(blocked('No more work'))])
  const fixture = setup({ primary, fallback })
  const router = new ModelRouter({ route: fixture.route, registry: fixture.registry })
  const stepper = new AgentStepper({
    provider: router,
    runtime: new FakeAgentRuntime(),
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'fixture' }),
    tools: [],
    clock: () => '2026-07-27T05:30:00.000Z',
  })
  const ledger = createRunLedger({
    runId: 'run-router-ledger',
    projectRoot: '/workspace/project',
    goal: 'Record model attempts',
    acceptanceCriteria: [],
    constraints: [],
    workLevel: 'light',
    intent: 'analysis',
    verificationPlan: { checks: [] },
    limits: {
      maxSteps: 4,
      maxDurationMs: 60_000,
      maxInputTokens: 20_000,
      maxOutputTokens: 4_000,
      maxRepeatedFailures: 2,
    },
  }, '2026-07-27T05:29:00.000Z')
  const result = await stepper.step(ledger)

  assert.equal(result.disposition, 'blocked')
  assert.equal(result.ledger.modelAttempts.length, 2)
  assert.deepEqual(result.ledger.modelAttempts.map((attempt) => attempt.outcome), ['failed', 'succeeded'])
  assert.equal(result.events.filter((event) => event.type === 'model.attempted').length, 2)
  assert.match(result.ledger.modelAttempts[0].id, /step:1:route\.coding:attempt:1$/)
})

test('provider errors normalize stable categories from hints, status and messages', () => {
  assert.equal(normalizeProviderError({
    code: 'MODEL_ERROR',
    message: 'custom',
    retryable: false,
    details: { modelErrorCategory: 'service_unavailable' },
  }).category, 'service_unavailable')
  assert.equal(normalizeProviderError({ code: 'MODEL_ERROR', message: 'request timed out', retryable: false }).category, 'timeout')
  assert.equal(normalizeProviderError({ code: 'MODEL_ERROR', message: 'bad', retryable: false, details: { status: 403 } }).category, 'permission')
})
