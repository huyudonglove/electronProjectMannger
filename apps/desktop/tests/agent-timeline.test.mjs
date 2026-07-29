import assert from 'node:assert/strict'
import test from 'node:test'

import { buildAgentTimeline, humanizeAgentSummary } from '../renderer-src/agent-timeline.ts'

test('agent timeline merges low-signal events and file changes without hiding failures', () => {
  const timeline = buildAgentTimeline([
    event(1, 'run.started', 'Run started'),
    event(2, 'model.started', 'Model turn started'),
    event(3, 'tool.requested', 'Requested read_file', { requestId: 'read-1', tool: 'read_file' }),
    event(4, 'tool.completed', 'Read src/a.ts', { requestId: 'read-1', tool: 'read_file', ok: true }),
    event(5, 'tool.completed', 'Read src/b.ts', { requestId: 'read-2', tool: 'read_file', ok: true }),
    event(6, 'files.changed', '1 file changed', { paths: ['src/a.ts'] }),
    event(7, 'files.changed', '2 files changed', { paths: ['src/a.ts', 'src/b.ts'] }),
    event(8, 'model.rejected', 'response.action.kind must be a non-empty string'),
    event(9, 'verification.completed', 'Tests passed', { checkId: 'tests', passed: true }),
    event(10, 'run.completed', '实现完成'),
  ], ['src/c.ts'])

  assert.equal(timeline.activity.some((group) => group.event.type === 'model.started'), false)
  assert.equal(timeline.activity.some((group) => group.event.type === 'tool.requested'), false)
  assert.equal(timeline.activity.find((group) => group.event.payload?.tool === 'read_file')?.count, 2)
  assert.deepEqual(timeline.changedFiles, ['src/a.ts', 'src/b.ts', 'src/c.ts'])
  assert.equal(timeline.issues.length, 1)
  assert.equal(timeline.verifications.length, 1)
  assert.equal(timeline.terminal?.summary, '实现完成')
})

test('agent timeline groups repeated identical failures', () => {
  const timeline = buildAgentTimeline([
    event(1, 'tool.completed', 'Tests failed', { tool: 'exec_command', ok: false, errorCode: 'TOOL_EXECUTION_FAILED' }),
    event(2, 'verification.completed', 'Tests failed', { checkId: 'tests', passed: false }),
    event(3, 'run.failed', 'Run failed'),
  ])

  assert.equal(timeline.issues.length, 1)
  assert.equal(timeline.issues[0].count, 2)
  assert.equal(timeline.terminal?.type, 'run.failed')
})

test('agent timeline humanizes common runtime summaries', () => {
  assert.equal(humanizeAgentSummary('Run duration limit reached'), '运行时间已达到上限')
  assert.equal(humanizeAgentSummary('Ran npm test failed with exit code 1'), 'npm test 执行失败（退出码 1）')
})

function event(sequence, type, summary, payload) {
  return { sequence, type, summary, phase: 'acting', ...(payload ? { payload } : {}) }
}
