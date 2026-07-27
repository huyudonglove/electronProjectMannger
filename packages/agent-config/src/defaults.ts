import type { RunLimits } from '@electron-manager/agent-core'

import type {
  AgentConfigLayer,
  MemoryProfile,
  PromptProfile,
  SlotPolicyProfile,
  ToolPolicyProfile,
  WorkflowProfile,
} from './types.js'

export const DEFAULT_RUN_LIMITS: RunLimits = {
  maxSteps: 40,
  maxDurationMs: 30 * 60 * 1000,
  maxInputTokens: 100_000,
  maxOutputTokens: 8_000,
  maxRepeatedFailures: 3,
}

export const DEFAULT_PROMPT_PROFILE: PromptProfile = {
  id: 'builtin.prompt.default',
  revision: '1',
  systemTemplate: 'You are a coding agent working inside the configured project.',
  developerTemplate: 'Complete the task at the requested work level: {{workLevel}}.',
  variables: {
    workLevel: { required: true },
  },
}

export const DEFAULT_WORKFLOW_PROFILE: WorkflowProfile = {
  id: 'builtin.workflow.default',
  revision: '1',
  limits: DEFAULT_RUN_LIMITS,
  limitsByWorkLevel: {
    light: { maxSteps: 12, maxDurationMs: 10 * 60 * 1000 },
    standard: { maxSteps: 28, maxDurationMs: 20 * 60 * 1000 },
  },
  verification: {
    required: true,
    maxRepairAttempts: 2,
  },
}

export const DEFAULT_TOOL_POLICY: ToolPolicyProfile = {
  id: 'builtin.tools.default',
  revision: '1',
  enabledToolNames: [],
  backendPreferences: {},
}

export const DEFAULT_MEMORY_PROFILE: MemoryProfile = {
  id: 'builtin.memory.balanced',
  revision: '1',
  mode: 'balanced',
  sourceBudgets: {
    runFacts: 18_000,
    session: 12_000,
    project: 20_000,
    user: 5_000,
  },
  compression: {
    triggerTokens: 80_000,
    targetTokens: 50_000,
  },
  promptCache: {
    mode: 'implicit',
    stablePrefixRevision: '1',
  },
  allowLongTermUserMemoryWrite: false,
}

export const DEFAULT_SLOT_POLICY: SlotPolicyProfile = {
  id: 'builtin.slots.default',
  revision: '1',
  selections: {},
}

export function createBuiltinConfigLayer(modelRouteId: string, enabledToolNames: string[] = []): AgentConfigLayer {
  return {
    scope: 'built_in',
    revision: '1',
    selections: {
      modelRouteId,
      promptProfileId: DEFAULT_PROMPT_PROFILE.id,
      workflowProfileId: DEFAULT_WORKFLOW_PROFILE.id,
      toolPolicyId: DEFAULT_TOOL_POLICY.id,
      memoryProfileId: DEFAULT_MEMORY_PROFILE.id,
      slotPolicyId: DEFAULT_SLOT_POLICY.id,
    },
    overrides: {
      enabledToolNames,
    },
  }
}
