export type AgentIpcRiskLevel = 'low' | 'medium' | 'high'

export const AGENT_IPC = {
  getSettings: { channel: 'agent:settings:get', risk: 'low' },
  getModelDiagnostics: { channel: 'agent:model-diagnostics:list', risk: 'low' },
  getProjectMaps: { channel: 'agent:project-maps:get', risk: 'low' },
  getDiagnosticReport: { channel: 'agent:diagnostics:report', risk: 'low' },
  listChats: { channel: 'agent:chats:list', risk: 'low' },
  sendChat: { channel: 'agent:chats:send', risk: 'medium' },
  updateOpenAIModel: { channel: 'agent:settings:update-openai', risk: 'medium' },
  updateProjectModelRoute: { channel: 'agent:settings:update-project-model-route', risk: 'medium' },
  listRuns: { channel: 'agent:runs:list', risk: 'low' },
  getRun: { channel: 'agent:runs:get', risk: 'low' },
  startTask: { channel: 'agent:runs:start-task', risk: 'medium' },
  advanceRun: { channel: 'agent:runs:advance', risk: 'high' },
  resolveApproval: { channel: 'agent:runs:resolve-approval', risk: 'high' },
  cancelRun: { channel: 'agent:runs:cancel', risk: 'medium' },
  readOutput: { channel: 'agent:runs:read-output', risk: 'low' },
  runChanged: { channel: 'agent:runs:changed', risk: 'low' },
  mapsChanged: { channel: 'agent:project-maps:changed', risk: 'low' },
} as const satisfies Record<string, { channel: string; risk: AgentIpcRiskLevel }>
