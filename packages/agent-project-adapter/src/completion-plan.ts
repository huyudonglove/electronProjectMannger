import { evaluateCompletion } from '@electron-manager/agent-core'
import type { Dashboard, ProjectTask } from '@electron-manager/project-core'

import {
  PROJECT_ADAPTER_SCHEMA_VERSION,
  type ProjectAdapterIssue,
  type ProjectAdapterResult,
  type ProjectCompletionInput,
  type ProjectRunUpdatePlan,
  type ProjectLogDraft,
} from './types.js'
import { adapterIssue, deduplicate, findTask, stableKey } from './utils.js'

export function planProjectRunCompletion(
  dashboard: Dashboard,
  input: ProjectCompletionInput,
): ProjectAdapterResult<ProjectRunUpdatePlan> {
  return planSettlement(dashboard, input, true)
}

export function planProjectRunSettlement(
  dashboard: Dashboard,
  input: ProjectCompletionInput,
): ProjectAdapterResult<ProjectRunUpdatePlan> {
  return planSettlement(dashboard, input, false)
}

function planSettlement(
  dashboard: Dashboard,
  input: ProjectCompletionInput,
  requireCompleted: boolean,
): ProjectAdapterResult<ProjectRunUpdatePlan> {
  const task = findTask(dashboard, input.taskId)
  if (!task) {
    return { ok: false, issues: [adapterIssue('TASK_NOT_FOUND', 'taskId', `Project task does not exist: ${input.taskId}`)] }
  }
  const ledger = input.ledger
  const issues: ProjectAdapterIssue[] = []
  const terminal = ['completed', 'blocked', 'failed', 'cancelled'].includes(ledger.status)
  if (requireCompleted && (ledger.status !== 'completed' || ledger.phase !== 'completed')) {
    issues.push(adapterIssue('RUN_NOT_COMPLETED', 'ledger.status', `Only a completed run can produce a completion update: ${ledger.status}`))
  } else if (!requireCompleted && !terminal) {
    issues.push(adapterIssue('RUN_NOT_TERMINAL', 'ledger.status', `Only a terminal run can produce a settlement update: ${ledger.status}`))
  }
  if ((ledger.taskId && ledger.taskId !== task.id) || (ledger.taskShortId && ledger.taskShortId !== task.shortId)) {
    issues.push(adapterIssue('RUN_TASK_MISMATCH', 'ledger.taskId', 'Run task reference does not match the selected project task', [task.shortId]))
  }
  if (ledger.workLevel !== task.workLevel) {
    issues.push(adapterIssue(
      'RUN_WORK_LEVEL_MISMATCH',
      'ledger.workLevel',
      `Run work level ${ledger.workLevel} does not match task work level ${task.workLevel}`,
      [task.shortId],
    ))
  }
  const completion = requireCompleted || ledger.status === 'completed' ? evaluateCompletion(ledger) : undefined
  if (completion && !completion.eligible) {
    issues.push(adapterIssue(
      'RUN_COMPLETION_INVALID',
      'ledger',
      `Run completion facts are invalid: ${completion.blockers.map((blocker) => blocker.code).join(', ')}`,
      completion.blockers.flatMap((blocker) => blocker.ref ? [blocker.ref] : []),
    ))
  }
  if (issues.length) return { ok: false, issues }

  const source = `agent-run:${ledger.runId}`
  const idempotencyKey = stableKey([
    dashboard.config.projectId,
    task.id,
    ledger.runId,
    ledger.updatedAt,
    ledger.diffSnapshot?.outputRef || '',
  ])
  const taskStatusUpdate = settlementTaskStatusUpdate(task, ledger.status)
  const existing = dashboard.logs.find((log) => log.source === source)
  if (existing) {
    if (taskStatusUpdate) {
      return {
        ok: true,
        warnings: [],
        value: {
          schemaVersion: PROJECT_ADAPTER_SCHEMA_VERSION,
          outcome: 'ready',
          idempotencyKey,
          source,
          runId: ledger.runId,
          taskId: task.id,
          taskShortId: task.shortId,
          taskStatusUpdate,
          existingLogShortId: existing.shortId,
        },
      }
    }
    return {
      ok: true,
      warnings: [],
      value: {
        schemaVersion: PROJECT_ADAPTER_SCHEMA_VERSION,
        outcome: 'already_applied',
        idempotencyKey,
        source,
        runId: ledger.runId,
        taskId: task.id,
        taskShortId: task.shortId,
        existingLogShortId: existing.shortId,
      },
    }
  }

  if (ledger.status !== 'completed' && ledger.changes.length === 0 && !taskStatusUpdate) {
    return {
      ok: true,
      warnings: [],
      value: {
        schemaVersion: PROJECT_ADAPTER_SCHEMA_VERSION,
        outcome: 'not_required',
        idempotencyKey,
        source,
        runId: ledger.runId,
        taskId: task.id,
        taskShortId: task.shortId,
      },
    }
  }

  const plan: ProjectRunUpdatePlan = {
    schemaVersion: PROJECT_ADAPTER_SCHEMA_VERSION,
    outcome: 'ready',
    idempotencyKey,
    source,
    runId: ledger.runId,
    taskId: task.id,
    taskShortId: task.shortId,
    ...(taskStatusUpdate ? { taskStatusUpdate } : {}),
    ...(ledger.status !== 'completed' && ledger.changes.length === 0 ? {} : {
      log: completionLog(task, ledger, source),
    }),
  }
  return { ok: true, value: plan, warnings: [] }
}

function settlementTaskStatusUpdate(
  task: ProjectTask,
  runStatus: ProjectCompletionInput['ledger']['status'],
): ProjectRunUpdatePlan['taskStatusUpdate'] {
  const nextStatus = runStatus === 'completed'
    ? (task.status === 'done' ? undefined : 'done')
    : (task.status === 'doing' ? 'todo' : undefined)
  if (!nextStatus) return undefined
  return {
    taskId: task.id,
    taskShortId: task.shortId,
    expectedStatus: task.status,
    expectedUpdated: task.updated,
    nextStatus,
  }
}

function completionLog(task: ProjectTask, ledger: ProjectCompletionInput['ledger'], source: string): ProjectLogDraft {
  const checksById = new Map(ledger.verificationPlan.checks.map((check) => [check.id, check]))
  const verification = ledger.verifications.map((result) => {
    const label = checksById.get(result.checkId)?.label || result.checkId
    return `[${result.status}] ${label}: ${result.summary}`
  })
  if (!verification.length) verification.push('未配置自动验证；完成由验收证据与最终 Diff 门禁确认。')
  const changedFiles = deduplicate(ledger.changes.map((change) => change.operation === 'rename' && change.previousPath
    ? `${change.previousPath} -> ${change.path}`
    : change.path))
  const result = deduplicate([
    ledger.diffSnapshot?.summary || '',
    ...(ledger.status === 'completed' ? [] : [task.status === 'doing'
      ? `Agent Run ${ledger.status}，任务已回到 todo。`
      : `Agent Run ${ledger.status}，任务保持 ${task.status}。`]),
    ...(ledger.status === 'completed' ? [] : ledger.failures.slice(-2).map((failure) => failure.error.message)),
    ...(ledger.status === 'completed' || !ledger.nextAction ? [] : [`后续：${ledger.nextAction}`]),
    ...ledger.acceptanceEvidence.filter((evidence) => evidence.passed).map((evidence) => evidence.summary),
  ]).filter(Boolean)
  return {
    source,
    title: ledger.status === 'completed' ? `完成 ${task.title}` : `${task.title} · Agent Run ${ledger.status}`,
    taskId: task.id,
    taskShortId: task.shortId,
    version: task.version,
    recordLevel: task.workLevel,
    result,
    changedFiles,
    verification,
    decisions: deduplicate(ledger.decisions.map((decision) => `${decision.summary}：${decision.rationale}`)),
    outputRefs: deduplicate([
      ledger.diffSnapshot?.outputRef || '',
      ...ledger.verifications.map((verificationResult) => verificationResult.outputRef || ''),
    ]).filter(Boolean),
  }
}
