export type AgentIpcRiskLevel = 'low' | 'medium' | 'high'

export const AGENT_IPC = {
  getSettings: { channel: 'agent:settings:get', risk: 'low' },
  updateOpenAIModel: { channel: 'agent:settings:update-openai', risk: 'medium' },
  setModelCredential: { channel: 'agent:credential:set', risk: 'high' },
  deleteModelCredential: { channel: 'agent:credential:delete', risk: 'high' },
} as const satisfies Record<string, { channel: string; risk: AgentIpcRiskLevel }>
