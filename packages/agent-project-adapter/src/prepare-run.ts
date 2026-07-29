import type { Dashboard, ProjectConstraint, ProjectTask } from '@electron-manager/project-core'

import {
  PROJECT_ADAPTER_SCHEMA_VERSION,
  type PrepareProjectRunInput,
  type PreparedProjectRun,
  type ProjectAdapterIssue,
  type ProjectAdapterResult,
} from './types.js'
import {
  activeTask,
  adapterIssue,
  deduplicate,
  findTask,
  isPlaceholder,
  splitMarkdownRequirements,
  stableKey,
} from './utils.js'

export function prepareProjectTaskRun(
  dashboard: Dashboard,
  input: PrepareProjectRunInput,
): ProjectAdapterResult<PreparedProjectRun> {
  const issues: ProjectAdapterIssue[] = []
  const runId = String(input.runId || '').trim()
  if (!runId) issues.push(adapterIssue('INVALID_RUN_ID', 'runId', 'Run id is required'))
  const task = findTask(dashboard, input.taskId)
  if (!task) {
    issues.push(adapterIssue('TASK_NOT_FOUND', 'taskId', `Project task does not exist: ${input.taskId}`))
    return { ok: false, issues }
  }
  validateTask(dashboard, task, issues)
  const acceptance = splitMarkdownRequirements(task.acceptance)
  if (!acceptance.length || isPlaceholder(task.acceptance)) {
    issues.push(adapterIssue('MISSING_ACCEPTANCE', 'task.acceptance', 'Task acceptance must be defined before creating an Agent Run', [task.shortId]))
  }
  const verificationPlan = cloneVerificationPlan(input.verificationPlan, issues)
  const blockingQuestions = dashboard.questions.filter((question) =>
    question.status === 'open'
    && question.blocking
    && (
      question.relations.includes(task.id)
      || question.relations.includes(task.shortId)
      || (question.scope === 'project' && question.relations.length === 0)
    ),
  )
  for (const question of blockingQuestions) {
    issues.push(adapterIssue(
      'BLOCKING_QUESTION',
      'project.questions',
      `Blocking project question must be resolved before the run: ${question.shortId} ${question.title}`,
      [question.shortId, task.shortId],
    ))
  }
  if (issues.some((issue) => issue.severity === 'error')) return { ok: false, issues }

  const warnings: ProjectAdapterIssue[] = []
  if (!verificationPlan.checks.length && (input.intent ?? 'change') === 'change') {
    warnings.push(adapterIssue(
      'VERIFICATION_NOT_CONFIGURED',
      'verificationPlan',
      'No automated verification was configured; completion will still require acceptance evidence and a final diff',
      [task.shortId],
      'warning',
    ))
  }
  const taskConstraints = splitMarkdownRequirements(task.constraints)
  const constraintRefs = activeConstraints(dashboard.constraints).map((constraint) => constraintRef(constraint))
  const constraints = deduplicate([...taskConstraints, ...constraintRefs.map((item) => item.text)])
  const sourceRefs = deduplicate([
    `project:${dashboard.config.projectId}`,
    `version:${task.version}`,
    `task:${task.shortId}@${task.updated}`,
    ...(task.sourceRefs || []),
    ...constraintRefs.map((item) => item.ref),
  ])
  const intent = input.intent ?? 'change'
  const goal = [task.title, task.detail].filter((value, index, values) => value.trim() && values.indexOf(value) === index).join('\n\n')
  const prepared: PreparedProjectRun = {
    schemaVersion: PROJECT_ADAPTER_SCHEMA_VERSION,
    projectRoot: dashboard.config.projectRoot,
    workLevel: task.workLevel,
    runInput: {
      runId,
      goal,
      acceptanceCriteria: acceptance.map((description, index) => ({
        id: `acceptance-${String(index + 1).padStart(3, '0')}`,
        description,
        required: acceptanceCriterionRequired(description, intent),
      })),
      constraints,
      intent,
      verificationPlan,
      taskId: task.id,
      taskShortId: task.shortId,
      metadata: {
        projectAdapterSchemaVersion: PROJECT_ADAPTER_SCHEMA_VERSION,
        projectId: dashboard.config.projectId,
        projectVersion: task.version,
        taskTitle: task.title,
        taskArea: task.area,
        taskPriority: task.priority,
        taskUpdated: task.updated,
        taskSourceRevision: stableKey([task.id, task.updated, task.detail, task.acceptance, task.constraints]),
        ...(task.depthReason ? { depthReason: task.depthReason } : {}),
        ...(task.userOriginal ? { userOriginal: task.userOriginal } : {}),
        ...(task.planRollback ? { planRollback: task.planRollback } : {}),
      },
    },
    ...(task.status === 'doing' ? {} : {
      startUpdate: {
        taskId: task.id,
        taskShortId: task.shortId,
        expectedStatus: task.status,
        expectedUpdated: task.updated,
        nextStatus: 'doing',
      },
    }),
    sourceRefs,
  }
  return { ok: true, value: prepared, warnings }
}

function acceptanceCriterionRequired(description: string, intent: 'change' | 'analysis') {
  const normalized = description.trim().replace(/[。.]$/, '')
  if (normalized === '如遇阻塞，明确说明原因和下一步') return false
  if (intent === 'analysis' && normalized === '对实际改动执行合适的验证') return false
  return true
}

function validateTask(dashboard: Dashboard, task: ProjectTask, issues: ProjectAdapterIssue[]) {
  if (!activeTask(task.status)) {
    issues.push(adapterIssue('TASK_NOT_ACTIVE', 'task.status', `Task is not active: ${task.status}`, [task.shortId]))
  }
  const currentVersion = dashboard.currentVersion?.shortId || dashboard.config.currentVersionId
  if (task.version !== currentVersion) {
    issues.push(adapterIssue(
      'TASK_VERSION_MISMATCH',
      'task.version',
      `Task ${task.shortId} belongs to ${task.version}, but the active version is ${currentVersion}`,
      [task.shortId, task.version, currentVersion],
    ))
  }
  if (!task.detail.trim() || isPlaceholder(task.detail)) {
    issues.push(adapterIssue(
      'MISSING_EXECUTION_DEFINITION',
      'task.detail',
      'Task execution definition must be completed before creating an Agent Run',
      [task.shortId],
    ))
  }
  if (task.workLevel === 'deep' && (!task.depthReason || isPlaceholder(task.constraints) || isPlaceholder(task.planRollback))) {
    issues.push(adapterIssue(
      'DEEP_METADATA_MISSING',
      'task.workLevel',
      'Deep tasks require depth reason, concrete constraints, and a rollback plan',
      [task.shortId],
    ))
  }
}

function cloneVerificationPlan(value: PrepareProjectRunInput['verificationPlan'], issues: ProjectAdapterIssue[]) {
  const checks = value?.checks ?? []
  const ids = new Set<string>()
  const normalized = checks.flatMap((check, index) => {
    const id = String(check.id || '').trim()
    const label = String(check.label || '').trim()
    const command = check.command?.map((part) => String(part))
    if (!id || !label || ids.has(id) || command?.some((part) => !part.trim())) {
      issues.push(adapterIssue(
        'INVALID_VERIFICATION',
        `verificationPlan.checks.${index}`,
        'Verification checks require unique ids, labels, and non-empty command arguments',
      ))
      return []
    }
    ids.add(id)
    return [{
      id,
      label,
      required: check.required !== false,
      ...(command ? { command } : {}),
      ...(check.timeoutMs !== undefined ? { timeoutMs: check.timeoutMs } : {}),
    }]
  })
  return { checks: normalized }
}

function activeConstraints(constraints: ProjectConstraint[]) {
  return constraints
    .filter((constraint) => constraint.source === 'user' && (constraint.status === 'active' || constraint.status === 'readonly'))
    .sort((left, right) => left.shortId.localeCompare(right.shortId) || left.id.localeCompare(right.id))
}

function constraintRef(constraint: ProjectConstraint) {
  const label = constraint.shortId || constraint.id
  return {
    ref: `constraint:${label}@${constraint.updated}`,
    text: `[${label}] ${constraint.title}: ${constraint.summary}`,
  }
}
