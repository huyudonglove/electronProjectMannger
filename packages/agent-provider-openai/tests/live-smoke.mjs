import {
  FetchOpenAIResponsesTransport,
  OpenAIResponsesProvider,
} from '../dist/index.js'

const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) {
  console.log('SKIP: OPENAI_API_KEY is not configured')
  process.exit(0)
}

const provider = new OpenAIResponsesProvider({
  transport: new FetchOpenAIResponsesTransport({ apiKey }),
  model: process.env.OPENAI_MODEL || 'gpt-5.6',
  maxOutputTokens: 1_000,
})
let action
for await (const event of provider.stream({
  runId: 'live-smoke',
  turnId: 'live-smoke:step:1',
  contextRevision: 'live-smoke-context-1',
  messages: [
    { role: 'system', content: 'Return exactly one structured action.' },
    { role: 'user', content: 'Return blocked because this smoke test intentionally provides no tools.' },
  ],
  tools: [],
  maxOutputTokens: 1_000,
})) {
  if (event.type === 'error') throw new Error(`${event.error.code}: ${event.error.message}`)
  if (event.type === 'action') action = event.action
}
if (!action) throw new Error('Live smoke completed without an action')
console.log(`PASS: received ${action.kind} from ${provider.profile.id}`)
