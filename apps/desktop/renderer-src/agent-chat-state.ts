export type AgentChatSelection =
  | { kind: 'task'; id: string }
  | { kind: 'chat'; id: string }
  | { kind: 'new' }

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const SELECTION_KEY_PREFIX = 'electron-manager:agent-chat:selection:'

export function loadAgentChatSelection(storage: StorageLike, projectId: string): AgentChatSelection | null {
  const key = selectionKey(projectId)
  if (!key) return null
  try {
    const value = JSON.parse(storage.getItem(key) || 'null') as unknown
    if (!value || typeof value !== 'object' || !('kind' in value)) return null
    if (value.kind === 'new') return { kind: 'new' }
    if ((value.kind === 'task' || value.kind === 'chat') && 'id' in value && typeof value.id === 'string' && value.id.trim()) {
      return { kind: value.kind, id: value.id }
    }
  } catch {
    storage.removeItem(key)
  }
  return null
}

export function saveAgentChatSelection(storage: StorageLike, projectId: string, selection: AgentChatSelection) {
  const key = selectionKey(projectId)
  if (!key) return
  storage.setItem(key, JSON.stringify(selection))
}

function selectionKey(projectId: string) {
  const normalized = String(projectId || '').trim()
  return normalized ? `${SELECTION_KEY_PREFIX}${encodeURIComponent(normalized)}` : ''
}
