import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AgentStepper,
  FakeAgentRuntime,
  FakeModelProvider,
  FakePermissionPolicy,
  InMemoryCheckpointStore,
  PersistedRunCoordinator,
} from '@electron-manager/agent-core'
import {
  AgentConfigRegistry,
  DEFAULT_MEMORY_PROFILE,
  DEFAULT_PROMPT_PROFILE,
  DEFAULT_SLOT_POLICY,
  DEFAULT_TOOL_POLICY,
  DEFAULT_WORKFLOW_PROFILE,
  createBuiltinConfigLayer,
  resolveAgentConfig,
  toolInventoryFromRegistrySnapshot,
} from '../dist/index.js'

test('default prompt profile is sourced from the managed Chinese prompt catalog', () => {
  assert.equal(DEFAULT_PROMPT_PROFILE.revision, '4')
  assert.match(DEFAULT_PROMPT_PROFILE.systemTemplate, /编码 Agent/)
  assert.match(DEFAULT_PROMPT_PROFILE.developerTemplate, /\{\{workLevel\}\}/)
})

function fixture() {
  const model = {
    id: 'model.primary',
    revision: '3',
    provider: 'fixture',
    model: 'fixture-coder',
    credentialRef: 'credentials.fixture.primary',
    capabilities: {
      structuredOutput: true,
      toolCalls: true,
      contextWindow: 128_000,
      maxOutputTokens: 16_000,
      promptCache: 'implicit',
    },
  }
  const fallback = {
    ...model,
    id: 'model.fallback',
    revision: '2',
    model: 'fixture-coder-small',
  }
  const route = {
    id: 'route.coding',
    revision: '5',
    primaryProfileId: model.id,
    fallbackProfileIds: [fallback.id],
    requirements: {
      structuredOutput: true,
      toolCalls: true,
      minContextWindow: 64_000,
    },
    retry: {
      maxAttempts: 3,
      totalTimeoutMs: 180_000,
      totalTokenBudget: 30_000,
      retryableErrors: ['rate_limit', 'timeout'],
    },
  }
  const slots = [
    {
      id: 'memory.compression',
      category: 'memory',
      defaultEnabled: false,
      available: true,
      requires: [],
      conflictsWith: [],
    },
    {
      id: 'memory.cache',
      category: 'memory',
      defaultEnabled: false,
      available: true,
      requires: ['memory.compression'],
      conflictsWith: [],
    },
  ]
  return {
    catalog: {
      modelProfiles: [model, fallback],
      modelRoutes: [route],
      promptProfiles: [DEFAULT_PROMPT_PROFILE],
      workflowProfiles: [DEFAULT_WORKFLOW_PROFILE],
      toolPolicies: [DEFAULT_TOOL_POLICY],
      memoryProfiles: [DEFAULT_MEMORY_PROFILE],
      slotPolicies: [DEFAULT_SLOT_POLICY],
      slotDefinitions: slots,
    },
    toolInventory: {
      revision: 'registry-7',
      tools: [
        {
          name: 'read_file',
          descriptorRevision: 'read-v2',
          available: true,
          selectedBackend: 'node-native',
          availableBackendIds: ['node-native'],
        },
        {
          name: 'exec_command',
          descriptorRevision: 'exec-v4',
          available: false,
          availableBackendIds: [],
        },
      ],
    },
    layers: [createBuiltinConfigLayer(route.id, ['read_file'])],
  }
}

test('resolver applies fixed layer precedence and records field sources', () => {
  const setup = fixture()
  const result = resolveAgentConfig({
    workLevel: 'light',
    ...setup,
    layers: [
      ...setup.layers,
      {
        scope: 'project',
        revision: 'project-4',
        profileId: 'project.default',
        overrides: {
          workflowLimits: { maxSteps: 9 },
          slotSelections: { 'memory.compression': true },
        },
      },
      {
        scope: 'run',
        revision: 'run-2',
        overrides: { workflowLimits: { maxSteps: 7 } },
      },
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.config.workflow.limits.maxSteps, 7)
  assert.equal(result.config.prompt.variables.workLevel, 'light')
  assert.equal(result.config.slots.selections['memory.compression'], true)
  assert.deepEqual(result.config.tools.enabledToolNames, ['read_file'])
  assert.equal(result.config.sources['workflow.limits.maxSteps'].scope, 'run')
  assert.equal(result.config.sources['slots.selections.memory.compression'].profileId, 'project.default')
  assert.match(result.snapshot.revision, /^[a-f0-9]{64}$/)
  assert.equal(result.snapshot.data.toolInventory.enabled[0].descriptorRevision, 'read-v2')
  assert.equal(JSON.stringify(result.snapshot).includes('credentials.fixture.primary'), true)
  assert.equal(JSON.stringify(result.snapshot).includes('apiKey'), false)
})

test('snapshot revision is stable when input layer order changes', () => {
  const setup = fixture()
  const project = {
    scope: 'project',
    revision: 'project-1',
    overrides: { workflowLimits: { maxSteps: 8 } },
  }
  const first = resolveAgentConfig({ workLevel: 'standard', ...setup, layers: [...setup.layers, project] })
  const second = resolveAgentConfig({ workLevel: 'standard', ...setup, layers: [project, ...setup.layers] })

  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(first.snapshot.revision, second.snapshot.revision)
})

test('resolver returns field diagnostics before a run for incompatible resources', () => {
  const setup = fixture()
  setup.catalog.modelProfiles[0].capabilities.toolCalls = false
  setup.catalog.slotDefinitions.push({
    id: 'memory.legacy',
    category: 'memory',
    defaultEnabled: false,
    available: false,
    unavailableReason: 'Legacy adapter is not installed',
    requires: [],
    conflictsWith: ['memory.compression'],
  })
  const result = resolveAgentConfig({
    workLevel: 'deep',
    ...setup,
    layers: [
      ...setup.layers,
      {
        scope: 'run',
        revision: 'run-invalid',
        overrides: {
          enabledToolNames: ['exec_command'],
          slotSelections: { 'memory.cache': true, 'memory.legacy': true },
        },
      },
    ],
  })

  assert.equal(result.ok, false)
  const codes = new Set(result.issues.map((issue) => issue.code))
  assert.equal(codes.has('capability_mismatch'), true)
  assert.equal(codes.has('unavailable_tool'), true)
  assert.equal(codes.has('unavailable_slot'), true)
  assert.equal(codes.has('missing_dependency'), true)
})

test('resolver requires ordered warning, compact and hard-stop memory thresholds', () => {
  const setup = fixture()
  const invalidMemory = structuredClone(DEFAULT_MEMORY_PROFILE)
  invalidMemory.id = 'memory.invalid-thresholds'
  invalidMemory.compression.warningTokens = invalidMemory.compression.compactTokens
  setup.catalog.memoryProfiles = [invalidMemory]
  setup.layers[0].selections.memoryProfileId = invalidMemory.id

  const result = resolveAgentConfig({ workLevel: 'standard', ...setup })

  assert.equal(result.ok, false)
  assert.equal(result.issues.some((issue) => issue.path === 'memory.compression' && issue.code === 'invalid_value'), true)
})

test('prompt cache capability uses minimum semantics and validates every fallback', () => {
  const compatible = fixture()
  compatible.catalog.modelProfiles.forEach((model) => { model.capabilities.promptCache = 'explicit' })
  compatible.catalog.modelRoutes[0].requirements.promptCache = 'implicit'
  assert.equal(resolveAgentConfig({ workLevel: 'standard', ...compatible }).ok, true)

  const incompatible = fixture()
  incompatible.catalog.modelProfiles[1] = {
    ...incompatible.catalog.modelProfiles[1],
    capabilities: { ...incompatible.catalog.modelProfiles[1].capabilities, promptCache: 'none' },
  }
  const result = resolveAgentConfig({ workLevel: 'standard', ...incompatible })
  assert.equal(result.ok, false)
  assert.equal(result.issues.some((issue) => issue.path.endsWith('.capabilities.promptCache') && issue.code === 'capability_mismatch'), true)
})

test('resolved snapshot can be committed unchanged by PersistedRunCoordinator', async () => {
  const setup = fixture()
  const resolved = resolveAgentConfig({ workLevel: 'light', ...setup })
  assert.equal(resolved.ok, true)

  const stepper = new AgentStepper({
    provider: new FakeModelProvider([]),
    runtime: new FakeAgentRuntime(),
    permissionPolicy: new FakePermissionPolicy({ effect: 'allow', reason: 'fixture' }),
    tools: [],
  })
  const store = new InMemoryCheckpointStore()
  const coordinator = new PersistedRunCoordinator({ stepper, store })
  const checkpoint = await coordinator.create({
    runId: 'config-snapshot-run',
    projectRoot: '/workspace/project',
    goal: 'Persist config',
    acceptanceCriteria: [],
    constraints: [],
    workLevel: 'light',
    intent: 'analysis',
    verificationPlan: { checks: [] },
    limits: resolved.config.workflow.limits,
  }, { configSnapshot: resolved.snapshot })

  assert.equal(checkpoint.snapshot.configSnapshot.revision, resolved.snapshot.revision)
  assert.deepEqual(checkpoint.snapshot.configSnapshot.data, resolved.snapshot.data)
})

test('registry owns profile registration and tool snapshots adapt without runtime coupling', () => {
  const setup = fixture()
  const registry = new AgentConfigRegistry(setup.catalog)
  const copy = registry.catalog()
  copy.modelProfiles[0].model = 'mutated'

  assert.equal(registry.catalog().modelProfiles[0].model, 'fixture-coder')
  assert.throws(() => registry.registerModelProfile(setup.catalog.modelProfiles[0]), /Duplicate model profile/)

  const inventory = toolInventoryFromRegistrySnapshot({
    revision: 'registry-8',
    tools: [{
      name: 'read_file',
      descriptorRevision: 'descriptor-2',
      availability: {
        available: true,
        selectedBackend: 'node-native',
        backends: [
          { backendId: 'missing-cli', available: false },
          { backendId: 'node-native', available: true },
        ],
      },
    }],
  })
  assert.deepEqual(inventory.tools[0].availableBackendIds, ['node-native'])
})

test('snapshot drops undeclared runtime fields instead of persisting possible secrets', () => {
  const setup = fixture()
  setup.catalog.modelProfiles[0].apiKey = 'must-not-persist'
  setup.catalog.modelProfiles[0].headers = { authorization: 'must-not-persist' }
  const result = resolveAgentConfig({ workLevel: 'light', ...setup })

  assert.equal(result.ok, true)
  assert.equal(JSON.stringify(result.snapshot).includes('must-not-persist'), false)
})
