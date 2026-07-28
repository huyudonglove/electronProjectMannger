import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { AgentChatService, projectOverview } from '../dist/agent-chat-service.js'
import { AgentChatStore } from '../dist/agent-chat-store.js'
import { ModelDiagnosticLog, modelDiagnosticProjectKey } from '../dist/model-diagnostics.js'

test('project overview exposes bounded status summaries without source contents', () => {
  const overview = projectOverview({
    config: { name: 'Demo' },
    currentVersion: { shortId: 'V002', label: 'v0.2', title: 'Chat', status: 'active', goal: '可用', summary: '' },
    activeTasks: [{ shortId: 'T009', title: '完成 Chatbot 会话', status: 'doing', priority: 'high', workLevel: 'standard', area: 'desktop', detail: '不得进入概览' }],
    activeResearch: [{ shortId: 'D003', title: '模型协议', status: 'pending', mode: 'depth', content: '不得进入概览' }],
    openQuestions: [{ shortId: 'Q002', title: '验收', question: '是否可以发布？', kind: 'decision', blocking: true, background: '不得进入概览' }],
    agentBrief: { activeRisks: [{ shortId: 'R001', title: '模型连接不稳定', kind: 'risk', status: 'open' }] },
    latestLogs: ['L010 完成基础路由'],
  })
  assert.equal(overview.activeTasks[0].shortId, 'T009')
  assert.equal(overview.activeRisks[0].shortId, 'R001')
  assert.equal('detail' in overview.activeTasks[0], false)
  assert.equal('content' in overview.activeResearch[0], false)
})

test('model diagnostics redact connection addresses and credentials from errors', async (context) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-diagnostics-'))
  context.after(() => rm(dataRoot, { recursive: true, force: true }))
  const diagnostics = new ModelDiagnosticLog(dataRoot)
  await diagnostics.append({
    at: new Date().toISOString(),
    level: 'error',
    event: 'route.attempt.failed',
    providerId: 'openai',
    model: 'test-model',
    runId: 'run:test',
    turnId: 'run:test:turn:1',
    error: 'POST https://models.example.test/v1 failed; apiKey=sk-secretvalue123',
  })

  const [entry] = await diagnostics.recent()
  assert.equal(entry.error.includes('models.example.test'), false)
  assert.equal(entry.error.includes('sk-secretvalue123'), false)
  assert.match(entry.error, /\[已隐藏连接地址\]/)
  assert.match(entry.error, /\[已隐藏密钥\]/)
})

test('model diagnostics are isolated by an irreversible project key', async (context) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-diagnostics-project-'))
  context.after(() => rm(dataRoot, { recursive: true, force: true }))
  const diagnostics = new ModelDiagnosticLog(dataRoot)
  const projectA = modelDiagnosticProjectKey('/projects/a')
  const projectB = modelDiagnosticProjectKey('/projects/b')
  for (const [projectKey, runId] of [[projectA, 'run:a'], [projectB, 'run:b']]) {
    await diagnostics.append({
      at: new Date().toISOString(),
      level: 'info',
      event: 'route.attempt.succeeded',
      providerId: 'openai',
      model: 'test-model',
      runId,
      turnId: `${runId}:turn:1`,
      projectKey,
    })
  }

  const entries = await diagnostics.recent(80, projectA)
  assert.deepEqual(entries.map((entry) => entry.runId), ['run:a'])
  assert.equal(entries[0].projectKey, projectA)
  assert.equal(JSON.stringify(entries).includes('/projects/'), false)
})

test('non-task chat uses a configured provider and survives store reload', async (context) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-chat-'))
  context.after(() => rm(dataRoot, { recursive: true, force: true }))
  const requests = []
  const provider = {
    profile: modelCapabilityProfile('openai:test-model'),
    async *stream(request) {
      requests.push(structuredClone(request))
      yield { type: 'action', action: { kind: 'finish', summary: `回答：${request.messages.at(-1).content}`, acceptanceEvidence: [] } }
      yield { type: 'completed', finishReason: 'stop' }
    },
  }
  const diagnostics = { entries: [], async append(entry) { this.entries.push(entry) } }
  const store = new AgentChatStore(dataRoot)
  const service = new AgentChatService({
    store,
    config: { async resolve() { return resolvedProviderFixture('profile.test', provider) } },
    diagnostics,
    async loadProjectOverview() {
      return {
        activeTasks: [{ shortId: 'T009', title: '完成 Chatbot 会话' }],
        activeRisks: [{ shortId: 'R001', title: '模型连接不稳定' }],
      }
    },
  })

  const first = await service.send({ projectRoot: dataRoot, message: '你好' })
  const second = await service.send({ projectRoot: dataRoot, conversationId: first.conversation.id, message: '再说一次' })
  assert.equal(second.conversation.messages.length, 4)
  assert.equal(requests.length, 2)
  assert.deepEqual(requests[1].tools, [])
  assert.equal(requests[1].messages.at(-2).content, '回答：你好')
  assert.match(requests[0].messages[0].content, /非任务咨询模式/)
  assert.match(requests[0].messages[1].content, /只读项目概览/)
  assert.match(requests[0].messages[1].content, /T009/)
  assert.match(requests[0].messages[1].content, /R001/)

  const reloaded = await new AgentChatStore(dataRoot).list(dataRoot)
  assert.equal(reloaded.length, 1)
  assert.deepEqual(reloaded[0].messages.map((message) => message.role), ['user', 'assistant', 'user', 'assistant'])
  assert.equal(diagnostics.entries.length, 2)
  assert.ok(diagnostics.entries.every((entry) => entry.event === 'route.attempt.succeeded'))
})

test('model errors are diagnosed while the user message remains persisted', async (context) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-chat-error-'))
  context.after(() => rm(dataRoot, { recursive: true, force: true }))
  const diagnostics = { entries: [], async append(entry) { this.entries.push(entry) } }
  const provider = {
    profile: modelCapabilityProfile('openai:broken-model'),
    async *stream() {
      yield { type: 'error', error: { code: 'MODEL_ERROR', message: 'service unavailable', retryable: true } }
    },
  }
  const store = new AgentChatStore(dataRoot)
  const service = new AgentChatService({
    store,
    config: { async resolve() { return resolvedProviderFixture('profile.broken', provider) } },
    diagnostics,
    async loadProjectOverview() { return { activeTasks: [], activeRisks: [] } },
  })

  await assert.rejects(service.send({ projectRoot: dataRoot, message: '普通咨询' }), /service unavailable/)
  const conversations = await store.list(dataRoot)
  assert.equal(conversations[0].messages.length, 1)
  assert.equal(conversations[0].messages[0].content, '普通咨询')
  assert.equal(diagnostics.entries[0].event, 'route.attempt.failed')
  assert.equal(diagnostics.entries[0].errorCategory, 'service_unavailable')
  assert.equal(diagnostics.entries[0].runId, `chat:${conversations[0].id}`)
})

test('chat diagnostics record primary failure and fallback success in route order', async (context) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-chat-fallback-'))
  context.after(() => rm(dataRoot, { recursive: true, force: true }))
  const diagnostics = { entries: [], async append(entry) { this.entries.push(entry) } }
  const primary = {
    profile: modelCapabilityProfile('openai:primary-model'),
    async *stream() {
      yield { type: 'error', error: { code: 'MODEL_ERROR', message: 'service unavailable', retryable: true } }
    },
  }
  const fallback = {
    profile: modelCapabilityProfile('openai:fallback-model'),
    async *stream() {
      yield { type: 'action', action: { kind: 'finish', summary: 'fallback answer', acceptanceEvidence: [] } }
      yield { type: 'completed', finishReason: 'stop' }
    },
  }
  const service = new AgentChatService({
    store: new AgentChatStore(dataRoot),
    config: {
      async resolve() {
        return resolvedRouteFixture([
          { profileId: 'profile.primary', provider: primary },
          { profileId: 'profile.fallback', provider: fallback },
        ])
      },
    },
    diagnostics,
    async loadProjectOverview() { return { activeTasks: [], activeRisks: [] } },
  })

  const result = await service.send({ projectRoot: dataRoot, message: '普通咨询' })
  assert.equal(result.conversation.messages.at(-1).content, 'fallback answer')
  assert.deepEqual(diagnostics.entries.map((entry) => ({
    routeId: entry.routeId,
    profileId: entry.profileId,
    attempt: entry.attempt,
    order: entry.order,
    result: entry.result,
    errorCategory: entry.errorCategory,
  })), [
    { routeId: 'route.fixture', profileId: 'profile.primary', attempt: 1, order: 1, result: 'failed', errorCategory: 'service_unavailable' },
    { routeId: 'route.fixture', profileId: 'profile.fallback', attempt: 2, order: 2, result: 'succeeded', errorCategory: undefined },
  ])
  assert.equal(JSON.stringify(diagnostics.entries).includes('baseUrl'), false)
  assert.equal(JSON.stringify(diagnostics.entries).includes('apiKey'), false)
})

test('chat does not fall back after a non-retryable authentication failure', async (context) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-chat-auth-'))
  context.after(() => rm(dataRoot, { recursive: true, force: true }))
  const diagnostics = { entries: [], async append(entry) { this.entries.push(entry) } }
  let primaryCalls = 0
  let fallbackCalls = 0
  const primary = {
    profile: modelCapabilityProfile('openai:primary-model'),
    async *stream() {
      primaryCalls += 1
      yield {
        type: 'error',
        error: {
          code: 'MODEL_ERROR',
          message: 'authentication failed',
          retryable: false,
          details: { modelErrorCategory: 'authentication' },
        },
      }
    },
  }
  const fallback = {
    profile: modelCapabilityProfile('openai:fallback-model'),
    async *stream() {
      fallbackCalls += 1
      yield { type: 'action', action: { kind: 'finish', summary: 'must not run', acceptanceEvidence: [] } }
      yield { type: 'completed', finishReason: 'stop' }
    },
  }
  const service = new AgentChatService({
    store: new AgentChatStore(dataRoot),
    config: {
      async resolve() {
        return resolvedRouteFixture([
          { profileId: 'profile.primary', provider: primary },
          { profileId: 'profile.fallback', provider: fallback },
        ], ['authentication', 'service_unavailable'])
      },
    },
    diagnostics,
    async loadProjectOverview() { return { activeTasks: [], activeRisks: [] } },
  })

  await assert.rejects(service.send({ projectRoot: dataRoot, message: '普通咨询' }), /authentication failed/)
  assert.equal(primaryCalls, 1)
  assert.equal(fallbackCalls, 0)
  assert.deepEqual(diagnostics.entries.map((entry) => ({
    profileId: entry.profileId,
    order: entry.order,
    result: entry.result,
    errorCategory: entry.errorCategory,
  })), [{ profileId: 'profile.primary', order: 1, result: 'failed', errorCategory: 'authentication' }])
})

function resolvedProviderFixture(profileId, provider) {
  return resolvedRouteFixture([{ profileId, provider }])
}

function resolvedRouteFixture(providers, retryableErrors = ['rate_limit', 'timeout', 'service_unavailable', 'transport', 'invalid_output']) {
  return {
    providers,
    layers: [{ scope: 'user', revision: 'fixture-user', selections: { modelRouteId: 'route.fixture' } }],
    catalog: {
      modelProfiles: providers.map(({ profileId, provider }) => ({
        id: profileId,
        revision: 'fixture-profile',
        provider: 'openai',
        model: provider.profile.id.replace(/^openai:/, ''),
        capabilities: {
          structuredOutput: true,
          toolCalls: true,
          contextWindow: 128_000,
          maxOutputTokens: 4_096,
          promptCache: 'implicit',
        },
      })),
      modelRoutes: [{
        id: 'route.fixture',
        revision: 'fixture-route',
        primaryProfileId: providers[0].profileId,
        fallbackProfileIds: providers.slice(1).map((registration) => registration.profileId),
        requirements: { structuredOutput: true, toolCalls: true },
        retry: {
          maxAttempts: providers.length,
          totalTimeoutMs: 60_000,
          totalTokenBudget: 20_000,
          retryableErrors,
        },
      }],
    },
  }
}

function modelCapabilityProfile(id) {
  return {
    id,
    supportsToolCalls: true,
    supportsParallelToolCalls: false,
    supportsStructuredOutput: true,
    contextWindow: 128_000,
    maxOutputTokens: 4_096,
    promptCache: 'implicit',
  }
}
