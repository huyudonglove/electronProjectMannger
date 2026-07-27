export type AgentIpcRiskLevel = 'low' | 'medium' | 'high'

export const AGENT_IPC = {
  getSettings: { channel: 'agent:settings:get', risk: 'low' },
  updateOpenAIModel: { channel: 'agent:settings:update-openai', risk: 'medium' },
  setModelCredential: { channel: 'agent:credential:set', risk: 'high' },
  deleteModelCredential: { channel: 'agent:credential:delete', risk: 'high' },
  listRuns: { channel: 'agent:runs:list', risk: 'low' },
  getRun: { channel: 'agent:runs:get', risk: 'low' },
  startTask: { channel: 'agent:runs:start-task', risk: 'medium' },
  advanceRun: { channel: 'agent:runs:advance', risk: 'high' },
  resolveApproval: { channel: 'agent:runs:resolve-approval', risk: 'high' },
  cancelRun: { channel: 'agent:runs:cancel', risk: 'medium' },
  readOutput: { channel: 'agent:runs:read-output', risk: 'low' },
  runChanged: { channel: 'agent:runs:changed', risk: 'low' },
} as const satisfies Record<string, { channel: string; risk: AgentIpcRiskLevel }>
