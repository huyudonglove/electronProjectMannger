import type { RunLimits } from '@electron-manager/agent-core'
import {
  DEFAULT_CODER_DEVELOPER_PROMPT,
  DEFAULT_CODER_SYSTEM_PROMPT,
} from '@electron-manager/agent-prompts'

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
  revision: DEFAULT_CODER_SYSTEM_PROMPT.revision,
  systemTemplate: DEFAULT_CODER_SYSTEM_PROMPT.text,
  developerTemplate: DEFAULT_CODER_DEVELOPER_PROMPT.text,
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
    warningTokens: 65_000,
    compactTokens: 75_000,
    targetTokens: 50_000,
    hardStopTokens: 92_000,
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
