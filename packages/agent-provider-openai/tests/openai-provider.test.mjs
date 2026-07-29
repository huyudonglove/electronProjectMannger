import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'

import {
  AgentStepper,
  FakePermissionPolicy,
  createRunLedger,
} from '@electron-manager/agent-core'
import {
  LocalAgentRuntime,
  computeActionDigest,
  localToolDefinitions,
} from '@electron-manager/agent-runtime-local'
import {
  AdaptiveOpenAIProvider,
  FetchOpenAIResponsesTransport,
  OpenAIChatCompletionsProvider,
  OpenAIResponsesProvider,
  clearAdaptiveOpenAIProtocolCache,
  createAgentTurnActionSchema,
  hydrateAgentTurnAction,
  parseServerSentEvents,
} from '../dist/index.js'

const exec = promisify(execFile)

class MockTransport {
  constructor(responses) {
    this.responses = [...responses]
    this.requests = []
  }

  async *stream(request, signal) {
    if (signal?.aborted) throw signal.reason
    this.requests.push(structuredClone(request))
    const response = this.responses.shift()
    if (!response) throw new Error('No mock OpenAI response queued')
    for (const event of response) {
      if (signal?.aborted) throw signal.reason
      if (event instanceof Error) throw event
      yield structuredClone(event)
    }
  }
}

function completed(action, usage = { input_tokens: 120, output_tokens: 40 }) {
  const json = JSON.stringify({ action })
  const middle = Math.ceil(json.length / 2)
  return [
    { type: 'response.output_text.delta', delta: json.slice(0, middle) },
    { type: 'response.output_text.delta', delta: json.slice(middle) },
    { type: 'response.completed', response: { usage } },
  ]
}

function modelRequest(overrides = {}) {
  return {
    runId: 'run-provider',
    turnId: 'run-provider:step:1',
    contextRevision: 'context-provider-1',
    messages: [
      { role: 'system', content: 'Select one action.' },
      { role: 'tool', toolRequestId: 'previous-1', content: '{"ok":true}' },
    ],
    tools: localToolDefinitions,
    maxOutputTokens: 2_000,
    ...overrides,
  }
}

async function collect(iterable) {
  const values = []
  for await (const value of iterable) values.push(value)
  return values
}

class ProtocolFixtureProvider {
  constructor(responses) {
    this.responses = [...responses]
    this.calls = 0
    this.profile = {
      id: 'openai:fixture', supportsToolCalls: true, supportsParallelToolCalls: false,
      supportsStructuredOutput: true, contextWindow: 128_000, maxOutputTokens: 16_000,
      promptCache: 'implicit',
    }
  }

  async *stream() {
    this.calls += 1
    yield* (this.responses.shift() || [])
  }
}

test('Responses Provider maps messages, strict schemas, usage and hydrated tool actions', async () => {
  const action = {
    kind: 'inspect',
    request: {
      id: 'read-1',
      name: 'read_file',
      input: { path: 'src/example.ts', startLine: null, endLine: null },
    },
  }
  const transport = new MockTransport([completed(action, {
    input_tokens: 120,
    output_tokens: 40,
    input_tokens_details: { cached_tokens: 80, cache_write_tokens: 10 },
    output_tokens_details: { reasoning_tokens: 12 },
  })])
  const diagnostics = []
  const provider = new OpenAIResponsesProvider({
    transport,
    model: 'gpt-test',
    providerId: 'fixture-responses',
    onDiagnostic: (entry) => diagnostics.push(entry),
    clock: () => '2026-07-26T14:00:00.000Z',
  })
  const events = await collect(provider.stream(modelRequest({
    promptCacheBinding: {
      capability: 'implicit',
      provider: 'openai',
      model: 'gpt-test',
      profileRevision: '1',
      cacheKey: 'cache-key-fixture',
    },
  })))

  assert.deepEqual(events.map((event) => event.type), ['text_delta', 'text_delta', 'usage', 'action', 'completed'])
  assert.equal(events[2].inputTokens, 120)
  assert.equal(events[2].cachedInputTokens, 80)
  assert.equal(events[2].cacheWriteTokens, 10)
  assert.equal(events[2].reasoningTokens, 12)
  assert.equal(provider.profile.promptCache, 'implicit')
  assert.equal(events[3].action.request.requestedAt, '2026-07-26T14:00:00.000Z')
  assert.deepEqual(events[3].action.request.input, { path: 'src/example.ts' })
  assert.equal(events[3].action.request.actionDigest, computeActionDigest('read_file', { path: 'src/example.ts' }))

  const sent = transport.requests[0]
  assert.equal(sent.model, 'gpt-test')
  assert.equal(sent.store, false)
  assert.equal(sent.text.format.type, 'json_schema')
  assert.equal(sent.text.format.strict, true)
  assert.equal(sent.text.format.schema.type, 'object')
  assert.equal(sent.input[0].content, 'Select one action.')
  assert.equal(sent.input.length, 2)
  assert.match(sent.input[1].content, /tool_result request_id=previous-1/)
  assert.doesNotMatch(sent.input.map((message) => message.content).join('\n'), /Available tools/)
  assert.deepEqual(diagnostics.map((entry) => entry.event), ['request.started', 'response.parsed'])
  assert.equal(diagnostics[0].providerId, 'fixture-responses')
  assert.equal(diagnostics[1].actionShape, 'responses-json-schema')
})

test('plan actions normalize a dependency-aware executable checklist', () => {
  const schema = createAgentTurnActionSchema(localToolDefinitions, ['plan'])
  assert.equal(schema.properties.action.anyOf.length, 1)
  const planBranch = schema.properties.action.anyOf.find((branch) => branch.properties?.kind?.const === 'plan')
  assert.ok(planBranch.required.includes('steps'))
  assert.equal(planBranch.properties.steps.items.additionalProperties, false)

  const action = hydrateAgentTurnAction({ action: {
    kind: 'plan',
    id: 'plan-1',
    summary: 'Modify and verify',
    rationale: 'The run requires a persisted checklist',
    steps: [
      { id: 'change-1', title: 'Modify the file', kind: 'change', dependsOn: [] },
      { id: 'verify-1', title: 'Run focused tests', kind: 'verify', dependsOn: ['change-1'] },
    ],
  } }, modelRequest(), { clock: () => '2026-07-26T14:00:00.000Z' })

  assert.equal(action.kind, 'plan')
  assert.equal(action.steps.length, 2)
  assert.deepEqual(action.steps[1].dependsOn, ['change-1'])
  assert.match(action.actionDigest, /^[a-f0-9]{64}$/)

  assert.throws(
    () => hydrateAgentTurnAction({ action: { kind: 'blocked', summary: 'No', reason: 'Wrong node' } }, modelRequest({ allowedActions: ['plan'] })),
    /not available in this graph node/,
  )
})

test('finish schema and hydration use one unambiguous action envelope', () => {
  const schema = createAgentTurnActionSchema(localToolDefinitions, ['finish'])
  assert.deepEqual(schema.required, ['action'])
  assert.match(schema.properties.action.description, /完整外形/)
  assert.equal(schema.properties.action.anyOf.length, 1)
  assert.equal(schema.properties.action.anyOf[0].properties.kind.const, 'finish')

  const action = hydrateAgentTurnAction({ action: {
    kind: 'finish',
    summary: 'Inspection complete',
    acceptanceEvidence: [{ criterionId: 'acceptance-001', summary: 'Status inspected', refs: ['inspect-status-001'] }],
    diff: null,
  } }, modelRequest({ allowedActions: ['finish'] }))

  assert.equal(action.kind, 'finish')
  assert.equal(action.diff, undefined)
  assert.deepEqual(action.acceptanceEvidence[0].refs, ['inspect-status-001'])
})

test('adaptive provider normalizes protocol fallback, caches support and never masks permission errors', async () => {
  clearAdaptiveOpenAIProtocolCache()
  const unsupported = { type: 'error', error: { code: 'MODEL_ERROR', message: 'Not found', retryable: false, details: { status: 404 } } }
  const permission = { type: 'error', error: { code: 'MODEL_ERROR', message: 'Forbidden', retryable: false, details: { status: 403 } } }
  const success = [
    { type: 'action', action: { kind: 'blocked', summary: 'Normalized', reason: 'fixture' } },
    { type: 'completed', finishReason: 'stop' },
  ]
  const responses = new ProtocolFixtureProvider([[unsupported]])
  const chat = new ProtocolFixtureProvider([success, success])
  const diagnostics = []
  const adaptive = new AdaptiveOpenAIProvider({
    responses, chatCompletions: chat, cacheKey: 'fixture:auto', model: 'fixture',
    onDiagnostic: (entry) => diagnostics.push(entry),
  })

  assert.equal((await collect(adaptive.stream(modelRequest())))[0].type, 'action')
  assert.equal((await collect(adaptive.stream(modelRequest())))[0].type, 'action')
  assert.equal(responses.calls, 1)
  assert.equal(chat.calls, 2)
  assert.deepEqual(diagnostics.map((entry) => entry.event), [
    'protocol.fallback', 'protocol.selected', 'protocol.selected',
  ])

  clearAdaptiveOpenAIProtocolCache()
  const deniedResponses = new ProtocolFixtureProvider([[permission]])
  const unusedChat = new ProtocolFixtureProvider([success])
  const denied = new AdaptiveOpenAIProvider({
    responses: deniedResponses, chatCompletions: unusedChat,
    cacheKey: 'fixture:permission', model: 'fixture',
  })
  const deniedEvents = await collect(denied.stream(modelRequest()))
  assert.equal(deniedEvents[0].error.details.status, 403)
  assert.equal(unusedChat.calls, 0)
})

test('Chat Completions Provider submits one structured action through a backend proxy', async () => {
  let captured
  const diagnostics = []
  const action = {
    action: {
      kind: 'inspect',
      request: {
        id: 'read-chat-1',
        name: 'read_file',
        input: { path: 'README.md', startLine: null, endLine: null },
      },
    },
  }
  const provider = new OpenAIChatCompletionsProvider({
    baseUrl: 'http://127.0.0.1:8787/provider/groq/',
    model: 'llama-fixture',
    providerId: 'sensenova',
    toolChoice: 'named',
    onDiagnostic: (entry) => diagnostics.push(entry),
    clock: () => '2026-07-27T15:00:00.000Z',
    fetcher: async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) }
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            tool_calls: [{
              id: 'call-fixture',
              type: 'function',
              function: { name: 'submit_agent_action', arguments: JSON.stringify({ action: JSON.stringify(action.action) }) },
            }],
          },
        }],
        usage: { prompt_tokens: 50, completion_tokens: 12 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
  })
  const events = await collect(provider.stream(modelRequest()))

  assert.equal(captured.url, 'http://127.0.0.1:8787/provider/groq/chat/completions')
  assert.equal(captured.init.headers.authorization, undefined)
  assert.equal(captured.body.tools[0].function.name, 'submit_agent_action')
  assert.match(captured.body.messages[0].content, /选择且只选择下一项 Agent 动作/)
  assert.match(captured.body.tools[0].function.description, /唯一的下一项动作/)
  assert.match(captured.body.tools[0].function.parameters.description, /当前 Run 阶段/)
  assert.deepEqual(captured.body.tool_choice, { type: 'function', function: { name: 'submit_agent_action' } })
  assert.deepEqual(events.map((event) => event.type), ['usage', 'action', 'completed'])
  assert.equal(events[1].action.request.requestedAt, '2026-07-27T15:00:00.000Z')
  assert.deepEqual(events[1].action.request.input, { path: 'README.md' })
  assert.deepEqual(diagnostics.map((entry) => entry.event), ['request.started', 'response.received', 'response.parsed'])
})

test('Chat Completions diagnostics only mark actions parsed after schema hydration', async () => {
  const diagnostics = []
  const provider = new OpenAIChatCompletionsProvider({
    baseUrl: 'http://127.0.0.1:8787/provider/sensenova/',
    model: 'sensenova-fixture',
    onDiagnostic: (entry) => diagnostics.push(entry),
    fetcher: async () => new Response(JSON.stringify({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          tool_calls: [{
            type: 'function',
            function: {
              name: 'submit_agent_action',
              arguments: JSON.stringify({ action: JSON.stringify({ request: {} }) }),
            },
          }],
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }),
  })

  const events = await collect(provider.stream(modelRequest()))

  assert.equal(events.at(-1).type, 'error')
  assert.match(events.at(-1).error.message, /action\.kind must be a non-empty string/)
  assert.deepEqual(diagnostics.map((entry) => entry.event), ['request.started', 'response.received', 'request.failed'])
})

test('malformed, unknown and incomplete model output becomes explicit stream errors', async () => {
  const malformed = new MockTransport([completed({ kind: 'mystery' })])
  const malformedEvents = await collect(new OpenAIResponsesProvider({ transport: malformed }).stream(modelRequest()))
  assert.equal(malformedEvents.at(-1).type, 'error')
  assert.equal(malformedEvents.at(-1).error.code, 'MODEL_ERROR')
  assert.match(malformedEvents.at(-1).error.message, /Unknown AgentTurnAction kind/)

  const incomplete = new MockTransport([[
    {
      type: 'response.incomplete',
      response: {
        usage: { input_tokens: 50, output_tokens: 10 },
        incomplete_details: { reason: 'max_output_tokens' },
      },
    },
  ]])
  const incompleteEvents = await collect(new OpenAIResponsesProvider({ transport: incomplete }).stream(modelRequest()))
  assert.deepEqual(incompleteEvents.map((event) => event.type), ['usage', 'error', 'completed'])
  assert.match(incompleteEvents[1].error.message, /max_output_tokens/)
  assert.equal(incompleteEvents[2].finishReason, 'length')
})

test('transport failures, missing terminal events and cancellation remain distinguishable', async () => {
  const failed = new MockTransport([[new Error('socket closed')]])
  const failedEvents = await collect(new OpenAIResponsesProvider({ transport: failed }).stream(modelRequest()))
  assert.equal(failedEvents[0].error.code, 'MODEL_ERROR')
  assert.match(failedEvents[0].error.message, /socket closed/)

  const missingTerminal = new MockTransport([[
    { type: 'response.output_text.delta', delta: '{"action":' },
  ]])
  const missingEvents = await collect(new OpenAIResponsesProvider({ transport: missingTerminal }).stream(modelRequest()))
  assert.equal(missingEvents.at(-1).type, 'error')
  assert.match(missingEvents.at(-1).error.message, /without a terminal/)

  const controller = new AbortController()
  controller.abort('user stop')
  const cancelledTransport = new MockTransport([])
  const cancelled = await collect(new OpenAIResponsesProvider({ transport: cancelledTransport }).stream(modelRequest(), controller.signal))
  assert.equal(cancelled[0].error.code, 'CANCELLED')
  assert.equal(cancelledTransport.requests.length, 0)

  const authentication = new MockTransport([[
    {
      type: 'response.failed',
      response: { error: { code: 'invalid_api_key', message: 'Invalid API key' } },
    },
  ]])
  const authenticationEvents = await collect(new OpenAIResponsesProvider({ transport: authentication }).stream(modelRequest()))
  assert.equal(authenticationEvents[0].error.retryable, false)
  assert.equal(authenticationEvents[0].error.details.modelErrorCategory, 'authentication')
})

test('SSE and fetch transport parse chunk boundaries and surface bounded HTTP errors', async () => {
  const wire = [
    'event: response.output_text.delta\n',
    'data: {"type":"response.output_text.delta","delta":"ok"}\n\n',
    'data: [DONE]\n\n',
  ]
  const parsed = await collect(parseServerSentEvents(wire))
  assert.deepEqual(parsed, [{ type: 'response.output_text.delta', delta: 'ok' }])

  let captured
  const fetcher = async (url, init) => {
    captured = { url, init }
    return new Response(wire.join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  const transport = new FetchOpenAIResponsesTransport({ apiKey: 'test-secret', fetcher, baseUrl: 'https://example.test/v1/' })
  const events = await collect(transport.stream({ model: 'gpt-test', input: [], max_output_tokens: 10, stream: true, store: false, text: { verbosity: 'low', format: { type: 'json_schema', name: 'x', strict: true, schema: { type: 'object' } } } }))
  assert.equal(events.length, 1)
  assert.equal(captured.url, 'https://example.test/v1/responses')
  assert.equal(captured.init.headers.authorization, 'Bearer test-secret')

  const errorTransport = new FetchOpenAIResponsesTransport({
    apiKey: 'test-secret',
    fetcher: async () => new Response('rate limited', { status: 429 }),
  })
  await assert.rejects(
    () => collect(errorTransport.stream({ model: 'gpt-test', input: [], max_output_tokens: 10, stream: true, store: false, text: { verbosity: 'low', format: { type: 'json_schema', name: 'x', strict: true, schema: { type: 'object' } } } })),
    (error) => error.code === 'MODEL_ERROR'
      && error.retryable === true
      && error.details.status === 429
      && error.details.modelErrorCategory === 'rate_limit',
  )
})

test('Provider, Stepper and Local Runtime complete a cross-file change without UI state', async () => {
  const root = await createAgentFixture()
  const turns = [
    completed({ kind: 'inspect', request: { id: 'read-1', name: 'read_file', input: { path: 'src/a.js', startLine: null, endLine: null } } }),
    completed({
      kind: 'tool',
      request: {
        id: 'patch-1',
        name: 'apply_patch',
        input: {
          operations: [
            { path: 'src/a.js', oldText: 'value = 1', newText: 'value = 10', expectedOccurrences: null, expectedHash: null },
            { path: 'src/b.js', oldText: 'value = 2', newText: 'value = 20', expectedOccurrences: null, expectedHash: null },
          ],
        },
      },
    }),
    completed({
      kind: 'verify',
      checkId: 'unit',
      request: { id: 'verify-1', name: 'exec_command', input: { command: 'npm', args: ['test'], cwd: null, timeoutMs: null } },
    }),
    completed({ kind: 'tool', request: { id: 'diff-1', name: 'git_diff', input: { paths: null } } }),
    completed({
      kind: 'finish',
      summary: 'Updated and verified both files',
      acceptanceEvidence: [{ criterionId: 'acceptance-1', summary: 'Patch and unit check passed', refs: ['patch-1', 'unit'] }],
      diff: { toolRequestId: 'diff-1', changedFiles: ['src/a.js', 'src/b.js'], summary: 'Two source files updated' },
    }),
  ]
  const transport = new MockTransport(turns)
  const provider = new OpenAIResponsesProvider({ transport, model: 'gpt-test' })
  const runtime = new LocalAgentRuntime(root, { timeoutMs: 45_000 })
  const stepper = new AgentStepper({
    provider,
    runtime,
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'fixture scope' }),
    tools: localToolDefinitions,
  })
  const ledger = createRunLedger({
    runId: 'run-e2e',
    projectRoot: root,
    goal: 'Update both fixture values',
    acceptanceCriteria: [{ id: 'acceptance-1', description: 'Both values and tests are updated' }],
    constraints: ['Preserve unrelated files'],
    workLevel: 'light',
    intent: 'change',
    verificationPlan: { checks: [{ id: 'unit', label: 'Fixture unit test', command: ['npm', 'test'] }] },
    limits: { maxSteps: 10, maxDurationMs: 60_000, maxInputTokens: 20_000, maxOutputTokens: 4_000, maxRepeatedFailures: 3 },
  }, new Date().toISOString())

  const result = await stepper.runUntilPause(ledger)
  assert.equal(result.disposition, 'completed', result.summary)
  assert.equal(result.ledger.status, 'completed')
  assert.deepEqual(result.ledger.changes.map((item) => item.path), ['src/a.js', 'src/b.js'])
  assert.equal(result.ledger.verifications[0].status, 'passed')
  assert.equal(result.ledger.diffSnapshot.changedFiles.length, 2)
  assert.match(await readFile(path.join(root, 'src', 'a.js'), 'utf8'), /value = 10/)
  assert.match(await readFile(path.join(root, 'src', 'b.js'), 'utf8'), /value = 20/)
  assert.equal(transport.requests.length, 5)
})

async function createAgentFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-provider-'))
  await mkdir(path.join(root, 'src'))
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
  return root
}
