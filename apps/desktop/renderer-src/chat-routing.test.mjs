import test from 'node:test'
import assert from 'node:assert/strict'

import { inferAgentTaskIntent, routeAgentChatInput } from './chat-routing.ts'

const emptyContext = { hasActiveTask: false, hasResumableRun: false }

test('greetings and consultations route to non-task chat', () => {
  assert.equal(routeAgentChatInput('你好', emptyContext).kind, 'chat')
  assert.equal(routeAgentChatInput('还有啥没做的吗', emptyContext).kind, 'chat')
  assert.equal(routeAgentChatInput('支持哪些模型？', emptyContext).kind, 'chat')
})

test('explicit execution requests create appropriately-sized work', () => {
  assert.deepEqual(routeAgentChatInput('改下按钮文案', emptyContext), { kind: 'execute', workLevel: 'light' })
  assert.deepEqual(routeAgentChatInput('请帮我检查项目打包失败的问题', emptyContext), { kind: 'execute', workLevel: 'standard' })
  assert.deepEqual(routeAgentChatInput('检查当前项目根目录的 package.json，只读确认项目名称和可用脚本，不修改任何文件', emptyContext), {
    kind: 'execute',
    workLevel: 'light',
  })
  assert.deepEqual(routeAgentChatInput('调整权限边界并验证', emptyContext), {
    kind: 'execute',
    workLevel: 'deep',
    depthReason: 'security',
  })
})

test('short confirmations only resume a non-terminal selected run', () => {
  assert.deepEqual(routeAgentChatInput('继续', { hasActiveTask: true, hasResumableRun: true }), { kind: 'continue' })
  assert.equal(routeAgentChatInput('可以', { hasActiveTask: true, hasResumableRun: false }).kind, 'chat')
  assert.equal(routeAgentChatInput('继续', emptyContext).kind, 'chat')
})

test('explicit read-only tasks use analysis intent', () => {
  assert.equal(inferAgentTaskIntent('检查 package.json，只读确认脚本，不修改任何文件'), 'analysis')
  assert.equal(inferAgentTaskIntent('修复 package.json 的构建脚本'), 'change')
})
