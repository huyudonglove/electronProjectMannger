import {
  DEFAULT_MEMORY_PROFILE,
  DEFAULT_PROMPT_PROFILE,
  DEFAULT_SLOT_POLICY,
  DEFAULT_TOOL_POLICY,
  DEFAULT_WORKFLOW_PROFILE,
  type AgentConfigCatalog,
  type ModelProfile,
  type ModelRoute,
} from '@electron-manager/agent-config'

import {
  DESKTOP_AGENT_SETTINGS_SCHEMA_VERSION,
  type DesktopAgentSettingsInput,
} from './types.js'

export const DEFAULT_DESKTOP_MODEL_PROFILE_ID = 'desktop.model.openai.default'
export const DEFAULT_DESKTOP_MODEL_ROUTE_ID = 'desktop.route.default'
export const DEFAULT_DESKTOP_CREDENTIAL_REF = 'credential.openai.default'

export const DEFAULT_LOCAL_AGENT_TOOLS = [
  'apply_patch',
  'create_file',
  'exec_command',
  'git_diff',
  'git_status',
  'list_files',
  'read_file',
  'search_text',
] as const

export function createDefaultDesktopAgentSettingsInput(): DesktopAgentSettingsInput {
  const model: ModelProfile = {
    id: DEFAULT_DESKTOP_MODEL_PROFILE_ID,
    revision: '1',
    provider: 'openai',
    model: 'gpt-5.6',
    credentialRef: DEFAULT_DESKTOP_CREDENTIAL_REF,
    capabilities: {
      structuredOutput: true,
      toolCalls: true,
      contextWindow: 1_050_000,
      maxOutputTokens: 128_000,
      promptCache: 'implicit',
    },
  }
  const route: ModelRoute = {
    id: DEFAULT_DESKTOP_MODEL_ROUTE_ID,
    revision: '1',
    primaryProfileId: model.id,
    fallbackProfileIds: [],
    requirements: {
      structuredOutput: true,
      toolCalls: true,
      minContextWindow: 32_000,
      minOutputTokens: 8_000,
      promptCache: 'implicit',
    },
    retry: {
      maxAttempts: 3,
      totalTimeoutMs: 180_000,
      totalTokenBudget: 120_000,
      retryableErrors: ['rate_limit', 'timeout', 'service_unavailable', 'transport', 'invalid_output'],
    },
  }
  const catalog: AgentConfigCatalog = {
    modelProfiles: [model],
    modelRoutes: [route],
    promptProfiles: [DEFAULT_PROMPT_PROFILE],
    workflowProfiles: [DEFAULT_WORKFLOW_PROFILE],
    toolPolicies: [DEFAULT_TOOL_POLICY],
    memoryProfiles: [DEFAULT_MEMORY_PROFILE],
    slotPolicies: [DEFAULT_SLOT_POLICY],
    slotDefinitions: [],
  }
  return {
    schemaVersion: DESKTOP_AGENT_SETTINGS_SCHEMA_VERSION,
    catalog,
    providerSettings: {
      [model.id]: { provider: 'openai', reasoningEffort: 'medium', verbosity: 'low' },
    },
    userLayer: {
      scope: 'user',
      revision: 'desktop-user-default-v1',
      selections: { modelRouteId: route.id },
    },
    projectLayers: {},
  }
}
