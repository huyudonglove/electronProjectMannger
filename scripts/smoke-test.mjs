import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  appendTask,
  appendDialogue,
  appendConstraint,
  appendThought,
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
  updateTaskStatus,
} from '../packages/project-core/dist/index.js'

const managerRoot = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-data-'))
const root = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-project-'))
const secondRoot = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-project-'))
const legacyRoot = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-legacy-project-'))

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

  const dashboard = await initProject(managerRoot, root, 'Smoke Project')
  assert(dashboard.config.name === 'Smoke Project', 'project name should be set')
  assert(dashboard.config.projectId.startsWith('smoke-project-'), 'project id should include name slug')
  assert(dashboard.tasks.length === 1, 'initial task should exist')

  const dataRoot = dashboard.config.dataRoot
  const briefPath = path.join(dataRoot, 'agent-brief.json')
  const skillPath = path.join(dataRoot, 'skills/project-collaboration/SKILL.md')
  const taskPath = path.join(dataRoot, 'tasks/工程任务.md')
  const thoughtPath = path.join(dataRoot, 'thoughts/想法与问题.md')
  const logPath = path.join(dataRoot, 'work-logs/Agent 工作记录.md')
  const knowledgeRoot = path.join(managerRoot, 'knowledge')
  const knowledgePath = path.join(knowledgeRoot, '知识结构.md')
  const manualPath = path.join(dataRoot, 'documents/项目手册.md')
  const dialoguePath = path.join(dataRoot, 'research/研究.md')
  const constraintsPath = path.join(dataRoot, 'constraints/项目约束.md')
  const projectsIndexPath = path.join(managerRoot, 'projects.json')

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
  assert(skill.includes('research/研究.md'), 'local skill should describe research notes')
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
  await assertRejects(() => replyOpenQuestion(managerRoot, root, { openQuestions: '', answer: 'Smoke answer' }), '未确认事项不能为空')
  await assertRejects(() => replyOpenQuestion(managerRoot, root, { openQuestions: 'Smoke question', answer: '' }), '回复内容不能为空')
  await assertRejects(() => updateReplyRecord(managerRoot, root, { questionId: '', openQuestions: 'Smoke question', answer: 'Smoke answer' }), '回复 ID 不能为空')
  await assertRejects(() => updateReplyRecord(managerRoot, root, { questionId: 'missing-reply', openQuestions: 'Smoke question', answer: '' }), '回复内容不能为空')
  await assertRejects(() => removeManagedProject(managerRoot, ''), '项目 ID 不能为空')

  await writeFile(manualPath, `# 项目手册

summary:: 独立文档目录中的文档样例。
`, 'utf8')
  const normalizedKnowledgeDashboard = await getDashboard(managerRoot, root)
  const normalizedManual = normalizedKnowledgeDashboard.documents.find((note) => note.path === 'documents/项目手册.md')
  assert(normalizedManual?.shortId === 'W001', 'project documents should expose W short ids')
  assert((await readFile(manualPath, 'utf8')).includes('short_id:: W001'), 'project document file should be normalized with W short id')
  assert(!normalizedKnowledgeDashboard.knowledge.some((note) => note.path === 'documents/项目手册.md'), 'project document files should not be exposed as global knowledge')
  assert(!normalizedKnowledgeDashboard.documents.some((note) => note.path.startsWith('tasks/') || note.path.startsWith('thoughts/') || note.path.startsWith('research/') || note.path.startsWith('collaboration/') || note.path.startsWith('work-logs/')), 'project documents should not aggregate module data files')

  await mkdir(path.join(dataRoot, 'documents/手册'), { recursive: true })
  await writeFile(path.join(dataRoot, 'documents/手册/使用说明.md'), `# 使用说明

summary:: 独立文档目录中的文档。
`, 'utf8')
  const nestedDocumentDashboard = await getDashboard(managerRoot, root)
  assert(nestedDocumentDashboard.documents.some((note) => note.path === 'documents/手册/使用说明.md'), 'documents view should include nested documents folder files')
  assert(nestedDocumentDashboard.documents.some((note) => note.path === 'documents/手册/使用说明.md' && note.shortId === 'W002'), 'nested documents should get independent W short ids')
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
  assert(updatedDataSpec.includes('允许独立删除'), 'data spec should describe independent research-document deletion')

  const constraintDashboard = await appendConstraint(managerRoot, root, {
    title: 'Smoke Constraint',
    content: 'All agents should preserve smoke constraints.',
  })
  const smokeConstraint = constraintDashboard.constraints.find((constraint) => constraint.title === 'Smoke Constraint')
  assert(smokeConstraint?.shortId === 'C001', 'manual constraint should use C short ids')
  assert(smokeConstraint.source === 'user', 'manual constraint should be user sourced')
  assert(constraintDashboard.constraints.some((constraint) => constraint.source === 'system'), 'constraints dashboard should keep system constraints')
  const persistedConstraintContent = await readFile(constraintsPath, 'utf8')
  assert(persistedConstraintContent.includes('short_id:: C001'), 'manual constraint should be written to constraints file')
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

### 用户目标

Smoke log question should surface.

### 需求理解

Smoke understanding.

### 产出

- Smoke output.

### 关键步骤

- Smoke key step.

### 验收标准

- Smoke acceptance.

### 未确认事项

- Smoke unresolved question.

## 2026-06-30 23:41 Smoke newer work log

type:: agent-log
log_short_id:: L902
created:: 2026-06-30 23:41
task_short_id:: T001
status:: done

### 用户目标

Smoke newer goal.

### 需求理解

Smoke newer understanding.

### 产出

- Smoke newer output.

### 验证

- Smoke newer verification.

### 验收标准

- Smoke newer acceptance.

### 未确认事项

- Smoke newer unresolved question.
`, 'utf8')

  const logQuestionDashboard = await getDashboard(managerRoot, root)
  assert(logQuestionDashboard.openQuestions.some((item) => item.source === 'log' && item.openQuestions === 'Smoke unresolved question.'), 'log open question should surface in dashboard')
  const logOpenQuestion = logQuestionDashboard.openQuestions.find((item) => item.source === 'log' && item.openQuestions === 'Smoke unresolved question.')
  const newerLogOpenQuestion = logQuestionDashboard.openQuestions.find((item) => item.source === 'log' && item.openQuestions === 'Smoke newer unresolved question.')
  assert(/^Q\d{3}-[A-F0-9]{4}$/.test(logOpenQuestion?.id || ''), 'log open question should have independent id')
  assert(newerLogOpenQuestion?.displayId > logOpenQuestion.displayId, 'newer open question should have larger Q display id')
  assert(logOpenQuestion.displayId === logOpenQuestion.id.slice(0, 4), 'log open question should have short display id')
  assert(/^L\d{3}$/.test(logOpenQuestion.shortId), 'log open question should expose log short id')
  assert(logOpenQuestion.created === '2026-06-30 23:40', 'log open question should expose created time')
  assert(logOpenQuestion.relations.includes(logOpenQuestion.shortId) && !logOpenQuestion.relations.includes('工作记录'), 'log open question should expose log id relation')
  const smokeLog = logQuestionDashboard.logs.find((log) => log.title.includes('Smoke work log'))
  assert(smokeLog?.outputs.includes('Smoke output.'), 'log outputs should be parsed')
  assert(smokeLog?.keySteps.includes('Smoke key step.'), 'log key steps should be parsed')
  assert(smokeLog?.relatedTasks.length === 1 && smokeLog.relatedTasks[0].shortId === 'T001', 'log should expose explicit task_short_id relation')

  const repliedLogDashboard = await replyOpenQuestion(managerRoot, root, {
    questionId: logOpenQuestion.id,
    source: 'log',
    title: '2026-06-30 23:40 Smoke work log',
    openQuestions: 'Smoke unresolved question.',
    answer: 'Smoke log answer.',
  })
  assert(!repliedLogDashboard.openQuestions.some((item) => item.openQuestions === 'Smoke unresolved question.'), 'replied log question should be resolved')
  assert(repliedLogDashboard.logs.find((log) => log.title.includes('Smoke work log'))?.content.includes('Smoke log answer.'), 'log reply should be recorded')
  assert(repliedLogDashboard.replyRecords.some((item) => item.source === 'log' && item.questionId === logOpenQuestion.id && item.reply.includes('Smoke log answer.')), 'log reply should appear in reply records')
  assert(repliedLogDashboard.replyRecords.some((item) => item.source === 'log' && item.openQuestions === 'Smoke unresolved question.'), 'log reply should expose original question detail')
  assert(repliedLogDashboard.replyRecords.some((item) => item.displayId === logOpenQuestion.displayId && item.relations.includes(logOpenQuestion.shortId)), 'log reply should expose display id and log relation')

  const taskDashboard = await appendTask(managerRoot, root, {
    title: 'Smoke Task',
    status: 'todo',
    openQuestions: 'Smoke task question.',
  })
  const smokeTask = taskDashboard.tasks.find((task) => task.title === 'Smoke Task')
  assert(smokeTask, 'new task should be appended')
  assert(taskDashboard.activeTasks.length === 1, 'todo task should be active')
  assert(taskDashboard.openQuestions.some((item) => item.source === 'task' && item.openQuestions === 'Smoke task question.'), 'task open question should surface')
  const taskOpenQuestion = taskDashboard.openQuestions.find((item) => item.source === 'task' && item.openQuestions === 'Smoke task question.')
  assert(/^Q\d{3}-[A-F0-9]{4}$/.test(taskOpenQuestion?.id || ''), 'task open question should have independent id')
  assert(taskOpenQuestion.displayId === taskOpenQuestion.id.slice(0, 4), 'task open question should have short display id')
  assert(taskOpenQuestion.created, 'task open question should expose created time')
  assert(taskOpenQuestion.relations.includes(smokeTask.shortId), 'task open question should expose task relation')

  const repliedTaskDashboard = await replyOpenQuestion(managerRoot, root, {
    questionId: taskOpenQuestion.id,
    source: 'task',
    shortId: smokeTask.shortId,
    openQuestions: 'Smoke task question.',
    answer: 'Smoke task answer.',
  })
  assert(!repliedTaskDashboard.openQuestions.some((item) => item.openQuestions === 'Smoke task question.'), 'replied task question should be resolved')
  assert(repliedTaskDashboard.replyRecords.some((item) => item.source === 'task' && item.questionId === taskOpenQuestion.id && item.reply.includes('Smoke task answer.')), 'task reply should appear in reply records')
  assert(repliedTaskDashboard.replyRecords.some((item) => item.source === 'task' && item.openQuestions === 'Smoke task question.'), 'task reply should expose original question detail')
  assert(repliedTaskDashboard.replyRecords.some((item) => item.displayId === taskOpenQuestion.displayId && item.relations.includes(smokeTask.shortId)), 'task reply should expose display id and relations')
  const editedTaskReplyDashboard = await updateReplyRecord(managerRoot, root, {
    questionId: taskOpenQuestion.id,
    source: 'task',
    shortId: smokeTask.shortId,
    openQuestions: 'Smoke task question.',
    answer: 'Smoke task answer edited.',
  })
  const editedTaskReplies = editedTaskReplyDashboard.replyRecords.filter((item) => item.questionId === taskOpenQuestion.id)
  assert(editedTaskReplies.length === 1, 'editing a reply should replace the existing record')
  assert(editedTaskReplies[0].replyAnswer === 'Smoke task answer edited.', 'edited reply should expose updated answer')
  assert(!editedTaskReplies[0].reply.includes('Smoke task answer. 回复'), 'edited reply should not append a second answer')

  const currentThoughts = await readFile(thoughtPath, 'utf8')
  await writeFile(thoughtPath, `${currentThoughts.trimEnd()}

## 2026-06-30 23:42 Smoke thought question

id:: thought-smoke-question
short_id:: I999
status:: inbox
type:: thought
created:: 2026-06-30 23:42

### 内容

Smoke thought with open question.

### 回答

待整理。

### 未确认事项

- Smoke thought question.
`, 'utf8')
  const thoughtQuestionDashboard = await getDashboard(managerRoot, root)
  const thoughtOpenQuestion = thoughtQuestionDashboard.openQuestions.find((item) => item.source === 'thought' && item.openQuestions === 'Smoke thought question.')
  assert(/^Q\d{3}-[A-F0-9]{4}$/.test(thoughtOpenQuestion?.id || ''), 'thought open question should have independent id')
  assert(thoughtOpenQuestion.shortId === 'I999', 'thought open question should expose thought short id')
  assert(thoughtOpenQuestion.created === '2026-06-30 23:42', 'thought open question should expose created time')
  assert(thoughtOpenQuestion.relations.includes('I999') && thoughtOpenQuestion.relations.includes('想法'), 'thought open question should expose thought relations')

  const repliedThoughtDashboard = await replyOpenQuestion(managerRoot, root, {
    questionId: thoughtOpenQuestion.id,
    source: 'thought',
    shortId: 'I999',
    thoughtId: 'thought-smoke-question',
    title: '2026-06-30 23:42 Smoke thought question',
    openQuestions: 'Smoke thought question.',
    answer: 'Smoke thought answer.',
  })
  assert(!repliedThoughtDashboard.openQuestions.some((item) => item.openQuestions === 'Smoke thought question.'), 'replied thought question should be resolved')
  assert(repliedThoughtDashboard.replyRecords.some((item) => item.source === 'thought' && item.questionId === thoughtOpenQuestion.id && item.reply.includes('Smoke thought answer.')), 'thought reply should appear in reply records')
  assert(repliedThoughtDashboard.replyRecords.some((item) => item.source === 'thought' && item.openQuestions === 'Smoke thought question.'), 'thought reply should expose original question detail')
  assert(repliedThoughtDashboard.replyRecords.some((item) => item.displayId === thoughtOpenQuestion.displayId && item.relations.includes('I999')), 'thought reply should expose display id and relations')

  const doneDashboard = await updateTaskStatus(managerRoot, root, smokeTask.id, 'done')
  assert(doneDashboard.activeTasks.length === 0, 'done task should not be active')

  const deletedTaskDashboard = await deleteTask(managerRoot, root, smokeTask.id)
  assert(!deletedTaskDashboard.tasks.some((task) => task.id === smokeTask.id), 'task should be deleted')

  const thoughtDashboard = await appendThought(managerRoot, root, 'Smoke thought')
  const smokeThought = thoughtDashboard.thoughts.find((thought) => thought.content === 'Smoke thought')
  assert(smokeThought, 'thought should be appended')
  const thoughtsContent = await readFile(path.join(dataRoot, 'thoughts/想法与问题.md'), 'utf8')
  assert(thoughtsContent.includes('### 回答'), 'new thoughts should include answer section')
  assert(thoughtsContent.includes('### 未确认事项'), 'new thoughts should include open question section')
  assert(thoughtsContent.includes('暂无。'), 'new thoughts should use explicit empty answer placeholder')

  const deletedThoughtDashboard = await deleteThought(managerRoot, root, smokeThought.id)
  assert(!deletedThoughtDashboard.thoughts.some((thought) => thought.id === smokeThought.id), 'thought should be deleted')

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
  assert(researchDocument?.content.includes('Smoke short reply'), 'research detail should be written to document')
  assert(researchDocument?.content.includes('Smoke Acceptance') || researchDocument?.content.includes('Smoke acceptance'), 'research document should include acceptance')
  assert(dialogueDashboard.logs.some((log) => log.source === 'research' && log.content.includes(smokeDialogue.shortId) && log.content.includes(researchDocument.shortId)), 'research action should be written to work logs')
  const dialogueContent = await readFile(dialoguePath, 'utf8')
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
