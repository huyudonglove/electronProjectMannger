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
  getDashboard,
  listManagedProjects,
  removeManagedProject,
  replyOpenQuestion,
  refreshAgentBrief,
  updateAllProjectGuidance,
  updateProjectGuidance,
  updateQuestionStatus,
  updateRiskStatus,
  updateTaskStatus,
} from '../packages/project-core/dist/index.js'

const managerRoot = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-data-'))
const root = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-project-'))
const secondRoot = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-project-'))

try {
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
  assert(brief.instructions.some((instruction) => instruction.includes('breadth') && instruction.includes('depth')), 'brief should describe both research modes')

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
  assert(initialLogFile.includes('record_level:: deep'), 'initial setup log should use deep record level')

  const skill = await readFile(skillPath, 'utf8')
  assert(skill.includes('Project Collaboration Skill'), 'local skill should exist')
  assert(skill.includes('record_level:: light | standard | deep'), 'local skill should define record levels')
  assert(skill.includes('small file changes'), 'local skill should define light file-change logs')
  assert(skill.includes('### 验收结果'), 'local skill should require explicit acceptance results')
  assert(skill.includes('before execution and verification'), 'local skill should put acceptance criteria before execution')
  assert(skill.includes('descending record ID'), 'local skill should require descending record write order')
  assert(skill.includes('log_short_id:: Lxxx'), 'local skill should require explicit log short ids')
  assert(skill.includes('currentDataPaths'), 'local skill should resolve current version paths from the brief')
  assert(skill.includes('independently deletable'), 'local skill should describe independent research-document deletion')
  assert(skill.includes('questions append-only'), 'local skill should require append-only collaboration threads')
  assert(skill.includes('open waits for the user'), 'local skill should define question status by the next collaborator')
  assert(skill.includes('mode:: breadth') && skill.includes('mode:: depth'), 'local skill should define breadth and depth research')
  assert(skill.includes('New research creates pending D only'), 'local skill should keep new research lightweight')
  assert(skill.includes(knowledgeRoot), 'local skill should describe global knowledge root')
  assert((await readFile(questionsPath, 'utf8')).includes('每次回复都追加'), 'question file should describe append-only conversation records')
  assert(await exists(dialoguePath), 'research notes should be initialized')
  assert(await exists(constraintsPath), 'project constraints should be initialized')
  assert(await exists(knowledgeRoot), 'global knowledge directory should be initialized')
  assert(!(await exists(knowledgePath)), 'global knowledge should not create a default knowledge file')
  assert(!(await exists(manualPath)), 'documents should not create a default project manual')
  assert(dashboard.dialogues.length === 0, 'initial dashboard should not create a default research record')
  assert(dashboard.agentBrief.activeResearch.length === 0, 'initial brief should expose an empty research queue')
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
  await assertRejects(() => removeManagedProject(managerRoot, ''), '项目 ID 不能为空')

  await writeFile(manualPath, `# 项目手册

summary:: 独立文档目录中的文档样例。
`, 'utf8')
  const normalizedKnowledgeDashboard = await getDashboard(managerRoot, root)
  const normalizedManual = normalizedKnowledgeDashboard.documents.find((note) => note.path === 'documents/项目手册.md')
  assert(normalizedManual?.shortId === '', 'project documents should not be assigned ids during read')
  assert(normalizedManual?.version === '', 'project documents should not inherit a version during read')
  assert(!(await readFile(manualPath, 'utf8')).includes('short_id::'), 'project document files should remain unchanged during read')
  assert(!(await readFile(manualPath, 'utf8')).includes('version::'), 'project document files should remain unchanged during read')
  assert(!normalizedKnowledgeDashboard.knowledge.some((note) => note.path === 'documents/项目手册.md'), 'project document files should not be exposed as global knowledge')
  assert(!normalizedKnowledgeDashboard.documents.some((note) => note.path.startsWith('tasks/') || note.path.startsWith('thoughts/') || note.path.startsWith('research/') || note.path.startsWith('collaboration/') || note.path.startsWith('work-logs/')), 'project documents should not aggregate module data files')

  await mkdir(path.join(dataRoot, 'documents/手册'), { recursive: true })
  await writeFile(path.join(dataRoot, 'documents/手册/使用说明.md'), `# 使用说明

summary:: 独立文档目录中的文档。
`, 'utf8')
  const nestedDocumentDashboard = await getDashboard(managerRoot, root)
  assert(nestedDocumentDashboard.documents.some((note) => note.path === 'documents/手册/使用说明.md'), 'documents view should include nested documents folder files')
  assert(nestedDocumentDashboard.documents.some((note) => note.path === 'documents/手册/使用说明.md' && note.shortId === ''), 'nested documents should keep missing W ids during read')
  assert(nestedDocumentDashboard.documents.every((note) => note.version === ''), 'project documents should keep missing source versions during read')
  assert(nestedDocumentDashboard.documents[0]?.shortId === '', 'documents without ids should remain readable')

  await writeFile(path.join(knowledgeRoot, 'A 知识.md'), `# A 知识

summary:: 第一条知识。
`, 'utf8')
  await writeFile(path.join(knowledgeRoot, 'B 知识.md'), `# B 知识

summary:: 第二条知识。
`, 'utf8')
  const knowledgeOrderDashboard = await getDashboard(managerRoot, root)
  assert(knowledgeOrderDashboard.knowledge[0]?.shortId === '', 'knowledge should keep missing ids during read')
  assert(knowledgeOrderDashboard.knowledge[1]?.shortId === '', 'knowledge should keep missing ids during read')

  const knowledgeTarget = knowledgeOrderDashboard.knowledge[0].path
  const deletedKnowledgeDashboard = await deleteKnowledge(managerRoot, root, knowledgeTarget)
  assert(!deletedKnowledgeDashboard.knowledge.some((note) => note.path === knowledgeTarget), 'knowledge note should be deleted')

  const deletedManualDocumentDashboard = await deleteDocument(managerRoot, root, 'documents/项目手册.md')
  assert(!deletedManualDocumentDashboard.documents.some((note) => note.path === 'documents/项目手册.md'), 'project document should be deleted from dashboard')
  assert(!(await exists(manualPath)), 'project document file should be deleted')

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
  const recentTimes = new Map(recentProjects.map((project) => [project.projectId, project.lastOpenedAt]))
  const projectIndexBeforeGuidanceSync = await readFile(projectsIndexPath, 'utf8')
  await writeFile(skillPath, '# Stale project skill\n', 'utf8')
  const guidanceSyncResults = await updateAllProjectGuidance(managerRoot)
  assert(guidanceSyncResults.every((result) => result.status === 'updated'), 'startup guidance sync should update every managed project')
  assert((await readFile(skillPath, 'utf8')).includes('currentDataPaths'), 'startup guidance sync should replace stale project skills')
  const projectsAfterGuidanceSync = await listManagedProjects(managerRoot)
  assert(
    projectsAfterGuidanceSync.every((project) => project.lastOpenedAt === recentTimes.get(project.projectId)),
    'guidance sync should preserve recent-project open times',
  )
  assert(projectsAfterGuidanceSync[0].projectRoot === secondRoot, 'guidance sync should preserve recent-project ordering')
  assert(
    await readFile(projectsIndexPath, 'utf8') === projectIndexBeforeGuidanceSync,
    'guidance sync should preserve the projects index order and timestamps',
  )
  const removedRecentProjects = await removeManagedProject(managerRoot, recentProjects[0].projectId)
  assert(!removedRecentProjects.some((project) => project.projectRoot === secondRoot), 'removed project should leave recent list')
  assert(await exists(path.join(recentProjects[0].dataRoot, 'project.json')), 'removing history should not delete project data')

  const nextBrief = await refreshAgentBrief(managerRoot, root)
  assert(nextBrief.dataRoot === dataRoot, 'refresh should keep data root')

  const guidanceDashboard = await updateProjectGuidance(managerRoot, root)
  assert(guidanceDashboard.config.dataRoot === dataRoot, 'guidance update should keep data root')
  const updatedSkill = await readFile(skillPath, 'utf8')
  const updatedDataSpec = await readFile(path.join(dataRoot, 'collaboration/数据层规范.md'), 'utf8')
  assert(updatedSkill.includes('record_level:: light | standard | deep'), 'guidance update should refresh record levels')
  assert(updatedSkill.includes('Dxxx'), 'guidance update should refresh research rules')
  assert(updatedSkill.includes('Wxxx'), 'guidance update should refresh document rules')
  assert(updatedSkill.includes('Kxxx'), 'guidance update should refresh knowledge rules')
  assert(updatedSkill.includes('Cxxx'), 'guidance update should refresh constraint rules')
  assert(updatedSkill.includes('descending record ID'), 'guidance update should refresh record ordering writing rule')
  assert(updatedSkill.includes('questions append-only'), 'guidance update should refresh collaboration thread rules')
  assert(updatedSkill.includes('### 验收结果'), 'guidance update should refresh acceptance-result rules')
  assert(updatedSkill.includes('before execution and verification'), 'guidance update should refresh acceptance ordering rules')
  assert(updatedSkill.includes('mode:: breadth') && updatedSkill.includes('mode:: depth'), 'guidance update should refresh both research modes')
  assert(updatedSkill.includes('one L log'), 'guidance update should avoid duplicate research logs')
  assert(updatedDataSpec.includes('## Agent 工作记录格式'), 'guidance update should refresh data spec log format')
  const logFormatStart = updatedDataSpec.indexOf('## Agent 工作记录格式')
  const acceptanceIndex = updatedDataSpec.indexOf('### 验收标准', logFormatStart)
  const outputIndex = updatedDataSpec.indexOf('### 产出', logFormatStart)
  const verificationIndex = updatedDataSpec.indexOf('### 验证', logFormatStart)
  const acceptanceResultIndex = updatedDataSpec.indexOf('### 验收结果', logFormatStart)
  assert(
    logFormatStart >= 0
      && acceptanceIndex > logFormatStart
      && acceptanceIndex < outputIndex
      && verificationIndex < acceptanceResultIndex,
    'data spec should define acceptance before execution and acceptance results after verification',
  )
  assert(updatedDataSpec.includes('## 知识条目格式'), 'guidance update should refresh knowledge format')
  assert(updatedDataSpec.includes('## 研究格式'), 'guidance update should refresh research format')
  assert(updatedDataSpec.includes('open` 表示待用户回复'), 'data spec should define the next collaborator for open questions')
  assert(updatedDataSpec.includes('每次回复都追加'), 'data spec should preserve collaboration history')
  assert(updatedDataSpec.includes('Txxx') && updatedDataSpec.includes('Ixxx') && updatedDataSpec.includes('Dxxx') && updatedDataSpec.includes('Wxxx') && updatedDataSpec.includes('Kxxx') && updatedDataSpec.includes('Lxxx') && updatedDataSpec.includes('Cxxx'), 'data spec should describe descending record write order')
  assert(updatedDataSpec.includes('short_id:: W001'), 'data spec should describe document short ids')
  assert(updatedDataSpec.includes('short_id:: C001'), 'data spec should describe constraint short ids')
  assert(updatedDataSpec.includes('log_short_id:: L001'), 'data spec should describe explicit log short ids')
  assert(updatedDataSpec.includes('record_level:: standard'), 'data spec should describe log record levels')
  assert(updatedDataSpec.includes('light 文件修改记录只需保留'), 'data spec should describe lightweight logs')
  assert(updatedDataSpec.includes('待确认事项.md'), 'data spec should describe independent questions')
  assert(updatedDataSpec.includes('风险与后续.md'), 'data spec should separate risks and follow-ups')
  assert(updatedDataSpec.includes('version:: V001'), 'data spec should require version fields')
  assert(updatedDataSpec.includes('允许独立删除'), 'data spec should describe independent research-document deletion')
  assert(updatedDataSpec.includes('`breadth` 是广度研究'), 'data spec should define breadth research')
  assert(updatedDataSpec.includes('`depth` 是深度研究'), 'data spec should define depth research')
  assert(updatedDataSpec.includes('新建研究只创建 `status:: pending` 的 D 记录'), 'data spec should define lightweight research capture')

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
  assert(!(await exists(dialoguePath)), 'dashboard refresh should not create missing research notes')

  await rm(dialoguePath, { force: true })
  await updateProjectGuidance(managerRoot, root)
  assert(!(await exists(dialoguePath)), 'guidance update should not create missing research notes')

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
record_level:: standard

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

### 验收结果

部分通过：Smoke acceptance result.

### 已知风险

- Smoke risk.

### 未确认事项

- Legacy inline questions must not surface.
`, 'utf8')

  const logQuestionDashboard = await getDashboard(managerRoot, root)
  assert(logQuestionDashboard.openQuestions.length === 0, 'legacy inline questions should not surface in dashboard')
  const smokeLog = logQuestionDashboard.logs.find((log) => log.title.includes('Smoke work log'))
  assert(smokeLog?.outputs.includes('Smoke output.'), 'log outputs should be parsed')
  assert(smokeLog?.keySteps.includes('Smoke key step.'), 'log key steps should be parsed')
  assert(smokeLog?.acceptance.includes('Smoke acceptance.'), 'legacy acceptance ordering should remain parseable')
  assert(smokeLog?.acceptanceResult.includes('Smoke acceptance result.'), 'log acceptance results should be parsed')
  assert(smokeLog?.risks.includes('Smoke risk.'), 'log risks should be parsed')
  assert(smokeLog?.recordLevel === 'standard', 'log record level should be parsed')
  assert(smokeLog?.relatedTasks.length === 1 && smokeLog.relatedTasks[0].shortId === 'T001', 'log should expose explicit task_short_id relation')

  const taskDashboard = await appendTask(managerRoot, root, {
    title: 'Smoke Task',
    status: 'todo',
  })
  const smokeTask = taskDashboard.tasks.find((task) => task.title === 'Smoke Task')
  assert(smokeTask, 'new task should be appended')
  assert(smokeTask.version === 'V001', 'new task should inherit the current version')
  assert(taskDashboard.activeTasks.length === 1, 'todo task should be active')
  assert(taskDashboard.openQuestions.length === 0, 'new task should not create an implicit collaboration thread')

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
  assert(taskQuestion.origin === 'agent', 'agent-created question should preserve its origin')
  assert(taskQuestion.messages.length === 1 && taskQuestion.messages[0].role === 'agent', 'new agent question should start an append-only thread')

  const repliedTaskDashboard = await replyOpenQuestion(managerRoot, root, {
    questionId: taskQuestion.id,
    answer: 'Smoke task answer.',
  })
  const repliedTaskQuestion = repliedTaskDashboard.questions.find((item) => item.id === taskQuestion.id)
  assert(!repliedTaskDashboard.openQuestions.some((item) => item.id === taskQuestion.id), 'decided question should leave the pending-user list')
  assert(repliedTaskQuestion?.status === 'decided', 'user reply should move the thread to the Agent queue')
  assert(repliedTaskQuestion?.messages.length === 2 && repliedTaskQuestion.messages[1].content === 'Smoke task answer.', 'user reply should append without replacing the original message')
  assert(repliedTaskDashboard.agentBrief.pendingDecisions.some((item) => item.id === taskQuestion.id), 'decided question should be exposed as pending implementation')

  const resolvedQuestionDashboard = await updateQuestionStatus(managerRoot, root, taskQuestion.id, 'resolved')
  assert(resolvedQuestionDashboard.questions.some((item) => item.id === taskQuestion.id && item.status === 'resolved'), 'completed thread should become resolved')
  assert(!resolvedQuestionDashboard.agentBrief.pendingDecisions.some((item) => item.id === taskQuestion.id), 'resolved decision should leave pending implementation')

  const reopenedQuestionDashboard = await replyOpenQuestion(managerRoot, root, {
    questionId: taskQuestion.id,
    answer: 'Follow-up after completion.',
  })
  const reopenedQuestion = reopenedQuestionDashboard.questions.find((item) => item.id === taskQuestion.id)
  assert(reopenedQuestion?.status === 'decided', 'replying to history should reopen the thread in the Agent queue')
  assert(reopenedQuestion?.messages.length === 3 && reopenedQuestion.messages[2].content === 'Follow-up after completion.', 'history follow-up should append to the existing thread')
  await updateQuestionStatus(managerRoot, root, taskQuestion.id, 'resolved')

  const userQuestionDashboard = await appendProjectQuestion(managerRoot, root, {
    title: 'User-started thread',
    question: 'Please follow up on this request.',
    kind: 'clarification',
    origin: 'user',
  })
  const userQuestion = userQuestionDashboard.questions.find((item) => item.title === 'User-started thread')
  assert(userQuestion?.status === 'decided' && userQuestion.origin === 'user', 'user-created thread should immediately enter the Agent queue')
  assert(userQuestion?.messages.length === 1 && userQuestion.messages[0].role === 'user', 'user-created thread should preserve the initial user message')
  assert(userQuestionDashboard.agentBrief.pendingDecisions.some((item) => item.id === userQuestion?.id), 'user-created thread should be present in the Agent brief')
  await updateQuestionStatus(managerRoot, root, userQuestion.id, 'resolved')

  const questionsBeforeLegacyRecord = await readFile(questionsPath, 'utf8')
  const legacyQuestionEntry = `## Legacy question

id:: question-legacy
short_id:: Q003
type:: question
status:: resolved
kind:: decision
scope:: version
version:: V001
blocking:: no
created:: 2026-07-01 09:00
updated:: 2026-07-01 09:30
source_refs:: 无

### 问题

Legacy question content.

### 背景

无。

### 建议

无。

### 结论

Legacy answer.
`
  const firstQuestionIndex = questionsBeforeLegacyRecord.indexOf('\n\n## ')
  const questionsWithLegacyRecord = firstQuestionIndex >= 0
    ? `${questionsBeforeLegacyRecord.slice(0, firstQuestionIndex)}\n\n${legacyQuestionEntry.trim()}\n${questionsBeforeLegacyRecord.slice(firstQuestionIndex)}`
    : `${questionsBeforeLegacyRecord.trimEnd()}\n\n${legacyQuestionEntry}`
  await writeFile(questionsPath, questionsWithLegacyRecord, 'utf8')
  const normalizedLegacyDashboard = await getDashboard(managerRoot, root)
  const normalizedLegacyQuestion = normalizedLegacyDashboard.questions.find((item) => item.id === 'question-legacy')
  assert(normalizedLegacyQuestion?.origin === 'agent', 'legacy questions should remain readable with a display fallback')
  assert(normalizedLegacyQuestion?.messages.length === 0, 'legacy questions should not synthesize a conversation thread during read')
  assert(normalizedLegacyQuestion?.relations.length === 0, 'placeholder relation values should not appear as real references')
  const normalizedQuestionsContent = await readFile(questionsPath, 'utf8')
  assert(normalizedQuestionsContent.includes(legacyQuestionEntry.trim()), 'legacy question Markdown should remain unchanged during read')

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

  const researchDocumentCountBefore = headingDashboard.documents.length
  const researchLogCountBefore = headingDashboard.logs.length
  const dialogueDashboard = await appendDialogue(managerRoot, root, {
    content: 'Smoke research record',
    acceptance: 'Smoke acceptance',
  })
  const smokeDialogue = dialogueDashboard.dialogues.find((dialogue) => dialogue.recordContent === 'Smoke research record')
  assert(smokeDialogue?.shortId.startsWith('D'), 'research record should be appended with D short id')
  assert(smokeDialogue.mode === 'breadth', 'research should default to breadth mode')
  assert(smokeDialogue.status === 'pending', 'new research should enter the pending queue')
  assert(dialogueDashboard.dialogues[0]?.shortId === smokeDialogue.shortId, 'newest research record should appear first')
  assert(smokeDialogue.relatedDocuments.length === 0, 'new research should not create a document before completion')
  assert(smokeDialogue.answer === '待研究。', 'new research should expose a pending answer')
  assert(dialogueDashboard.documents.length === researchDocumentCountBefore, 'saving research should not add a W document')
  assert(dialogueDashboard.logs.length === researchLogCountBefore, 'saving research should not add an L work log')
  assert(dialogueDashboard.agentBrief.activeResearch.some((dialogue) => dialogue.id === smokeDialogue.id), 'pending research should enter the Agent brief queue')
  assert(!dialogueDashboard.thoughts.some((thought) => thought.content === 'Smoke research record'), 'research record should not be appended as thought')
  const dialogueContent = await readFile(v2DialoguePath, 'utf8')
  assert(dialogueContent.includes('type:: dialogue'), 'new research record should include dialogue type')
  assert(dialogueContent.includes('status:: pending'), 'new research record should persist pending status')
  assert(dialogueContent.includes('related_documents:: 无'), 'new research record should persist an empty document relation')
  assert(dialogueContent.includes('mode:: breadth'), 'new research record should persist breadth mode')
  assert(dialogueContent.includes('### 内容'), 'new research record should include content section')
  assert(dialogueContent.includes('### 回答'), 'new research record should include answer section')
  assert(dialogueContent.includes('### 验收标准'), 'new research record should include acceptance section')

  await writeFile(v2DialoguePath, dialogueContent.replace('mode:: breadth', 'mode:: research'), 'utf8')
  const legacyModeDashboard = await getDashboard(managerRoot, root)
  assert(
    legacyModeDashboard.dialogues.find((dialogue) => dialogue.id === smokeDialogue.id)?.mode === 'legacy',
    'legacy research mode should remain readable as an unclassified display value',
  )
  assert((await readFile(v2DialoguePath, 'utf8')).includes('mode:: research'), 'legacy research mode should remain unchanged during read')

  const cascadeDialogueDashboard = await appendDialogue(managerRoot, root, {
    content: 'Smoke cascade research record',
    mode: 'depth',
  })
  const cascadeDialogue = cascadeDialogueDashboard.dialogues.find((dialogue) => dialogue.recordContent === 'Smoke cascade research record')
  assert(cascadeDialogue.mode === 'depth', 'depth research should preserve its explicit mode')
  assert(cascadeDialogue.status === 'pending', 'depth research should enter the pending queue')
  assert(cascadeDialogue.acceptance === '按深度研究默认标准执行。', 'depth research should use a compact default-standard reference')
  assert(cascadeDialogue.relatedDocuments.length === 0, 'depth research should not create a document before completion')
  assert(cascadeDialogueDashboard.documents.length === researchDocumentCountBefore, 'multiple research requests should not fragment documents')
  assert(cascadeDialogueDashboard.logs.length === researchLogCountBefore, 'multiple research requests should not fragment work logs')
  assert(cascadeDialogueDashboard.agentBrief.activeResearch.length === 2, 'both pending research requests should be exposed to the Agent')
  const deletedDialogueDashboard = await deleteDialogue(managerRoot, root, cascadeDialogue.id)
  assert(!deletedDialogueDashboard.dialogues.some((dialogue) => dialogue.id === cascadeDialogue.id), 'research record should be deleted')
  assert(deletedDialogueDashboard.documents.length === researchDocumentCountBefore, 'deleting pending research should not affect documents')

  console.log('smoke test passed')
} finally {
  await rm(root, { recursive: true, force: true })
  await rm(secondRoot, { recursive: true, force: true })
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
