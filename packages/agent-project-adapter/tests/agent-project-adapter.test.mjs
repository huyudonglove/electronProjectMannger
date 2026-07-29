import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createRunLedger } from '@electron-manager/agent-core'
import { appendTask, getDashboard, initProject, updateTaskStatus } from '@electron-manager/project-core'

import {
  applyPreparedProjectRunStart,
  applyProjectRunUpdatePlan,
  planProjectRunCompletion,
  planProjectRunSettlement,
  prepareProjectTaskRun,
} from '../dist/index.js'

test('project task maps deterministically to a headless run and doing update', () => {
  const dashboard = fixtureDashboard()
  const first = prepareProjectTaskRun(dashboard, {
    runId: 'run-1',
    taskId: 'T002',
    verificationPlan: {
      checks: [{ id: 'unit', label: 'Unit tests', command: ['pnpm', 'test'] }],
    },
  })
  const second = prepareProjectTaskRun(dashboard, {
    runId: 'run-1',
    taskId: 'task-2',
    verificationPlan: {
      checks: [{ id: 'unit', label: 'Unit tests', command: ['pnpm', 'test'] }],
    },
  })

  assert.equal(first.ok, true)
  assert.deepEqual(first, second)
  assert.equal(first.value.workLevel, 'deep')
  assert.equal(first.value.startUpdate.nextStatus, 'doing')
  assert.deepEqual(first.value.runInput.acceptanceCriteria.map((item) => item.description), ['One passes', 'Two passes'])
  assert.ok(first.value.runInput.constraints.some((item) => item.includes('[C001]')))
  assert.ok(first.value.runInput.constraints.every((item) => !item.includes('[SYS-')))
  assert.ok(first.value.runInput.constraints.every((item) => !item.includes('[project-instruction]')))
  assert.ok(first.value.sourceRefs.includes('chat:chat-1#message:message-1'))
  assert.equal(first.value.runInput.metadata.depthReason, 'architecture')
})

test('project run preparation rejects placeholders, inactive tasks and blocking questions', () => {
  const dashboard = fixtureDashboard()
  dashboard.tasks[0] = {
    ...dashboard.tasks[0],
    status: 'done',
    detail: '待补充。',
    acceptance: '待补充。',
    depthReason: '',
    constraints: '待补充。',
    planRollback: '待补充。',
  }
  dashboard.questions.push({
    id: 'question-1',
    shortId: 'Q001',
    displayId: 'Q001',
    title: 'Choose API',
    question: 'Which API?',
    background: '',
    recommendation: '',
    conclusion: '',
    status: 'open',
    kind: 'blocker',
    scope: 'version',
    version: 'V001',
    blocking: true,
    created: '',
    updated: '',
    relations: ['T002'],
    origin: 'user',
    messages: [],
  })

  const result = prepareProjectTaskRun(dashboard, { runId: 'run-1', taskId: 'T002' })
  assert.equal(result.ok, false)
  assert.deepEqual(new Set(result.issues.map((issue) => issue.code)), new Set([
    'TASK_NOT_ACTIVE',
    'MISSING_EXECUTION_DEFINITION',
    'DEEP_METADATA_MISSING',
    'MISSING_ACCEPTANCE',
    'BLOCKING_QUESTION',
  ]))
})

test('missing automated verification is explicit but does not invent a command', () => {
  const result = prepareProjectTaskRun(fixtureDashboard(), { runId: 'run-1', taskId: 'T002' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.runInput.verificationPlan.checks, [])
  assert.deepEqual(result.warnings.map((warning) => warning.code), ['VERIFICATION_NOT_CONFIGURED'])
})

test('analysis runs do not require the legacy change-verification acceptance item', () => {
  const dashboard = fixtureDashboard()
  dashboard.tasks[0].acceptance = '- 完成用户请求并说明结果。\n- 对实际改动执行合适的验证。\n- 如遇阻塞，明确说明原因和下一步。'
  const result = prepareProjectTaskRun(dashboard, { runId: 'run-analysis', taskId: 'T002', intent: 'analysis' })

  assert.equal(result.ok, true)
  assert.deepEqual(result.value.runInput.acceptanceCriteria.map((item) => item.required), [true, false, false])
  assert.deepEqual(result.value.runInput.verificationPlan.checks, [])
  assert.deepEqual(result.warnings, [])
})

test('completed ledger maps to one idempotent task and log update plan', () => {
  const dashboard = fixtureDashboard()
  const ledger = completedLedger(dashboard.tasks[0])
  const first = planProjectRunCompletion(dashboard, { taskId: 'T002', ledger })
  const second = planProjectRunCompletion(dashboard, { taskId: 'task-2', ledger })
  assert.equal(first.ok, true)
  assert.deepEqual(first, second)
  assert.equal(first.value.outcome, 'ready')
  assert.equal(first.value.taskStatusUpdate.nextStatus, 'done')
  assert.equal(first.value.log.source, 'agent-run:run-1')
  assert.equal(first.value.log.recordLevel, 'deep')
  assert.deepEqual(first.value.log.changedFiles, ['src/a.ts'])
  assert.deepEqual(first.value.log.outputRefs, ['output:diff', 'output:test'])

  dashboard.logs.push({
    shortId: 'L100',
    title: first.value.log.title,
    created: '',
    status: 'done',
    source: first.value.source,
    recordLevel: 'deep',
    version: 'V001',
    userGoal: '',
    result: '',
    decisions: [],
    changedFiles: [],
    verification: [],
    relatedTasks: [],
    content: '',
  })
  dashboard.tasks[0].status = 'done'
  const repeated = planProjectRunCompletion(dashboard, { taskId: 'T002', ledger })
  assert.equal(repeated.ok, true)
  assert.equal(repeated.value.outcome, 'already_applied')
  assert.equal(repeated.value.existingLogShortId, 'L100')
  assert.equal(repeated.value.log, undefined)
})

test('completion plan rejects unfinished or mismatched run facts', () => {
  const dashboard = fixtureDashboard()
  const ledger = completedLedger(dashboard.tasks[0])
  ledger.status = 'blocked'
  ledger.phase = 'blocked'
  ledger.taskId = 'another-task'
  ledger.workLevel = 'light'
  ledger.diffSnapshot = undefined
  const result = planProjectRunCompletion(dashboard, { taskId: 'T002', ledger })
  assert.equal(result.ok, false)
  assert.deepEqual(new Set(result.issues.map((issue) => issue.code)), new Set([
    'RUN_NOT_COMPLETED',
    'RUN_TASK_MISMATCH',
    'RUN_WORK_LEVEL_MISMATCH',
    'RUN_COMPLETION_INVALID',
  ]))
})

test('terminal non-completed run returns a doing task to todo and records changed files', () => {
  const dashboard = fixtureDashboard()
  dashboard.tasks[0].status = 'doing'
  const ledger = completedLedger(dashboard.tasks[0])
  ledger.status = 'blocked'
  ledger.phase = 'blocked'
  ledger.diffSnapshot = undefined
  ledger.nextAction = 'Resolve the blocking dependency'
  const result = planProjectRunSettlement(dashboard, { taskId: 'T002', ledger })
  assert.equal(result.ok, true)
  assert.equal(result.value.outcome, 'ready')
  assert.equal(result.value.taskStatusUpdate.nextStatus, 'todo')
  assert.equal(result.value.log.recordLevel, 'deep')
  assert.match(result.value.log.result.join('\n'), /任务已回到 todo/)
  assert.deepEqual(result.value.log.changedFiles, ['src/a.ts'])

  ledger.changes = []
  const noChanges = planProjectRunSettlement(dashboard, { taskId: 'T002', ledger })
  assert.equal(noChanges.ok, true)
  assert.equal(noChanges.value.outcome, 'ready')
  assert.equal(noChanges.value.taskStatusUpdate.nextStatus, 'todo')
  assert.equal(noChanges.value.log, undefined)
})

test('existing run log does not prevent recovery of a doing task', () => {
  const dashboard = fixtureDashboard()
  dashboard.tasks[0].status = 'doing'
  dashboard.logs.push({
    shortId: 'L100',
    title: 'Earlier failed run',
    created: '',
    status: 'done',
    source: 'agent-run:run-1',
    recordLevel: 'deep',
    version: 'V001',
    userGoal: '',
    result: '',
    decisions: [],
    changedFiles: [],
    verification: [],
    relatedTasks: [],
    content: '',
  })
  const ledger = completedLedger(dashboard.tasks[0])
  ledger.status = 'failed'
  ledger.phase = 'failed'
  ledger.changes = []
  ledger.diffSnapshot = undefined

  const result = planProjectRunSettlement(dashboard, { taskId: 'T002', ledger })
  assert.equal(result.ok, true)
  assert.equal(result.value.outcome, 'ready')
  assert.equal(result.value.taskStatusUpdate.nextStatus, 'todo')
  assert.equal(result.value.log, undefined)
  assert.equal(result.value.existingLogShortId, 'L100')
})

test('project run updates task and creates exactly one log across retries', async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'electron-manager-project-adapter-'))
  const managerDataRoot = path.join(fixtureRoot, 'manager')
  const projectRoot = path.join(fixtureRoot, 'project')
  await mkdir(projectRoot, { recursive: true })
  try {
    await initProject(managerDataRoot, projectRoot, 'adapter-fixture')
    let dashboard = await appendTask(managerDataRoot, projectRoot, {
      title: 'Connect project adapter',
      workLevel: 'standard',
      executionDefinition: 'Connect task state to a completed Agent Run.',
      acceptance: '- Task becomes done\n- Exactly one run log exists',
      constraints: '- Keep Markdown writes inside project-core',
    })
    const task = dashboard.tasks.find((item) => item.title === 'Connect project adapter')
    assert.ok(task)

    const prepared = prepareProjectTaskRun(dashboard, { runId: 'integration-run-1', taskId: task.shortId })
    assert.equal(prepared.ok, true)
    const started = await applyPreparedProjectRunStart(managerDataRoot, prepared.value)
    assert.equal(started?.taskUpdated, true)
    const doingTask = started.dashboard.tasks.find((item) => item.id === task.id)
    assert.equal(doingTask?.status, 'doing')

    const ledger = completedLedger(doingTask, projectRoot, 'integration-run-1')
    const completion = planProjectRunCompletion(started.dashboard, { taskId: task.id, ledger })
    assert.equal(completion.ok, true)
    assert.equal(completion.value.outcome, 'ready')

    const first = await applyProjectRunUpdatePlan(managerDataRoot, projectRoot, completion.value)
    const retry = await applyProjectRunUpdatePlan(managerDataRoot, projectRoot, completion.value)
    assert.equal(first.taskUpdated, true)
    assert.equal(first.logCreated, true)
    assert.equal(retry.applied, false)
    assert.equal(retry.taskUpdated, false)
    assert.equal(retry.logCreated, false)
    assert.equal(retry.logShortId, first.logShortId)

    dashboard = await getDashboard(managerDataRoot, projectRoot)
    assert.equal(dashboard.tasks.find((item) => item.id === task.id)?.status, 'done')
    const runLogs = dashboard.logs.filter((log) => log.source === 'agent-run:integration-run-1')
    assert.equal(runLogs.length, 1)
    assert.equal(runLogs[0].recordLevel, 'standard')
    assert.deepEqual(runLogs[0].relatedTasks.map((item) => item.shortId), [task.shortId])
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})

test('failed run without file changes returns its task to todo without creating a log', async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'electron-manager-project-adapter-failed-'))
  const managerDataRoot = path.join(fixtureRoot, 'manager')
  const projectRoot = path.join(fixtureRoot, 'project')
  await mkdir(projectRoot, { recursive: true })
  try {
    await initProject(managerDataRoot, projectRoot, 'adapter-failed-fixture')
    const dashboard = await appendTask(managerDataRoot, projectRoot, {
      title: 'Recover failed task',
      workLevel: 'standard',
      executionDefinition: 'Return a failed Agent Run task to todo.',
      acceptance: '- Failed task is retryable',
    })
    const task = dashboard.tasks.find((item) => item.title === 'Recover failed task')
    assert.ok(task)

    const prepared = prepareProjectTaskRun(dashboard, { runId: 'failed-run-1', taskId: task.id })
    assert.equal(prepared.ok, true)
    const started = await applyPreparedProjectRunStart(managerDataRoot, prepared.value)
    const doingTask = started.dashboard.tasks.find((item) => item.id === task.id)
    assert.equal(doingTask?.status, 'doing')

    const ledger = completedLedger(doingTask, projectRoot, 'failed-run-1')
    ledger.status = 'failed'
    ledger.phase = 'failed'
    ledger.changes = []
    ledger.diffSnapshot = undefined
    const settlement = planProjectRunSettlement(started.dashboard, { taskId: task.id, ledger })
    assert.equal(settlement.ok, true)
    assert.equal(settlement.value.outcome, 'ready')
    assert.equal(settlement.value.log, undefined)

    const applied = await applyProjectRunUpdatePlan(managerDataRoot, projectRoot, settlement.value)
    assert.equal(applied.taskUpdated, true)
    assert.equal(applied.logCreated, false)
    assert.equal(applied.dashboard.tasks.find((item) => item.id === task.id)?.status, 'todo')
    assert.equal(applied.dashboard.logs.filter((log) => log.source === 'agent-run:failed-run-1').length, 0)
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})

test('stale project task update fails instead of overwriting a newer status', async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'electron-manager-project-adapter-conflict-'))
  const managerDataRoot = path.join(fixtureRoot, 'manager')
  const projectRoot = path.join(fixtureRoot, 'project')
  await mkdir(projectRoot, { recursive: true })
  try {
    await initProject(managerDataRoot, projectRoot, 'adapter-conflict-fixture')
    const dashboard = await appendTask(managerDataRoot, projectRoot, {
      title: 'Protect task updates',
      workLevel: 'light',
      executionDefinition: 'Reject a stale Agent Run task transition.',
      acceptance: '- Newer state remains unchanged',
    })
    const task = dashboard.tasks.find((item) => item.title === 'Protect task updates')
    assert.ok(task)
    const prepared = prepareProjectTaskRun(dashboard, { runId: 'stale-run', taskId: task.id })
    assert.equal(prepared.ok, true)

    await updateTaskStatus(managerDataRoot, projectRoot, task.id, 'done')
    await assert.rejects(
      applyPreparedProjectRunStart(managerDataRoot, prepared.value),
      /任务已被其他操作更新/,
    )
    const latest = await getDashboard(managerDataRoot, projectRoot)
    assert.equal(latest.tasks.find((item) => item.id === task.id)?.status, 'done')
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true })
  }
})

function fixtureDashboard() {
  const task = {
    id: 'task-2',
    shortId: 'T002',
    title: 'Build feature',
    status: 'todo',
    priority: 'high',
    workLevel: 'deep',
    depthReason: 'architecture',
    area: 'agent',
    updated: '2026-07-27 17:00',
    version: 'V001',
    userOriginal: 'Build it',
    detail: 'Implement the feature without coupling modules.',
    acceptance: '- One passes\n- Two passes',
    constraints: '- Preserve existing work\n- Use focused tests',
    planRollback: 'Keep protocols and replace implementation.',
    sourceRefs: ['chat:chat-1#message:message-1'],
  }
  return {
    config: {
      projectId: 'project-1',
      name: 'fixture',
      projectRoot: '/fixture/project',
      dataRoot: '/fixture/data',
      createdAt: '',
      schemaVersion: 3,
      currentVersionId: 'V001',
    },
    tasks: [task],
    thoughts: [],
    dialogues: [],
    knowledge: [],
    documents: [],
    constraints: [{
      id: 'constraint-1',
      shortId: 'C001',
      title: 'Focused tests',
      status: 'active',
      scope: 'project',
      version: 'V001',
      source: 'user',
      created: '',
      updated: '2026-07-27 16:00',
      path: 'constraints.md',
      summary: 'Do not run full tests before completion.',
      content: '',
    }, {
      id: 'system-skill',
      shortId: 'SYS-SKILL',
      title: 'Collaboration skill',
      status: 'readonly',
      scope: 'system',
      version: 'V001',
      source: 'system',
      created: '',
      updated: '2026-07-27 16:00',
      path: 'SKILL.md',
      summary: 'Record file modifications.',
      content: '',
    }],
    logs: [],
    versions: [],
    currentVersion: {
      id: 'version-1',
      shortId: 'V001',
      label: 'v0.1',
      title: 'Current',
      status: 'active',
      created: '',
      completed: '',
      goal: '',
      summary: '',
      outcomes: [],
      followUps: [],
    },
    questions: [],
    risks: [],
    activeTasks: [task],
    activeResearch: [],
    openQuestions: [],
    latestLogs: [],
    agentBrief: {
      generatedAt: '',
      projectRoot: '/fixture/project',
      dataRoot: '/fixture/data',
      knowledgeRoot: '/fixture/knowledge',
      skillPath: '/fixture/data/SKILL.md',
      baselinePath: '/fixture/data/baseline.md',
      currentVersionRoot: '/fixture/data/V001',
      currentDataPaths: { tasks: '', thoughts: '', research: '', questions: '', risks: '', workLogs: '' },
      currentVersion: null,
      activeTasks: [task],
      activeResearch: [],
      openQuestions: [],
      pendingDecisions: [],
      activeRisks: [],
      latestLogs: [],
      instructions: ['Write one log for file changes.'],
    },
  }
}

function completedLedger(task, projectRoot = '/fixture/project', runId = 'run-1') {
  const ledger = createRunLedger({
    runId,
    projectRoot,
    goal: task.detail,
    acceptanceCriteria: [
      { id: 'acceptance-001', description: 'One passes', required: true },
      { id: 'acceptance-002', description: 'Two passes', required: true },
    ],
    constraints: [],
    workLevel: task.workLevel,
    intent: 'change',
    verificationPlan: { checks: [{ id: 'unit', label: 'Unit tests', required: true, command: ['pnpm', 'test'] }] },
    limits: { maxSteps: 10, maxDurationMs: 10_000, maxInputTokens: 10_000, maxOutputTokens: 1_000, maxRepeatedFailures: 2 },
    taskId: task.id,
    taskShortId: task.shortId,
  }, '2026-07-27T09:00:00.000Z')
  return {
    ...ledger,
    phase: 'completed',
    status: 'completed',
    updatedAt: '2026-07-27T09:05:00.000Z',
    changes: [{ path: 'src/a.ts', operation: 'modify', at: '2026-07-27T09:01:00.000Z' }],
    acceptanceEvidence: [
      { criterionId: 'acceptance-001', summary: 'One passed', passed: true, at: '2026-07-27T09:04:00.000Z', refs: ['unit'] },
      { criterionId: 'acceptance-002', summary: 'Two passed', passed: true, at: '2026-07-27T09:04:00.000Z', refs: ['unit'] },
    ],
    verifications: [{
      checkId: 'unit',
      status: 'passed',
      summary: 'Tests passed',
      startedAt: '2026-07-27T09:02:00.000Z',
      completedAt: '2026-07-27T09:03:00.000Z',
      exitCode: 0,
      outputRef: 'output:test',
    }],
    diffSnapshot: {
      capturedAt: '2026-07-27T09:04:00.000Z',
      changedFiles: ['src/a.ts'],
      summary: 'Updated src/a.ts',
      outputRef: 'output:diff',
    },
  }
}
