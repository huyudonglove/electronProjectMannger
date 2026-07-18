import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  appendTask,
  appendDialogue,
  appendConstraint,
  appendProjectQuestion,
  appendThought,
  createProjectVersion,
  deleteConstraint,
  deleteDialogue,
  deleteDocument,
  deleteKnowledge,
  deleteTask,
  deleteThought,
  initProject,
  isInitialized,
  getDashboard,
  listManagedProjects,
  removeManagedProject,
  replyOpenQuestion,
  refreshAgentBrief,
  resolveDataRoot,
  updateReplyRecord,
  updateProjectGuidance,
  updateQuestionStatus,
  updateRiskStatus,
  updateTaskStatus,
} from '../packages/project-core/dist/index.js'

const managerRoot = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-data-'))
const root = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-project-'))
const secondRoot = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-project-'))
const legacyRoot = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-legacy-project-'))
const migrationRoot = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-migration-project-'))

try {
  const legacyDataRoot = resolveDataRoot(managerRoot, legacyRoot)
  await mkdir(path.join(legacyDataRoot, '00_项目管理'), { recursive: true })
  await writeFile(path.join(legacyDataRoot, 'project.json'), JSON.stringify({
    projectId: 'legacy-project',
    name: 'Legacy Project',
    projectRoot: legacyRoot,
    dataRoot: legacyDataRoot,
    createdAt: new Date().toISOString(),
    version: 1,
  }, null, 2), 'utf8')
  await writeFile(path.join(legacyDataRoot, '00_项目管理/工程任务.md'), '# 旧任务\n', 'utf8')
  assert(!(await isInitialized(managerRoot, legacyRoot)), 'legacy data layout should not be treated as initialized current data')

  const migrationSeed = await initProject(managerRoot, migrationRoot, 'Migration Project')
  const migrationDataRoot = migrationSeed.config.dataRoot
  const legacyCopies = [
    ['tasks/工程任务.md', migrationSeed.agentBrief.currentDataPaths.tasks],
    ['thoughts/想法与问题.md', migrationSeed.agentBrief.currentDataPaths.thoughts],
    ['research/研究.md', migrationSeed.agentBrief.currentDataPaths.research],
    ['collaboration/待确认事项.md', migrationSeed.agentBrief.currentDataPaths.questions],
    ['collaboration/风险与后续.md', migrationSeed.agentBrief.currentDataPaths.risks],
    ['work-logs/Agent 工作记录.md', path.join(migrationSeed.agentBrief.currentDataPaths.workLogs, `${currentMonth()}.md`)],
  ]
  for (const [legacyRelativePath, versionPath] of legacyCopies) {
    const legacyPath = path.join(migrationDataRoot, legacyRelativePath)
    await mkdir(path.dirname(legacyPath), { recursive: true })
    await writeFile(legacyPath, await readFile(versionPath, 'utf8'), 'utf8')
  }
  await rm(path.join(migrationDataRoot, 'versions/V001'), { recursive: true, force: true })
  await writeFile(path.join(migrationDataRoot, 'project.json'), `${JSON.stringify({
    ...migrationSeed.config,
    schemaVersion: 2,
  }, null, 2)}\n`, 'utf8')
  const migratedDashboard = await getDashboard(managerRoot, migrationRoot)
  assert(migratedDashboard.config.schemaVersion === 3, 'schema 2 data should migrate to schema 3')
  assert(migratedDashboard.tasks.length === migrationSeed.tasks.length, 'migration should preserve task records')
  assert(await exists(migratedDashboard.agentBrief.currentDataPaths.tasks), 'migration should create version task files')
  assert(!(await exists(path.join(migrationDataRoot, 'tasks/工程任务.md'))), 'migration should remove the legacy task file after validation')
  assert(!(await exists(path.join(migrationDataRoot, 'work-logs/Agent 工作记录.md'))), 'migration should remove the legacy work-log file after validation')

  const dashboard = await initProject(managerRoot, root, 'Smoke Project')
  assert(dashboard.config.name === 'Smoke Project', 'project name should be set')
  assert(dashboard.config.projectId.startsWith('smoke-project-'), 'project id should include name slug')
  assert(dashboard.tasks.length === 1, 'initial task should exist')

  const dataRoot = dashboard.config.dataRoot
  const briefPath = path.join(dataRoot, 'agent-brief.json')
  const skillPath = path.join(dataRoot, 'skills/project-collaboration/SKILL.md')
  const taskPath = dashboard.agentBrief.currentDataPaths.tasks
  const thoughtPath = dashboard.agentBrief.currentDataPaths.thoughts
  const logPath = path.join(dashboard.agentBrief.currentDataPaths.workLogs, `${currentMonth()}.md`)
  const knowledgeRoot = path.join(managerRoot, 'knowledge')
  const knowledgePath = path.join(knowledgeRoot, '知识结构.md')
  const manualPath = path.join(dataRoot, 'documents/项目手册.md')
  const dialoguePath = dashboard.agentBrief.currentDataPaths.research
  const constraintsPath = path.join(dataRoot, 'constraints/项目约束.md')
  const questionsPath = dashboard.agentBrief.currentDataPaths.questions
  const risksPath = dashboard.agentBrief.currentDataPaths.risks
  const baselinePath = path.join(dataRoot, 'collaboration/当前项目基线.md')
  const versionsPath = path.join(dataRoot, 'versions/版本索引.md')
  const projectsIndexPath = path.join(managerRoot, 'projects.json')

  assert(dashboard.config.schemaVersion === 3, 'project should use schema version 3')
  assert(dashboard.currentVersion?.shortId === 'V001', 'initial current version should be V001')
  assert(dashboard.tasks[0]?.version === 'V001', 'initial task should belong to V001')
  assert(await exists(questionsPath), 'independent questions should be initialized')
  assert(await exists(risksPath), 'risks and follow-ups should be initialized')
  assert(await exists(baselinePath), 'current baseline should be initialized')
  assert(await exists(versionsPath), 'version index should be initialized')

  const brief = JSON.parse(await readFile(briefPath, 'utf8'))
  assert(brief.projectRoot === root, 'brief should point to project root')
  assert(Array.isArray(brief.instructions), 'brief instructions should exist')
  assert(brief.instructions.some((instruction) => instruction.includes('Txxx/Ixxx/Dxxx/Wxxx/Kxxx/Lxxx/Cxxx')), 'brief should describe descending record write order')

  const taskFile = await readFile(taskPath, 'utf8')
  const thoughtFile = await readFile(thoughtPath, 'utf8')
  const dialogueFile = await readFile(dialoguePath, 'utf8')
  const constraintsFile = await readFile(constraintsPath, 'utf8')
  const initialLogFile = await readFile(logPath, 'utf8')
  assert(taskFile.includes('T036') && taskFile.includes('T001'), 'task file should describe descending task write order')
  assert(thoughtFile.includes('I036') && thoughtFile.includes('I001'), 'thought file should describe descending thought write order')
  assert(dialogueFile.includes('D036') && dialogueFile.includes('D012'), 'research file should describe descending research write order')
  assert(constraintsFile.includes('C036') && constraintsFile.includes('C001'), 'constraints file should describe descending constraint write order')
  assert(initialLogFile.includes('L036') && initialLogFile.includes('L001'), 'work log file should describe descending log write order')

  const skill = await readFile(skillPath, 'utf8')
  assert(skill.includes('Project Collaboration Skill'), 'local skill should exist')
  assert(skill.includes('Do not omit required agent-log sections'), 'local skill should require explicit agent log sections')
  assert(skill.includes('descending record ID'), 'local skill should require descending record write order')
  assert(skill.includes('log_short_id:: Lxxx'), 'local skill should require explicit log short ids')
  assert(skill.includes('currentDataPaths'), 'local skill should resolve current version paths from the brief')
  assert(skill.includes('independently deletable records'), 'local skill should describe independent research-document deletion')
  assert(skill.includes(knowledgeRoot), 'local skill should describe global knowledge root')
  assert(await exists(dialoguePath), 'research notes should be initialized')
  assert(await exists(constraintsPath), 'project constraints should be initialized')
  assert(await exists(knowledgeRoot), 'global knowledge directory should be initialized')
  assert(!(await exists(knowledgePath)), 'global knowledge should not create a default knowledge file')
  assert(!(await exists(manualPath)), 'documents should not create a default project manual')
  assert(dashboard.dialogues.length === 0, 'initial dashboard should not create a default research record')
  assert(dashboard.knowledge.length === 0, 'initial dashboard should not expose default knowledge')
  assert(dashboard.documents.length === 0, 'initial dashboard should not expose default documents')
  assert(dashboard.constraints.some((constraint) => constraint.source === 'system' && constraint.path === 'skills/project-collaboration/SKILL.md'), 'initial dashboard should expose local skill as system constraint')
  assert(dashboard.constraints.filter((constraint) => constraint.source === 'system').every((constraint) => constraint.version === 'V001'), 'system constraints should expose the current source version')
  assert(!dashboard.constraints.some((constraint) => constraint.shortId === 'C001'), 'initial dashboard should not create a default user constraint')
  assert(dashboard.documents.every((note) => note.path.startsWith('documents/')), 'dashboard documents should only include documents folder files')
  assert(!dashboard.documents.some((note) => note.path.startsWith('knowledge/')), 'project documents should not include global knowledge')

  await assertRejects(() => appendTask(managerRoot, root, { title: '   ' }), '任务标题不能为空')
  await assertRejects(() => appendThought(managerRoot, root, '   '), '输入内容不能为空')
  await assertRejects(() => appendDialogue(managerRoot, root, { content: '   ' }), '研究内容不能为空')
  await assertRejects(() => appendConstraint(managerRoot, root, { title: '', content: 'Smoke' }), '约束标题不能为空')
  await assertRejects(() => appendConstraint(managerRoot, root, { title: 'Smoke', content: '' }), '约束内容不能为空')
  await assertRejects(() => updateTaskStatus(managerRoot, root, '', 'done'), '任务 ID 不能为空')
  await assertRejects(() => updateTaskStatus(managerRoot, root, 'missing-task', ''), '任务状态不能为空')
  await assertRejects(() => deleteTask(managerRoot, root, ''), '任务 ID 不能为空')
  await assertRejects(() => deleteThought(managerRoot, root, ''), '输入 ID 不能为空')
  await assertRejects(() => deleteConstraint(managerRoot, root, ''), '约束 ID 不能为空')
  await assertRejects(() => deleteDialogue(managerRoot, root, ''), '研究 ID 不能为空')
  await assertRejects(() => deleteDocument(managerRoot, root, ''), '文档 ID 不能为空')
  await assertRejects(() => deleteKnowledge(managerRoot, root, ''), '知识 ID 不能为空')
  await assertRejects(() => appendProjectQuestion(managerRoot, root, { title: '', question: 'Smoke question' }), '问题标题不能为空')
  await assertRejects(() => appendProjectQuestion(managerRoot, root, { title: 'Smoke question', question: '' }), '问题内容不能为空')
  await assertRejects(() => replyOpenQuestion(managerRoot, root, { questionId: '', answer: 'Smoke answer' }), '未确认事项不能为空')
  await assertRejects(() => replyOpenQuestion(managerRoot, root, { questionId: 'Q001', answer: '' }), '回复内容不能为空')
  await assertRejects(() => updateReplyRecord(managerRoot, root, { questionId: '', answer: 'Smoke answer' }), '回复 ID 不能为空')
  await assertRejects(() => updateReplyRecord(managerRoot, root, { questionId: 'missing-reply', answer: '' }), '回复内容不能为空')
  await assertRejects(() => removeManagedProject(managerRoot, ''), '项目 ID 不能为空')

  await writeFile(manualPath, `# 项目手册

summary:: 独立文档目录中的文档样例。
`, 'utf8')
  const normalizedKnowledgeDashboard = await getDashboard(managerRoot, root)
  const normalizedManual = normalizedKnowledgeDashboard.documents.find((note) => note.path === 'documents/项目手册.md')
  assert(normalizedManual?.shortId === 'W001', 'project documents should expose W short ids')
  assert(normalizedManual?.version === 'V001', 'project documents should inherit the current source version')
  assert((await readFile(manualPath, 'utf8')).includes('short_id:: W001'), 'project document file should be normalized with W short id')
  assert((await readFile(manualPath, 'utf8')).includes('version:: V001'), 'project document file should be normalized with a source version')
  assert(!normalizedKnowledgeDashboard.knowledge.some((note) => note.path === 'documents/项目手册.md'), 'project document files should not be exposed as global knowledge')
  assert(!normalizedKnowledgeDashboard.documents.some((note) => note.path.startsWith('tasks/') || note.path.startsWith('thoughts/') || note.path.startsWith('research/') || note.path.startsWith('collaboration/') || note.path.startsWith('work-logs/')), 'project documents should not aggregate module data files')

  await mkdir(path.join(dataRoot, 'documents/手册'), { recursive: true })
  await writeFile(path.join(dataRoot, 'documents/手册/使用说明.md'), `# 使用说明

summary:: 独立文档目录中的文档。
`, 'utf8')
  const nestedDocumentDashboard = await getDashboard(managerRoot, root)
  assert(nestedDocumentDashboard.documents.some((note) => note.path === 'documents/手册/使用说明.md'), 'documents view should include nested documents folder files')
  assert(nestedDocumentDashboard.documents.some((note) => note.path === 'documents/手册/使用说明.md' && note.shortId === 'W002'), 'nested documents should get independent W short ids')
  assert(nestedDocumentDashboard.documents.every((note) => note.version === 'V001'), 'all project documents should expose a source version')
  assert(nestedDocumentDashboard.documents[0]?.shortId === 'W002', 'documents should appear in descending W id order')

  await writeFile(path.join(knowledgeRoot, 'A 知识.md'), `# A 知识

summary:: 第一条知识。
`, 'utf8')
  await writeFile(path.join(knowledgeRoot, 'B 知识.md'), `# B 知识

summary:: 第二条知识。
`, 'utf8')
  const knowledgeOrderDashboard = await getDashboard(managerRoot, root)
  assert(knowledgeOrderDashboard.knowledge[0]?.shortId === 'K002', 'knowledge should appear in descending K id order')
  assert(knowledgeOrderDashboard.knowledge[1]?.shortId === 'K001', 'knowledge should keep larger ids above smaller ids')

  const deletedKnowledgeDashboard = await deleteKnowledge(managerRoot, root, 'K002')
  assert(!deletedKnowledgeDashboard.knowledge.some((note) => note.shortId === 'K002'), 'knowledge note should be deleted')

  const deletedManualDocumentDashboard = await deleteDocument(managerRoot, root, 'documents/项目手册.md')
  assert(!deletedManualDocumentDashboard.documents.some((note) => note.path === 'documents/项目手册.md'), 'project document should be deleted')

  const collaborationEntry = await readFile(path.join(root, '.agent-collaboration.md'), 'utf8')
  assert(collaborationEntry.includes(dataRoot), 'project should contain lightweight collaboration entry')
  assert(!(await exists(path.join(root, '.agent-hub'))), 'project root should not contain full .agent-hub')
  assert(await ignoredCollaborationEntries(root) === 1, 'collaboration entry should be ignored by git')

  await initProject(managerRoot, root, 'Smoke Project')
  assert(await ignoredCollaborationEntries(root) === 1, 'gitignore entry should not be duplicated')

  const projectsIndex = JSON.parse(await readFile(projectsIndexPath, 'utf8'))
  assert(projectsIndex.some((project) => project.projectId === dashboard.config.projectId), 'global projects index should include project')

  await initProject(managerRoot, secondRoot, 'Second Smoke Project')
  const recentProjects = await listManagedProjects(managerRoot)
  assert(recentProjects.length >= 2, 'recent projects should include initialized projects')
  assert(recentProjects[0].projectRoot === secondRoot, 'latest project should appear first')
  assert(recentProjects.some((project) => project.projectRoot === root), 'recent projects should include first project')
  const removedRecentProjects = await removeManagedProject(managerRoot, recentProjects[0].projectId)
  assert(!removedRecentProjects.some((project) => project.projectRoot === secondRoot), 'removed project should leave recent list')
  assert(await exists(path.join(recentProjects[0].dataRoot, 'project.json')), 'removing history should not delete project data')

  const nextBrief = await refreshAgentBrief(managerRoot, root)
  assert(nextBrief.dataRoot === dataRoot, 'refresh should keep data root')

  const guidanceDashboard = await updateProjectGuidance(managerRoot, root)
  assert(guidanceDashboard.config.dataRoot === dataRoot, 'guidance update should keep data root')
  const updatedSkill = await readFile(skillPath, 'utf8')
  const updatedDataSpec = await readFile(path.join(dataRoot, 'collaboration/数据层规范.md'), 'utf8')
  assert(updatedSkill.includes('Do not omit required agent-log sections'), 'guidance update should refresh skill rules')
  assert(updatedSkill.includes('Dxxx'), 'guidance update should refresh research rules')
  assert(updatedSkill.includes('Wxxx'), 'guidance update should refresh document rules')
  assert(updatedSkill.includes('Kxxx'), 'guidance update should refresh knowledge rules')
  assert(updatedSkill.includes('Cxxx'), 'guidance update should refresh constraint rules')
  assert(updatedSkill.includes('descending record ID'), 'guidance update should refresh record ordering writing rule')
  assert(updatedDataSpec.includes('## Agent 工作记录格式'), 'guidance update should refresh data spec log format')
  assert(updatedDataSpec.includes('## 知识条目格式'), 'guidance update should refresh knowledge format')
  assert(updatedDataSpec.includes('## 研究格式'), 'guidance update should refresh research format')
  assert(updatedDataSpec.includes('Txxx') && updatedDataSpec.includes('Ixxx') && updatedDataSpec.includes('Dxxx') && updatedDataSpec.includes('Wxxx') && updatedDataSpec.includes('Kxxx') && updatedDataSpec.includes('Lxxx') && updatedDataSpec.includes('Cxxx'), 'data spec should describe descending record write order')
  assert(updatedDataSpec.includes('short_id:: W001'), 'data spec should describe document short ids')
  assert(updatedDataSpec.includes('short_id:: C001'), 'data spec should describe constraint short ids')
  assert(updatedDataSpec.includes('log_short_id:: L001'), 'data spec should describe explicit log short ids')
  assert(updatedDataSpec.includes('待确认事项.md'), 'data spec should describe independent questions')
  assert(updatedDataSpec.includes('风险与后续.md'), 'data spec should separate risks and follow-ups')
  assert(updatedDataSpec.includes('version:: V001'), 'data spec should require version fields')
  assert(updatedDataSpec.includes('允许独立删除'), 'data spec should describe independent research-document deletion')

  const constraintDashboard = await appendConstraint(managerRoot, root, {
    title: 'Smoke Constraint',
    content: 'All agents should preserve smoke constraints.',
  })
  const smokeConstraint = constraintDashboard.constraints.find((constraint) => constraint.title === 'Smoke Constraint')
  assert(smokeConstraint?.shortId === 'C001', 'manual constraint should use C short ids')
  assert(smokeConstraint.version === 'V001', 'manual constraint should inherit the current source version')
  assert(smokeConstraint.source === 'user', 'manual constraint should be user sourced')
  assert(constraintDashboard.constraints.some((constraint) => constraint.source === 'system'), 'constraints dashboard should keep system constraints')
  const persistedConstraintContent = await readFile(constraintsPath, 'utf8')
  assert(persistedConstraintContent.includes('short_id:: C001'), 'manual constraint should be written to constraints file')
  assert(persistedConstraintContent.includes('version:: V001'), 'manual constraint should persist its source version')
  assert(persistedConstraintContent.includes('All agents should preserve smoke constraints.'), 'manual constraint content should be persisted')

  const guidanceAfterConstraint = await updateProjectGuidance(managerRoot, root)
  assert(guidanceAfterConstraint.constraints.some((constraint) => constraint.id === smokeConstraint.id), 'guidance update should preserve user constraints')

  const deletedConstraintDashboard = await deleteConstraint(managerRoot, root, smokeConstraint.id)
  assert(!deletedConstraintDashboard.constraints.some((constraint) => constraint.id === smokeConstraint.id), 'manual constraint should be deleted')
  assert(deletedConstraintDashboard.constraints.some((constraint) => constraint.source === 'system'), 'deleting user constraint should not delete system constraints')

  await rm(dialoguePath, { force: true })
  const missingDialogueDashboard = await getDashboard(managerRoot, root)
  assert(missingDialogueDashboard.dialogues.length === 0, 'dashboard refresh should not create a default research record')
  assert(await exists(dialoguePath), 'dashboard refresh should backfill missing research notes')

  await rm(dialoguePath, { force: true })
  await updateProjectGuidance(managerRoot, root)
  assert(await exists(dialoguePath), 'guidance update should backfill missing research notes')

  const nextDashboard = await getDashboard(managerRoot, root)
  assert(nextDashboard.activeTasks.length === 0, 'initial done task should not be active')
  assert(nextDashboard.logs.some((log) => log.content.includes('初始化项目协作数据')), 'dashboard should expose log detail content')

  const currentLog = await readFile(logPath, 'utf8')
  await writeFile(logPath, `${currentLog.trimEnd()}

## 2026-06-30 23:35 General log without task

type:: agent-log
log_short_id:: L900
created:: 2026-06-30 23:35

### 用户目标

This general log should stay out of the worklog panel.
`, 'utf8')
  const generalLogDashboard = await getDashboard(managerRoot, root)
  const generalLog = generalLogDashboard.logs.find((log) => log.title.includes('General log without task'))
  assert(generalLog, 'logs without task relation should remain visible')
  assert(generalLog.relatedTasks.some((task) => task.shortId === 'T000'), 'logs without task relation should expose T000')

  const currentSmokeLog = await readFile(logPath, 'utf8')
  await writeFile(logPath, `${currentSmokeLog.trimEnd()}

## 2026-06-30 23:40 Smoke work log

type:: agent-log
log_short_id:: L901
created:: 2026-06-30 23:40
task_short_id:: T001
version:: V001

### 用户目标

Smoke log should remain an audit record.

### 需求理解

Smoke understanding.

### 产出

- Smoke output.

### 关键步骤

- Smoke key step.

### 验收标准

- Smoke acceptance.

### 未确认事项

- Legacy inline questions must not surface.
`, 'utf8')

  const logQuestionDashboard = await getDashboard(managerRoot, root)
  assert(logQuestionDashboard.openQuestions.length === 0, 'legacy inline questions should not surface in dashboard')
  const smokeLog = logQuestionDashboard.logs.find((log) => log.title.includes('Smoke work log'))
  assert(smokeLog?.outputs.includes('Smoke output.'), 'log outputs should be parsed')
  assert(smokeLog?.keySteps.includes('Smoke key step.'), 'log key steps should be parsed')
  assert(smokeLog?.relatedTasks.length === 1 && smokeLog.relatedTasks[0].shortId === 'T001', 'log should expose explicit task_short_id relation')

  const taskDashboard = await appendTask(managerRoot, root, {
    title: 'Smoke Task',
    status: 'todo',
    openQuestions: 'Smoke task question.',
  })
  const smokeTask = taskDashboard.tasks.find((task) => task.title === 'Smoke Task')
  assert(smokeTask, 'new task should be appended')
  assert(smokeTask.version === 'V001', 'new task should inherit the current version')
  assert(taskDashboard.activeTasks.length === 1, 'todo task should be active')
  assert(taskDashboard.openQuestions.length === 0, 'task inline openQuestions input should not create a question')

  const questionDashboard = await appendProjectQuestion(managerRoot, root, {
    title: 'Smoke decision',
    question: 'Should the smoke task proceed?',
    background: 'The test needs a stable decision record.',
    recommendation: 'Proceed.',
    kind: 'decision',
    scope: 'version',
    blocking: true,
    relations: [smokeTask.shortId],
  })
  const taskQuestion = questionDashboard.openQuestions.find((item) => item.title === 'Smoke decision')
  assert(taskQuestion?.shortId === 'Q001', 'independent question should use a stable Q short id')
  assert(taskQuestion.version === 'V001', 'independent question should inherit current version')
  assert(taskQuestion.relations.includes(smokeTask.shortId), 'independent question should preserve relations')
  assert(taskQuestion.blocking, 'independent question should preserve blocking state')

  const repliedTaskDashboard = await replyOpenQuestion(managerRoot, root, {
    questionId: taskQuestion.id,
    answer: 'Smoke task answer.',
  })
  assert(!repliedTaskDashboard.openQuestions.some((item) => item.id === taskQuestion.id), 'decided question should leave the pending-user list')
  assert(repliedTaskDashboard.replyRecords.some((item) => item.id === taskQuestion.id && item.status === 'decided'), 'reply should move question to decided')
  assert(repliedTaskDashboard.agentBrief.pendingDecisions.some((item) => item.id === taskQuestion.id), 'decided question should be exposed as pending implementation')

  const editedTaskReplyDashboard = await updateReplyRecord(managerRoot, root, {
    questionId: taskQuestion.id,
    answer: 'Smoke task answer edited.',
  })
  const editedTaskReplies = editedTaskReplyDashboard.replyRecords.filter((item) => item.id === taskQuestion.id)
  assert(editedTaskReplies.length === 1, 'editing a reply should replace the existing record')
  assert(editedTaskReplies[0].conclusion === 'Smoke task answer edited.', 'edited decision should expose updated conclusion')

  const resolvedQuestionDashboard = await updateQuestionStatus(managerRoot, root, taskQuestion.id, 'resolved')
  assert(resolvedQuestionDashboard.replyRecords.some((item) => item.id === taskQuestion.id && item.status === 'resolved'), 'implemented decision should become resolved')
  assert(!resolvedQuestionDashboard.agentBrief.pendingDecisions.some((item) => item.id === taskQuestion.id), 'resolved decision should leave pending implementation')

  const currentRisks = await readFile(risksPath, 'utf8')
  await writeFile(risksPath, `${currentRisks.trimEnd()}

## Smoke verification risk

id:: risk-smoke
short_id:: R001
type:: risk-record
kind:: verification
status:: open
version:: V001
created:: 2026-07-01 10:00
updated:: 2026-07-01 10:00
source_refs:: T001

### 内容

Smoke verification is pending.

### 处理建议

Run the smoke verification.
`, 'utf8')
  const openRiskDashboard = await getDashboard(managerRoot, root)
  assert(openRiskDashboard.agentBrief.activeRisks.some((risk) => risk.id === 'risk-smoke'), 'open risks should enter the current brief')
  const resolvedRiskDashboard = await updateRiskStatus(managerRoot, root, 'risk-smoke', 'resolved')
  assert(resolvedRiskDashboard.risks.some((risk) => risk.id === 'risk-smoke' && risk.status === 'resolved'), 'risk status should be updateable')
  assert(!resolvedRiskDashboard.agentBrief.activeRisks.some((risk) => risk.id === 'risk-smoke'), 'resolved risks should leave the current brief')

  const doneDashboard = await updateTaskStatus(managerRoot, root, smokeTask.id, 'done')
  assert(doneDashboard.activeTasks.length === 0, 'done task should not be active')

  const deletedTaskDashboard = await deleteTask(managerRoot, root, smokeTask.id)
  assert(!deletedTaskDashboard.tasks.some((task) => task.id === smokeTask.id), 'task should be deleted')

  const thoughtDashboard = await appendThought(managerRoot, root, 'Smoke thought')
  const smokeThought = thoughtDashboard.thoughts.find((thought) => thought.content === 'Smoke thought')
  assert(smokeThought, 'thought should be appended')
  const thoughtsContent = await readFile(thoughtPath, 'utf8')
  assert(thoughtsContent.includes('### 回答'), 'new thoughts should include answer section')
  assert(!thoughtsContent.includes('### 未确认事项'), 'new thoughts should not include inline open question sections')
  assert(thoughtsContent.includes('暂无。'), 'new thoughts should use explicit empty answer placeholder')

  const deletedThoughtDashboard = await deleteThought(managerRoot, root, smokeThought.id)
  assert(!deletedThoughtDashboard.thoughts.some((thought) => thought.id === smokeThought.id), 'thought should be deleted')

  const versionDashboard = await createProjectVersion(managerRoot, root, {
    label: 'v0.2',
    title: 'Smoke current version',
    goal: 'Verify current-version scoping.',
    summary: 'Only V002 active records should enter the default brief.',
  })
  assert(versionDashboard.currentVersion?.shortId === 'V002', 'new version should become current')
  const v2DialoguePath = versionDashboard.agentBrief.currentDataPaths.research
  assert(versionDashboard.versions.find((version) => version.shortId === 'V001')?.status === 'completed', 'previous version should be completed')
  assert(versionDashboard.activeTasks.length === 0, 'completed-version tasks should stay out of current active tasks')

  const v2TaskDashboard = await appendTask(managerRoot, root, { title: 'V2 Smoke Task', status: 'todo' })
  const v2Task = v2TaskDashboard.tasks.find((task) => task.title === 'V2 Smoke Task')
  assert(v2Task?.version === 'V002', 'records created after version change should inherit V002')
  assert(v2TaskDashboard.activeTasks.length === 1 && v2TaskDashboard.activeTasks[0].id === v2Task.id, 'default active tasks should only include current version')
  const refreshedV2Brief = await refreshAgentBrief(managerRoot, root)
  assert(refreshedV2Brief.currentVersion?.shortId === 'V002', 'refreshed brief should expose current version')
  assert(refreshedV2Brief.activeTasks.every((task) => task.version === 'V002'), 'refreshed brief should contain only current-version active tasks')
  const baselineContent = await readFile(baselinePath, 'utf8')
  assert(baselineContent.includes('V002') && baselineContent.includes('Smoke current version'), 'baseline should regenerate with current version')
  assert((await readFile(versionsPath, 'utf8')).includes('status:: completed'), 'version index should preserve completed history')
  await deleteTask(managerRoot, root, v2Task.id)

  const concurrentTitles = Array.from({ length: 12 }, (_, index) => `Concurrent task ${index + 1}`)
  await Promise.all(concurrentTitles.map((title) => appendTask(managerRoot, root, { title, status: 'todo' })))
  const concurrentDashboard = await getDashboard(managerRoot, root)
  const concurrentTasks = concurrentDashboard.tasks.filter((task) => concurrentTitles.includes(task.title))
  assert(concurrentTasks.length === concurrentTitles.length, 'concurrent task writes should not lose records')
  assert(new Set(concurrentTasks.map((task) => task.shortId)).size === concurrentTitles.length, 'concurrent task writes should allocate unique IDs')

  const highestConcurrentId = Math.max(...concurrentTasks.map((task) => Number(task.shortId.slice(1))))
  const highestConcurrentTask = concurrentTasks.find((task) => Number(task.shortId.slice(1)) === highestConcurrentId)
  await deleteTask(managerRoot, root, highestConcurrentTask.id)
  const afterDeleteDashboard = await appendTask(managerRoot, root, { title: 'ID must not be reused', status: 'todo' })
  const nonReusedTask = afterDeleteDashboard.tasks.find((task) => task.title === 'ID must not be reused')
  assert(Number(nonReusedTask.shortId.slice(1)) > highestConcurrentId, 'deleted record IDs should never be reused')

  const beforeHeadingTaskCount = afterDeleteDashboard.tasks.length
  const headingDashboard = await appendTask(managerRoot, root, {
    title: 'Markdown heading boundary',
    status: 'todo',
    userOriginal: 'Keep this body intact.\n\n## API 示例\n\nstatus:: done\nversion:: V999',
  })
  assert(headingDashboard.tasks.length === beforeHeadingTaskCount + 1, 'body headings should not create phantom task records')
  const headingTask = headingDashboard.tasks.find((task) => task.title === 'Markdown heading boundary')
  assert(headingTask?.status === 'todo' && headingTask.version === 'V002', 'body metadata should not override record metadata')

  for (const task of headingDashboard.tasks.filter((item) =>
    concurrentTitles.includes(item.title) || ['ID must not be reused', 'Markdown heading boundary'].includes(item.title))) {
    await deleteTask(managerRoot, root, task.id)
  }

  const dialogueDashboard = await appendDialogue(managerRoot, root, {
    content: 'Smoke research record',
    answer: 'Smoke short reply',
    acceptance: 'Smoke acceptance',
  })
  const smokeDialogue = dialogueDashboard.dialogues.find((dialogue) => dialogue.recordContent === 'Smoke research record')
  assert(smokeDialogue?.shortId.startsWith('D'), 'research record should be appended with D short id')
  assert(dialogueDashboard.dialogues[0]?.shortId === smokeDialogue.shortId, 'newest research record should appear first')
  assert(smokeDialogue.relatedDocuments.some((shortId) => shortId.startsWith('W')), 'research record should link detailed document')
  assert(smokeDialogue.answer.includes(smokeDialogue.relatedDocuments[0]), 'research summary should point to detailed document')
  assert(!dialogueDashboard.thoughts.some((thought) => thought.content === 'Smoke research record'), 'research record should not be appended as thought')
  const researchDocument = dialogueDashboard.documents.find((note) => note.shortId === smokeDialogue.relatedDocuments[0])
  assert(researchDocument?.version === 'V002', 'new documents may record their source version')
  assert(researchDocument?.content.includes('Smoke short reply'), 'research detail should be written to document')
  assert(researchDocument?.content.includes('Smoke Acceptance') || researchDocument?.content.includes('Smoke acceptance'), 'research document should include acceptance')
  assert(dialogueDashboard.logs.some((log) => log.source === 'research' && log.content.includes(smokeDialogue.shortId) && log.content.includes(researchDocument.shortId)), 'research action should be written to work logs')
  const dialogueContent = await readFile(v2DialoguePath, 'utf8')
  assert(dialogueContent.includes('type:: dialogue'), 'new research record should include dialogue type')
  assert(dialogueContent.includes('related_documents::'), 'new research record should link document')
  assert(dialogueContent.includes('### 内容'), 'new research record should include content section')
  assert(dialogueContent.includes('### 回答'), 'new research record should include answer section')
  assert(dialogueContent.includes('### 验收标准'), 'new research record should include acceptance section')

  const deletedResearchDocumentDashboard = await deleteDocument(managerRoot, root, researchDocument.path)
  assert(!deletedResearchDocumentDashboard.documents.some((note) => note.path === researchDocument.path), 'research detail document should be deletable')
  const dialogueAfterDocumentDelete = deletedResearchDocumentDashboard.dialogues.find((dialogue) => dialogue.id === smokeDialogue.id)
  assert(dialogueAfterDocumentDelete?.relatedDocuments.includes(researchDocument.shortId), 'deleting a document should not rewrite research references')
  assert(dialogueAfterDocumentDelete.answer.includes(researchDocument.shortId), 'research summary should keep the original document reference')

  const cascadeDialogueDashboard = await appendDialogue(managerRoot, root, {
    content: 'Smoke cascade research record',
    answer: 'Smoke cascade reply',
    acceptance: 'Smoke cascade acceptance',
  })
  const cascadeDialogue = cascadeDialogueDashboard.dialogues.find((dialogue) => dialogue.recordContent === 'Smoke cascade research record')
  const cascadeDocument = cascadeDialogueDashboard.documents.find((note) => note.shortId === cascadeDialogue.relatedDocuments[0])
  assert(cascadeDocument, 'cascade research should create linked document')
  const deletedDialogueDashboard = await deleteDialogue(managerRoot, root, cascadeDialogue.id)
  assert(!deletedDialogueDashboard.dialogues.some((dialogue) => dialogue.id === cascadeDialogue.id), 'research record should be deleted')
  assert(deletedDialogueDashboard.documents.some((note) => note.path === cascadeDocument.path), 'deleting research should not delete linked research document')

  console.log('smoke test passed')
} finally {
  await rm(root, { recursive: true, force: true })
  await rm(secondRoot, { recursive: true, force: true })
  await rm(legacyRoot, { recursive: true, force: true })
  await rm(migrationRoot, { recursive: true, force: true })
  await rm(managerRoot, { recursive: true, force: true })
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function exists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function assertRejects(action, expectedMessage) {
  try {
    await action()
  } catch (error) {
    assert(String(error?.message || '').includes(expectedMessage), `expected rejection message "${expectedMessage}", got "${error?.message || error}"`)
    return
  }
  throw new Error(`expected rejection: ${expectedMessage}`)
}

async function ignoredCollaborationEntries(projectRoot) {
  const gitignore = await readFile(path.join(projectRoot, '.gitignore'), 'utf8')
  return gitignore.split(/\r?\n/).filter((line) => line.trim() === '.agent-collaboration.md').length
}

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}
