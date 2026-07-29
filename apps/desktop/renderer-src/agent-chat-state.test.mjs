import assert from 'node:assert/strict'
import test from 'node:test'

import { loadAgentChatSelection, saveAgentChatSelection } from './agent-chat-state.ts'

function memoryStorage() {
  const values = new Map()
  return {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value) },
    removeItem(key) { values.delete(key) },
    values,
  }
}

test('agent chat selection persists independently for each project', () => {
  const storage = memoryStorage()
  saveAgentChatSelection(storage, 'project-001', { kind: 'task', id: 'task-009' })
  saveAgentChatSelection(storage, 'project-002', { kind: 'chat', id: 'chat-002' })

  assert.deepEqual(loadAgentChatSelection(storage, 'project-001'), { kind: 'task', id: 'task-009' })
  assert.deepEqual(loadAgentChatSelection(storage, 'project-002'), { kind: 'chat', id: 'chat-002' })
})

test('new-chat selection and malformed values restore safely', () => {
  const storage = memoryStorage()
  saveAgentChatSelection(storage, 'project-001', { kind: 'new' })
  assert.deepEqual(loadAgentChatSelection(storage, 'project-001'), { kind: 'new' })

  storage.setItem('electron-manager:agent-chat:selection:broken', '{')
  assert.equal(loadAgentChatSelection(storage, 'broken'), null)
  assert.equal(storage.getItem('electron-manager:agent-chat:selection:broken'), null)
})
