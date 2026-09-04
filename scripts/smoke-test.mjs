import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  appendConstraint,
  appendDialogue,
  appendProjectQuestion,
  appendTask,
  appendThought,
  createProjectVersion,
  deleteConstraint,
  deleteDialogue,
  deleteDocument,
  deleteKnowledge,
  deleteTask,
  deleteThought,
  getDashboard,
  initProject,
  listManagedProjects,
  refreshRecordSummary,
  removeManagedProject,
  replyOpenQuestion,
  updateAllProjectMetadata,
  updateProjectMetadata,
  updateQuestionStatus,
  updateRiskStatus,
  updateTaskStatus,
} from '../packages/project-core/dist/index.js'

const managerRoot = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-data-'))
const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-project-'))
const secondProjectRoot = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-project-'))

try {
  const initial = await initProject(managerRoot, projectRoot, 'Smoke Project')
  const dataRoot = initial.config.dataRoot
  const summaryPath = path.join(dataRoot, 'record-summary.json')
  const specPath = path.join(dataRoot, 'metadata/数据层规范.md')
  const baselinePath = path.join(dataRoot, 'metadata/当前项目基线.md')
  const constraintsPath = path.join(dataRoot, 'constraints/项目约束.md')
  const summary = JSON.parse(await readFile(summaryPath, 'utf8'))

  assert(initial.config.schemaVersion === 3, 'project schema should be initialized')
  assert(initial.currentVersion?.shortId === 'V001', 'initial version should be V001')
  assert(initial.tasks.length === 1, 'initial task record should exist')
  assert(summary.projectRoot === projectRoot, 'record summary should point to project root')
  assert(summary.currentDataPaths.tasks.endsWith('工程任务.md'), 'record summary should expose task records')
  assert(summary.currentDataPaths.workLogs.endsWith('工作记录'), 'record summary should expose work logs')
  assert(!('instructions' in summary) && !('skillPath' in summary), 'record summary should contain data only')
  assert(await exists(specPath), 'data specification should exist')
  assert(await exists(baselinePath), 'project baseline should exist')
  assert(!(await exists(path.join(dataRoot, 'agent-brief.json'))), 'agent brief should not be generated')
  assert(!(await exists(path.join(dataRoot, 'skills/project-collaboration/SKILL.md'))), 'local agent skill should not be generated')
  assert(!(await exists(path.join(dataRoot, 'collaboration/Agent 同步交接.md'))), 'agent handoff should not be generated')
  assert(!(await exists(path.join(projectRoot, '.agent-collaboration.md'))), 'project pointer should not be generated')

  const spec = await readFile(specPath, 'utf8')
  assert(spec.includes('type:: work-log'), 'data spec should use neutral work-log records')
  assert(!/Agent|agent-brief|project-collaboration/.test(spec), 'data spec should not contain agent instructions')

  const taskDashboard = await appendTask(managerRoot, projectRoot, {
    title: 'Smoke task',
    status: 'todo',
    workLevel: 'standard',
    userOriginal: 'Record a smoke task.',
    executionDefinition: 'Exercise task record CRUD.',
    acceptance: 'Task can be updated and deleted.',
  })
  const task = taskDashboard.tasks.find((item) => item.title === 'Smoke task')
  assert(task?.shortId === 'T002', 'task should receive the next stable id')
  assert(task?.workLevel === 'standard', 'task work level should round-trip')
  assert(!('parentId' in task) && !('contextId' in task) && !('messages' in task), 'task should not expose task-tree execution fields')
  const doing = await updateTaskStatus(managerRoot, projectRoot, task.id, 'doing')
  assert(doing.tasks.find((item) => item.id === task.id)?.status === 'doing', 'task status should update')

  const thoughtDashboard = await appendThought(managerRoot, projectRoot, 'Smoke thought')
  const thought = thoughtDashboard.thoughts.find((item) => item.content === 'Smoke thought')
  assert(thought?.shortId === 'I001', 'thought should be appended')

  const researchDashboard = await appendDialogue(managerRoot, projectRoot, {
    content: 'Smoke research',
    mode: 'depth',
    acceptance: 'Preserve the research record.',
  })
  const research = researchDashboard.dialogues.find((item) => item.recordContent === 'Smoke research')
  assert(research?.shortId === 'D001' && research.mode === 'depth', 'research should round-trip')
  assert(researchDashboard.recordSummary.activeResearch.some((item) => item.id === research.id), 'pending research should be indexed')

  const constraintDashboard = await appendConstraint(managerRoot, projectRoot, {
    title: 'Smoke constraint',
    content: 'Keep record behavior deterministic.',
  })
  const constraint = constraintDashboard.constraints.find((item) => item.title === 'Smoke constraint')
  assert(constraint?.shortId === 'C001', 'constraint should be appended')
  assert(constraintDashboard.constraints.filter((item) => item.source === 'system').length === 1, 'only the data spec should be exposed as a system record')

  const questionDashboard = await appendProjectQuestion(managerRoot, projectRoot, {
    title: 'Smoke question',
    question: 'Which record should be updated?',
    blocking: true,
  })
  const question = questionDashboard.questions.find((item) => item.title === 'Smoke question')
  assert(question?.origin === 'system', 'new non-user questions should use a neutral source')
  assert(question?.messages[0]?.role === 'system', 'question history should use a neutral role')
  const replied = await replyOpenQuestion(managerRoot, projectRoot, {
    questionId: question.id,
    answer: 'Update the smoke task.',
  })
  assert(replied.questions.find((item) => item.id === question.id)?.status === 'decided', 'question reply should move the record to follow-up')
  assert(replied.questions.find((item) => item.id === question.id)?.messages.length === 2, 'question replies should append')
  const resolved = await updateQuestionStatus(managerRoot, projectRoot, question.id, 'resolved')
  assert(resolved.questions.find((item) => item.id === question.id)?.status === 'resolved', 'question status should update')

  const risksPath = initial.recordSummary.currentDataPaths.risks
  const risks = await readFile(risksPath, 'utf8')
  await writeFile(risksPath, `${risks.trimEnd()}

## Smoke risk

id:: risk-smoke
short_id:: R001
type:: risk-record
kind:: verification
status:: open
version:: V001
created:: 2026-09-02 10:00
updated:: 2026-09-02 10:00
source_refs:: T002

### 内容

Smoke verification is pending.

### 处理建议

Run the smoke test.
`, 'utf8')
  const riskDashboard = await getDashboard(managerRoot, projectRoot)
  assert(riskDashboard.recordSummary.activeRisks.some((item) => item.id === 'risk-smoke'), 'open risks should be indexed')
  const resolvedRisk = await updateRiskStatus(managerRoot, projectRoot, 'risk-smoke', 'resolved')
  assert(resolvedRisk.risks.find((item) => item.id === 'risk-smoke')?.status === 'resolved', 'risk status should update')

  const documentsRoot = path.join(dataRoot, 'documents')
  const documentPath = path.join(documentsRoot, 'W001-Smoke.md')
  await mkdir(documentsRoot, { recursive: true })
  await writeFile(documentPath, `# Smoke document

short_id:: W001
type:: document
status:: active
version:: V001
summary:: Smoke document.
`, 'utf8')
  const knowledgeRoot = initial.recordSummary.knowledgeRoot
  const knowledgePath = path.join(knowledgeRoot, 'K001-Smoke.md')
  await writeFile(knowledgePath, `# Smoke knowledge

id:: knowledge-smoke
short_id:: K001
type:: knowledge
status:: active
version:: V001
summary:: Smoke knowledge.
`, 'utf8')
  const notes = await getDashboard(managerRoot, projectRoot)
  assert(notes.documents.some((item) => item.shortId === 'W001'), 'project documents should be listed')
  assert(notes.knowledge.some((item) => item.shortId === 'K001'), 'global knowledge should be listed')
  assert(!(await deleteDocument(managerRoot, projectRoot, 'W001')).documents.some((item) => item.shortId === 'W001'), 'document should be deleted')
  assert(!(await deleteKnowledge(managerRoot, projectRoot, 'K001')).knowledge.some((item) => item.shortId === 'K001'), 'knowledge should be deleted')

  const versionDashboard = await createProjectVersion(managerRoot, projectRoot, {
    label: 'v0.2',
    title: 'Second record version',
    goal: 'Verify version-scoped records.',
  })
  assert(versionDashboard.currentVersion?.shortId === 'V002', 'new version should become current')
  assert(versionDashboard.recordSummary.currentDataPaths.tasks.includes('/V002/'), 'summary paths should follow the current version')

  const refreshed = await refreshRecordSummary(managerRoot, projectRoot)
  assert(refreshed.currentVersion?.shortId === 'V002', 'record summary should refresh')
  await mkdir(path.join(dataRoot, 'skills/project-collaboration'), { recursive: true })
  await mkdir(path.join(dataRoot, 'collaboration'), { recursive: true })
  await writeFile(path.join(dataRoot, 'agent-brief.json'), '{}\n', 'utf8')
  await writeFile(path.join(dataRoot, 'skills/project-collaboration/SKILL.md'), '# Obsolete\n', 'utf8')
  await writeFile(path.join(dataRoot, 'collaboration/Agent 同步交接.md'), '# Obsolete\n', 'utf8')
  await writeFile(path.join(projectRoot, '.agent-collaboration.md'), '# Obsolete\n', 'utf8')
  await writeFile(path.join(projectRoot, '.gitignore'), '.agent-collaboration.md\ndist/\n', 'utf8')
  assert((await updateProjectMetadata(managerRoot, projectRoot)).config.dataRoot === dataRoot, 'metadata refresh should preserve data root')
  assert(!(await exists(path.join(dataRoot, 'agent-brief.json'))), 'metadata refresh should remove the obsolete brief')
  assert(!(await exists(path.join(dataRoot, 'skills/project-collaboration/SKILL.md'))), 'metadata refresh should remove the obsolete skill')
  assert(!(await exists(path.join(dataRoot, 'collaboration/Agent 同步交接.md'))), 'metadata refresh should remove the obsolete handoff')
  assert(!(await exists(path.join(projectRoot, '.agent-collaboration.md'))), 'metadata refresh should remove the obsolete pointer')
  assert((await readFile(path.join(projectRoot, '.gitignore'), 'utf8')) === 'dist/\n', 'metadata refresh should remove only the obsolete ignore entry')

  await initProject(managerRoot, secondProjectRoot, 'Second Smoke Project')
  const recent = await listManagedProjects(managerRoot)
  const openTimes = new Map(recent.map((item) => [item.projectId, item.lastOpenedAt]))
  const metadataResults = await updateAllProjectMetadata(managerRoot)
  assert(metadataResults.every((item) => item.status === 'updated'), 'all managed metadata should refresh')
  const afterMetadata = await listManagedProjects(managerRoot)
  assert(afterMetadata.every((item) => item.lastOpenedAt === openTimes.get(item.projectId)), 'metadata refresh should preserve recent order')

  await deleteDialogue(managerRoot, projectRoot, research.id)
  await deleteThought(managerRoot, projectRoot, thought.id)
  await deleteConstraint(managerRoot, projectRoot, constraint.id)
  await deleteTask(managerRoot, projectRoot, task.id)

  const removed = await removeManagedProject(managerRoot, initial.config.projectId)
  assert(!removed.some((item) => item.projectId === initial.config.projectId), 'managed project should be removable')

  console.log('smoke test passed')
} finally {
  await rm(projectRoot, { recursive: true, force: true })
  await rm(secondProjectRoot, { recursive: true, force: true })
  await rm(managerRoot, { recursive: true, force: true })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function exists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}
