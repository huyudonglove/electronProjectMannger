import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  appendTask,
  appendDialogue,
  appendThought,
  deleteTask,
  deleteThought,
  initProject,
  getDashboard,
  listManagedProjects,
  removeManagedProject,
  replyOpenQuestion,
  refreshAgentBrief,
  updateProjectGuidance,
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
  const knowledgePath = path.join(dataRoot, '01_知识结构/知识结构.md')
  const codeIndexPath = path.join(dataRoot, '01_知识结构/代码索引.md')
  const dialoguePath = path.join(dataRoot, '04_记录库/研究.md')
  const projectsIndexPath = path.join(managerRoot, 'projects.json')

  const brief = JSON.parse(await readFile(briefPath, 'utf8'))
  assert(brief.projectRoot === root, 'brief should point to project root')
  assert(Array.isArray(brief.instructions), 'brief instructions should exist')

  const skill = await readFile(skillPath, 'utf8')
  assert(skill.includes('Project Collaboration Skill'), 'local skill should exist')
  assert(skill.includes('Do not omit required agent-log sections'), 'local skill should require explicit agent log sections')
  assert(skill.includes('04_记录库/研究.md'), 'local skill should describe research notes')
  assert(await exists(dialoguePath), 'research notes should be initialized')
  const initialDialogues = dashboard.dialogues
  assert(initialDialogues.some((dialogue) => dialogue.shortId === 'D001'), 'initial research record should expose D001')
  assert(dashboard.knowledge.some((note) => note.shortId === 'K001'), 'initial knowledge note should expose K001')
  assert(dashboard.documents.some((note) => note.path === '01_知识结构/知识结构.md'), 'dashboard should expose document index')

  await writeFile(codeIndexPath, `# 代码索引

> 旧知识文档缺字段时应被补齐。
`, 'utf8')
  const normalizedKnowledgeDashboard = await getDashboard(managerRoot, root)
  const normalizedCodeIndex = await readFile(codeIndexPath, 'utf8')
  assert(normalizedKnowledgeDashboard.knowledge.some((note) => note.path === '01_知识结构/代码索引.md' && /^K\d{3}$/.test(note.shortId)), 'missing knowledge fields should be written and exposed')
  assert(normalizedCodeIndex.includes('type:: knowledge'), 'missing knowledge type field should be backfilled')
  assert(normalizedCodeIndex.includes('summary::'), 'missing knowledge summary field should be backfilled')

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
  const updatedDataSpec = await readFile(path.join(dataRoot, '00_项目管理/数据层规范.md'), 'utf8')
  assert(updatedSkill.includes('Do not omit required agent-log sections'), 'guidance update should refresh skill rules')
  assert(updatedSkill.includes('Dxxx'), 'guidance update should refresh research rules')
  assert(updatedSkill.includes('Kxxx'), 'guidance update should refresh knowledge rules')
  assert(updatedDataSpec.includes('## Agent 工作记录格式'), 'guidance update should refresh data spec log format')
  assert(updatedDataSpec.includes('## 知识条目格式'), 'guidance update should refresh knowledge format')
  assert(updatedDataSpec.includes('## 研究格式'), 'guidance update should refresh research format')

  await rm(dialoguePath, { force: true })
  const missingDialogueDashboard = await getDashboard(managerRoot, root)
  assert(missingDialogueDashboard.dialogues.some((dialogue) => dialogue.shortId === 'D001'), 'dashboard should expose default research record when missing')
  assert(await exists(dialoguePath), 'dashboard refresh should backfill missing research notes')

  await rm(dialoguePath, { force: true })
  await updateProjectGuidance(managerRoot, root)
  assert(await exists(dialoguePath), 'guidance update should backfill missing research notes')

  const nextDashboard = await getDashboard(managerRoot, root)
  assert(nextDashboard.activeTasks.length === 0, 'initial done task should not be active')
  assert(nextDashboard.logs.some((log) => log.content.includes('初始化项目协作数据')), 'dashboard should expose log detail content')

  const logPath = path.join(dataRoot, '04_记录库/Agent 工作记录.md')
  const currentLog = await readFile(logPath, 'utf8')
  await writeFile(logPath, `${currentLog.trimEnd()}

## 2026-06-30 23:35 General log without task

type:: agent-log
created:: 2026-06-30 23:35

### 用户目标

This general log should stay out of the worklog panel.
`, 'utf8')
  const fallbackLogDashboard = await getDashboard(managerRoot, root)
  const fallbackLog = fallbackLogDashboard.logs.find((log) => log.title.includes('General log without task'))
  assert(fallbackLog, 'logs without task relation should remain visible')
  assert(fallbackLog.relatedTasks.some((task) => task.shortId === 'T000'), 'logs without task relation should expose T000 fallback')

  const currentFilteredLog = await readFile(logPath, 'utf8')
  await writeFile(logPath, `${currentFilteredLog.trimEnd()}

## 2026-06-30 23:38 Legacy work log with text task ref

type:: agent-log
created:: 2026-06-30 23:38

### 用户目标

Legacy T001 log should stay visible.

### 需求理解

Legacy logs may only mention the task short id in content.
`, 'utf8')
  const legacyLogDashboard = await getDashboard(managerRoot, root)
  const legacyLog = legacyLogDashboard.logs.find((log) => log.title.includes('Legacy work log with text task ref'))
  assert(legacyLog, 'legacy logs with text task refs should be visible')
  assert(legacyLog.relatedTasks.some((task) => task.shortId === 'T001'), 'legacy log should expose text task ref')

  const currentLegacyReplyLog = await readFile(logPath, 'utf8')
  await writeFile(logPath, `${currentLegacyReplyLog.trimEnd()}

## 2026-07-01 11:19 Legacy reply format

type:: agent-log
created:: 2026-07-01 11:19
task_short_id:: T001

### 用户目标

Legacy reply format should parse.

### 回答记录

- 2026-07-01 11:19 回复：无
`, 'utf8')
  const legacyReplyDashboard = await getDashboard(managerRoot, root)
  const legacyReply = legacyReplyDashboard.replyRecords.find((item) => item.title.includes('Legacy reply format'))
  assert(legacyReply?.openQuestions === '暂无内容', 'legacy reply without question should expose fallback detail')
  assert(legacyReply?.displayId === 'Q000', 'legacy reply without question id should expose Q000 fallback')
  assert(legacyReply?.replyCreated === '2026-07-01 11:19', 'legacy reply should expose reply time')
  assert(legacyReply?.replyAnswer === '无', 'legacy reply should expose reply answer')

  const currentLegacyLog = await readFile(logPath, 'utf8')
  await writeFile(logPath, `${currentLegacyLog.trimEnd()}

## 2026-06-30 23:40 Smoke work log

type:: agent-log
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
  assert(smokeLog?.relatedTasks.length === 1 && smokeLog.relatedTasks[0].shortId === 'T001', 'explicit task_short_id should take precedence over text refs')

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

  const thoughtPath = path.join(dataRoot, '04_记录库/想法与问题.md')
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
  const thoughtsContent = await readFile(path.join(dataRoot, '04_记录库/想法与问题.md'), 'utf8')
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
  assert(!dialogueDashboard.thoughts.some((thought) => thought.content === 'Smoke research record'), 'research record should not be appended as thought')
  const dialogueContent = await readFile(dialoguePath, 'utf8')
  assert(dialogueContent.includes('type:: dialogue'), 'new research record should include dialogue type')
  assert(dialogueContent.includes('### 内容'), 'new research record should include content section')
  assert(dialogueContent.includes('### 回答'), 'new research record should include answer section')
  assert(dialogueContent.includes('### 验收标准'), 'new research record should include acceptance section')

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

async function ignoredCollaborationEntries(projectRoot) {
  const gitignore = await readFile(path.join(projectRoot, '.gitignore'), 'utf8')
  return gitignore.split(/\r?\n/).filter((line) => line.trim() === '.agent-collaboration.md').length
}
