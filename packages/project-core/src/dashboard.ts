import path from 'node:path'

import {
  BASELINE_PATH,
  GLOBAL_KNOWLEDGE_DIR,
  RECORD_SKILL_PATH,
  RECORD_SUMMARY_PATH,
  VERSIONS_PATH,
  VERSION_DIALOGUES_FILE,
  VERSION_LOGS_DIR,
  VERSION_QUESTIONS_FILE,
  VERSION_RISKS_FILE,
  VERSION_TASKS_FILE,
  VERSION_THOUGHTS_FILE,
} from './paths.js'
import {
  parseDialogues,
  parseProjectLogs,
  parseProjectQuestions,
  parseProjectRisks,
  parseProjectTasks,
  parseProjectVersions,
  parseThoughts,
  recordInVersion,
} from './parsers.js'
import type { Dashboard, RecordSummary } from './types.js'
import { localTime } from './utils.js'
import { parseKnowledgeNotes, listGlobalKnowledgeDocuments, listProjectConstraints, listProjectDocuments } from './internal/notes.js'
import { readProjectConfig, resolveExistingDataRoot } from './internal/project-context.js'
import { upsertProjectIndex } from './internal/project-registry.js'
import { ensureRecordCounters, readProjectFile, writeProjectFile } from './internal/storage.js'
import { readVersionLogs, readVersionRecordFamily } from './internal/version-files.js'

export async function getDashboard(managerDataRoot: string, projectRoot: string): Promise<Dashboard> {
  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const config = await readProjectConfig(managerDataRoot, projectRoot)
  const tasksContent = await readVersionRecordFamily(dataRoot, VERSION_TASKS_FILE)
  const logContent = await readVersionLogs(dataRoot)
  const tasks = parseProjectTasks(tasksContent)
  const thoughts = parseThoughts(await readVersionRecordFamily(dataRoot, VERSION_THOUGHTS_FILE))
  const dialogues = parseDialogues(await readVersionRecordFamily(dataRoot, VERSION_DIALOGUES_FILE))
  const documents = await listProjectDocuments(dataRoot)
  const knowledge = parseKnowledgeNotes(await listGlobalKnowledgeDocuments(managerDataRoot))
  const constraints = await listProjectConstraints(dataRoot, config.currentVersionId)
  const logs = parseProjectLogs(logContent, tasks)
  const versions = parseProjectVersions(await readProjectFile(dataRoot, VERSIONS_PATH))
  const currentVersion = versions.find((version) => version.shortId === config.currentVersionId)
    || versions.find((version) => version.status === 'active')
    || versions[0]
    || null
  const questions = parseProjectQuestions(await readVersionRecordFamily(dataRoot, VERSION_QUESTIONS_FILE))
  const risks = parseProjectRisks(await readVersionRecordFamily(dataRoot, VERSION_RISKS_FILE))
  await ensureRecordCounters(dataRoot, {
    T: tasks.map((item) => item.shortId),
    I: thoughts.map((item) => item.shortId),
    D: dialogues.map((item) => item.shortId),
    W: documents.map((item) => item.shortId),
    L: logs.map((item) => item.shortId),
    C: constraints.filter((item) => item.source === 'user').map((item) => item.shortId),
    Q: questions.map((item) => item.shortId),
    R: risks.map((item) => item.shortId),
    V: versions.map((item) => item.shortId),
  })
  const currentVersionId = currentVersion?.shortId || config.currentVersionId
  const currentTasks = tasks.filter((task) => recordInVersion(task.version, currentVersionId))
  const activeResearch = dialogues.filter((dialogue) =>
    ['pending', 'doing'].includes(dialogue.status)
    && recordInVersion(dialogue.version, currentVersionId),
  )
  const currentLogs = logs.filter((log) => recordInVersion(log.version, currentVersionId))
  const latestLogs = currentLogs.slice(0, 5).map((log) => log.title)
  const activeTasks = currentTasks.filter((task) => ['backlog', 'todo', 'doing'].includes(task.status))
  const openQuestions = questions.filter((question) =>
    question.status === 'open'
    && (question.scope === 'project' || recordInVersion(question.version, currentVersionId)),
  )
  const pendingDecisions = questions.filter((question) =>
    question.status === 'decided'
    && (question.scope === 'project' || recordInVersion(question.version, currentVersionId)),
  )
  const activeRisks = risks
    .filter((risk) => risk.status === 'open' && recordInVersion(risk.version, currentVersionId))
    .map(({ id, shortId, title, kind, status, version, updated, relations }) => ({
      id,
      shortId,
      title,
      kind,
      status,
      version,
      updated,
      relations,
    }))
  const currentVersionRoot = path.join(dataRoot, 'versions', currentVersionId)
  const currentDataPaths = {
    tasks: path.join(currentVersionRoot, VERSION_TASKS_FILE),
    thoughts: path.join(currentVersionRoot, VERSION_THOUGHTS_FILE),
    research: path.join(currentVersionRoot, VERSION_DIALOGUES_FILE),
    questions: path.join(currentVersionRoot, VERSION_QUESTIONS_FILE),
    risks: path.join(currentVersionRoot, VERSION_RISKS_FILE),
    workLogs: path.join(currentVersionRoot, VERSION_LOGS_DIR),
  }

  const recordSummary: RecordSummary = {
    generatedAt: new Date().toISOString(),
    projectRoot,
    dataRoot,
    knowledgeRoot: path.join(managerDataRoot, GLOBAL_KNOWLEDGE_DIR),
    recordSkillPath: path.join(dataRoot, RECORD_SKILL_PATH),
    baselinePath: path.join(dataRoot, BASELINE_PATH),
    currentVersionRoot,
    currentDataPaths,
    currentVersion,
    activeTasks,
    activeResearch,
    openQuestions,
    pendingDecisions,
    activeRisks,
    latestLogs,
  }

  return {
    config,
    tasks,
    thoughts,
    dialogues,
    knowledge,
    documents,
    constraints,
    logs,
    versions,
    currentVersion,
    questions,
    risks,
    activeTasks,
    activeResearch,
    openQuestions,
    latestLogs,
    recordSummary,
  }
}

export async function refreshRecordSummary(managerDataRoot: string, projectRoot: string) {
  const dashboard = await getDashboard(managerDataRoot, projectRoot)
  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  await writeProjectFile(dataRoot, RECORD_SUMMARY_PATH, `${JSON.stringify(dashboard.recordSummary, null, 2)}\n`)
  await writeProjectFile(dataRoot, BASELINE_PATH, baselineMarkdown(dashboard))
  await writeProjectFile(dataRoot, 'index.json', `${JSON.stringify(indexFromDashboard(dashboard), null, 2)}\n`)
  await upsertProjectIndex(managerDataRoot, dashboard.config, false)
  return dashboard.recordSummary
}

export function indexFromDashboard(dashboard: Dashboard) {
  return {
    generatedAt: new Date().toISOString(),
    project: dashboard.config.name,
    currentVersion: dashboard.currentVersion?.shortId || '',
    versionCount: dashboard.versions.length,
    taskCount: dashboard.tasks.length,
    dialogueCount: dashboard.dialogues.length,
    knowledgeCount: dashboard.knowledge.length,
    documentCount: dashboard.documents.length,
    constraintCount: dashboard.constraints.length,
    activeTaskCount: dashboard.activeTasks.length,
    openQuestionCount: dashboard.openQuestions.length,
    pendingDecisionCount: dashboard.questions.filter((question) => question.status === 'decided').length,
    activeRiskCount: dashboard.risks.filter((risk) => risk.status === 'open').length,
  }
}

export function baselineMarkdown(dashboard: Dashboard) {
  const version = dashboard.currentVersion
  const currentVersionId = version?.shortId || dashboard.config.currentVersionId
  const activeConstraints = dashboard.constraints
    .filter((constraint) => constraint.source === 'user' && constraint.status === 'active')
    .map((constraint) => `- ${constraint.shortId} ${constraint.title}`)
  const activeTasks = dashboard.activeTasks
    .map((task) => `- ${task.shortId} [${task.status}] ${task.title}`)
  const openQuestions = dashboard.questions
    .filter((question) => question.status === 'open' && (question.scope === 'project' || recordInVersion(question.version, currentVersionId)))
    .map((question) => `- ${question.shortId} ${question.question || question.title}`)
  const pendingDecisions = dashboard.questions
    .filter((question) => question.status === 'decided' && (question.scope === 'project' || recordInVersion(question.version, currentVersionId)))
    .map((question) => `- ${question.shortId} ${question.conclusion || question.question || question.title}`)
  const risks = dashboard.risks
    .filter((risk) => risk.status === 'open' && recordInVersion(risk.version, currentVersionId))
    .map((risk) => `- ${risk.shortId} [${risk.kind}] ${risk.title}`)

  return `# 当前项目基线

generated:: ${localTime()}
project:: ${dashboard.config.name}
current_version:: ${currentVersionId || '无'}
version_label:: ${version?.label || '无'}
version_title:: ${version?.title || '无'}

## 当前版本

### 目标

${version?.goal || '暂无。'}

### 内容描述

${version?.summary || '暂无。'}

## 当前有效约束

${activeConstraints.join('\n') || '- 无。'}

## 正在进行

${activeTasks.join('\n') || '- 无。'}

## 待决定

${openQuestions.join('\n') || '- 无。'}

## 已决定待落实

${pendingDecisions.join('\n') || '- 无。'}

## 已知风险与验证限制

${risks.join('\n') || '- 无。'}
`
}
