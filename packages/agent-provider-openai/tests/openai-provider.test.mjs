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
  FetchOpenAIResponsesTransport,
  OpenAIResponsesProvider,
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

test('Responses Provider maps messages, strict schemas, usage and hydrated tool actions', async () => {
  const action = {
    kind: 'inspect',
    request: {
      id: 'read-1',
      name: 'read_file',
      input: { path: 'src/example.ts', startLine: null, endLine: null },
    },
  }
  const transport = new MockTransport([completed(action)])
  const provider = new OpenAIResponsesProvider({
    transport,
    model: 'gpt-test',
    clock: () => '2026-07-26T14:00:00.000Z',
  })
  const events = await collect(provider.stream(modelRequest()))

  assert.deepEqual(events.map((event) => event.type), ['text_delta', 'text_delta', 'usage', 'action', 'completed'])
  assert.equal(events[2].inputTokens, 120)
  assert.equal(events[3].action.request.requestedAt, '2026-07-26T14:00:00.000Z')
  assert.deepEqual(events[3].action.request.input, { path: 'src/example.ts' })
  assert.equal(events[3].action.request.actionDigest, computeActionDigest('read_file', { path: 'src/example.ts' }))

  const sent = transport.requests[0]
  assert.equal(sent.model, 'gpt-test')
  assert.equal(sent.store, false)
  assert.equal(sent.text.format.type, 'json_schema')
  assert.equal(sent.text.format.strict, true)
  assert.equal(sent.text.format.schema.type, 'object')
  assert.match(sent.input.at(-1).content, /tool_result request_id=previous-1/)
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
    (error) => error.code === 'MODEL_ERROR' && error.retryable === true && error.details.status === 429,
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
