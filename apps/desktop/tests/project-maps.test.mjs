import assert from 'node:assert/strict'
import test from 'node:test'

import { projectMapsView } from '../dist/project-maps.js'

test('task map groups persistent multi-round runs under their project task', () => {
  const codeMap = {
    revision: 'code-revision', generatedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    stats: { totalFiles: 4, analyzedFiles: 3, sourceFiles: 2, testFiles: 1, configFiles: 1, dependencyEdges: 2, exportedSymbols: 3, languages: { typescript: 3 } },
  }
  const task = { id: 'task-id', shortId: 'T001', title: '实现地图', status: 'doing' }
  const runs = [
    { runId: 'run-2', status: 'completed', task, updatedAt: '2026-01-02T00:00:00.000Z', stepCount: 4, eventSequence: 12, progress: { changedFiles: ['b.ts'], verificationPassed: 1, verificationFailed: 0 }, graph: { revision: 'graph-v1', currentNode: 'completed', historyCount: 7 }, checklist: { revision: 5, progress: { total: 2, done: 2 }, items: [{ id: 'change-1', title: '修改', kind: 'change', status: 'done', attempt: 1 }] }, diff: { summary: '第二轮完成' }, diagnostics: { rejectedActions: 1, failedModelAttempts: 1, recentErrors: [{ sequence: 8, at: '2026-01-02T00:00:00.000Z', type: 'model.rejected', phase: 'acting', summary: '动作无效' }] } },
    { runId: 'run-1', status: 'blocked', task, updatedAt: '2026-01-01T00:00:00.000Z', stepCount: 2, eventSequence: 6, progress: { changedFiles: ['a.ts'], verificationPassed: 0, verificationFailed: 1 }, resume: { reason: '等待修复' } },
  ]

  const chats = [{
    id: 'chat-id', projectRoot: '/project', title: '独立咨询',
    createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z', messages: [],
  }]
  const result = projectMapsView(codeMap, { tasks: [task] }, chats, runs)
  assert.equal(result.taskMap.runCount, 2)
  assert.equal(result.taskMap.conversationCount, 1)
  assert.equal(result.taskMap.tasks[0].rounds.length, 2)
  assert.equal(result.taskMap.tasks[0].rounds[0].result, '第二轮完成')
  assert.equal(result.taskMap.tasks[0].rounds[1].result, '等待修复')
  assert.equal(result.taskMap.tasks[0].rounds[0].diagnostics.recentErrors[0].summary, '动作无效')
  assert.deepEqual(result.taskMap.tasks[0].rounds[0].checklist.progress, { total: 2, todo: 0, doing: 0, done: 2, blocked: 0, skipped: 0 })
  assert.equal(result.taskMap.tasks[0].rounds[0].graph.currentNode, 'completed')
})
