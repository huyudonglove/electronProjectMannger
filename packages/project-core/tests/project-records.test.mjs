import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  appendConstraint,
  appendDialogue,
  appendProjectQuestion,
  appendTask,
  appendThought,
  createProjectVersion,
  getDashboard,
  initProject,
  isInitialized,
  replyOpenQuestion,
  updateDialogueStatus,
  updateProjectMetadata,
  updateProjectRecord,
  updateProjectVersionStatus,
  updateTaskStatus,
  updateThoughtStatus,
} from '../dist/index.js'

test('project records initialize without Agent runtime artifacts', async (t) => {
  const managerRoot = await mkdtemp(path.join(os.tmpdir(), 'project-records-data-'))
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'project-records-project-'))
  t.after(async () => {
    await rm(managerRoot, { recursive: true, force: true })
    await rm(projectRoot, { recursive: true, force: true })
  })

  const dashboard = await initProject(managerRoot, projectRoot, 'Records')
  assert.equal(dashboard.recordSummary.dataRoot, dashboard.config.dataRoot)
  assert.equal(await exists(path.join(dashboard.config.dataRoot, 'record-summary.json')), true)
  assert.equal(await exists(path.join(dashboard.config.dataRoot, 'agent-brief.json')), false)
  assert.equal(await exists(path.join(projectRoot, '.agent-collaboration.md')), false)

  const skillPath = path.join(dashboard.config.dataRoot, 'skills/project-records/SKILL.md')
  const persistedSummary = JSON.parse(await readFile(path.join(dashboard.config.dataRoot, 'record-summary.json'), 'utf8'))
  const skill = await readFile(skillPath, 'utf8')
  assert.equal(dashboard.recordSummary.recordSkillPath, skillPath)
  assert.equal(persistedSummary.recordSkillPath, skillPath)
  assert.match(skill, /^---\nname: project-records\ndescription: .+\n---\n/)
  assert.match(skill, /record-summary\.json/)
  assert.match(skill, /currentDataPaths/)
  assert.match(skill, /choose and verify an explicit `versionId`/)
  assert.match(skill, /do not infer it from the newest version/)
  assert.match(skill, /type:: work-log/)
  for (const prefix of ['T', 'I', 'D', 'Q', 'R', 'L', 'C', 'W', 'K', 'V']) {
    assert.match(skill, new RegExp(`- ${prefix} records are`))
  }
  assert.match(skill, /Preserve completed-version and historical Markdown verbatim/)
  assert.match(skill, /preserve unrelated records and user changes/)
  assert.match(skill, /re-read the target Markdown and .+record-counters\.json/)
  assert.match(skill, /set its T record to `doing`/)
  assert.match(skill, /verification succeeds, set it to `done` and write one L work log/)
  assert.match(skill, /task_short_id:: T000/)
  assert.match(skill, /Do not write while Telance Records or another agent is changing/)
  assert.doesNotMatch(skill, /\b(?:Chat|model|Run|approval)\b|task[ -]tree|delegat/i)

  await writeFile(skillPath, '# stale\n', 'utf8')
  await updateProjectMetadata(managerRoot, projectRoot)
  const refreshedSkill = await readFile(skillPath, 'utf8')
  assert.match(refreshedSkill, /^---\nname: project-records\n/)
  assert.notEqual(refreshedSkill, '# stale\n')

  const next = await appendTask(managerRoot, projectRoot, { title: 'Record task' })
  const task = next.tasks.find((item) => item.title === 'Record task')
  assert.ok(task)
  assert.equal('parentId' in task, false)
  assert.equal('contextId' in task, false)
  assert.equal('messages' in task, false)
})

test('versions have independent states and explicit record targets', async (t) => {
  const managerRoot = await mkdtemp(path.join(os.tmpdir(), 'project-records-data-'))
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'project-records-project-'))
  t.after(async () => {
    await rm(managerRoot, { recursive: true, force: true })
    await rm(projectRoot, { recursive: true, force: true })
  })

  const initial = await initProject(managerRoot, projectRoot, 'Versioned Records')
  const created = await createProjectVersion(managerRoot, projectRoot, {
    label: 'Next',
    title: 'Next version',
    goal: 'Keep versions independent',
  })

  assert.equal(created.config.currentVersionId, 'V002')
  assert.equal(created.versions.find((item) => item.shortId === 'V001')?.status, 'active')
  assert.equal(created.versions.find((item) => item.shortId === 'V002')?.status, 'planned')

  await appendTask(managerRoot, projectRoot, { versionId: 'V001', title: 'Task in V001' })
  await appendThought(managerRoot, projectRoot, { versionId: 'V001', content: 'Idea in V001' })
  await appendDialogue(managerRoot, projectRoot, { versionId: 'V001', content: 'Research in V001' })
  await appendConstraint(managerRoot, projectRoot, {
    versionId: 'V001',
    title: 'Constraint in V001',
    content: 'Keep this version association.',
  })
  const records = await appendProjectQuestion(managerRoot, projectRoot, {
    versionId: 'V001',
    title: 'Question in V001',
    question: 'Which version owns this?',
  })

  assert.equal(records.tasks.find((item) => item.title === 'Task in V001')?.version, 'V001')
  assert.equal(records.thoughts.find((item) => item.content === 'Idea in V001')?.version, 'V001')
  assert.equal(records.dialogues.find((item) => item.recordContent === 'Research in V001')?.version, 'V001')
  assert.equal(records.constraints.find((item) => item.title === 'Constraint in V001')?.version, 'V001')
  assert.equal(records.questions.find((item) => item.title === 'Question in V001')?.version, 'V001')

  const v001Tasks = await readFile(path.join(initial.config.dataRoot, 'versions/V001/工程任务.md'), 'utf8')
  const v002Tasks = await readFile(path.join(initial.config.dataRoot, 'versions/V002/工程任务.md'), 'utf8')
  assert.match(v001Tasks, /Task in V001/)
  assert.doesNotMatch(v002Tasks, /Task in V001/)

  const paused = await updateProjectVersionStatus(managerRoot, projectRoot, 'V001', 'paused')
  assert.equal(paused.versions.find((item) => item.shortId === 'V001')?.status, 'paused')
  const completed = await updateProjectVersionStatus(managerRoot, projectRoot, 'V001', 'completed')
  assert.equal(completed.versions.find((item) => item.shortId === 'V001')?.status, 'completed')
  assert.notEqual(completed.versions.find((item) => item.shortId === 'V001')?.completed, '无')

  await assert.rejects(
    appendTask(managerRoot, projectRoot, { versionId: 'V001', title: 'Blocked task' }),
    /已完成，默认禁止新增记录/,
  )
  await assert.rejects(
    appendTask(managerRoot, projectRoot, { versionId: 'V999', title: 'Missing version' }),
    /未找到版本：V999/,
  )

  const reopened = await updateProjectVersionStatus(managerRoot, projectRoot, 'V001', 'active')
  const reopenedVersion = reopened.versions.find((item) => item.shortId === 'V001')
  assert.equal(reopenedVersion?.status, 'active')
  assert.equal(reopenedVersion?.completed, '无')
})

test('legacy change index migrates without losing content', async (t) => {
  const managerRoot = await mkdtemp(path.join(os.tmpdir(), 'project-records-data-'))
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'project-records-project-'))
  t.after(async () => {
    await rm(managerRoot, { recursive: true, force: true })
    await rm(projectRoot, { recursive: true, force: true })
  })

  const dashboard = await initProject(managerRoot, projectRoot, 'Legacy Records')
  const currentPath = path.join(dashboard.config.dataRoot, 'metadata/需求变更索引.md')
  const legacyPath = path.join(dashboard.config.dataRoot, 'collaboration/需求变更索引.md')
  const legacyContent = '# 需求变更索引\n\n- preserved legacy entry\n'

  await rm(currentPath)
  await mkdir(path.dirname(legacyPath), { recursive: true })
  await writeFile(legacyPath, legacyContent, 'utf8')
  assert.equal(await isInitialized(managerRoot, projectRoot), false)

  await updateProjectMetadata(managerRoot, projectRoot)

  assert.equal(await isInitialized(managerRoot, projectRoot), true)
  assert.equal(await readFile(currentPath, 'utf8'), legacyContent)
  assert.equal(await exists(legacyPath), false)
})

test('thought and research statuses update within their owning version', async (t) => {
  const managerRoot = await mkdtemp(path.join(os.tmpdir(), 'project-records-data-'))
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'project-records-project-'))
  t.after(async () => {
    await rm(managerRoot, { recursive: true, force: true })
    await rm(projectRoot, { recursive: true, force: true })
  })

  const initial = await initProject(managerRoot, projectRoot, 'Status Records')
  await appendThought(managerRoot, projectRoot, { versionId: 'V001', content: 'First version idea' })
  await appendDialogue(managerRoot, projectRoot, { versionId: 'V001', content: 'First version research' })
  await createProjectVersion(managerRoot, projectRoot, {
    label: 'Second',
    title: 'Second version',
    goal: 'Verify version isolation',
  })
  let dashboard = await appendThought(managerRoot, projectRoot, { versionId: 'V002', content: 'Second version idea' })
  dashboard = await appendDialogue(managerRoot, projectRoot, { versionId: 'V002', content: 'Second version research' })

  const firstThought = dashboard.thoughts.find((item) => item.content === 'First version idea')
  const secondThought = dashboard.thoughts.find((item) => item.content === 'Second version idea')
  const firstDialogue = dashboard.dialogues.find((item) => item.recordContent === 'First version research')
  const secondDialogue = dashboard.dialogues.find((item) => item.recordContent === 'Second version research')
  assert.ok(firstThought)
  assert.ok(secondThought)
  assert.ok(firstDialogue)
  assert.ok(secondDialogue)

  await assert.rejects(
    updateThoughtStatus(managerRoot, projectRoot, firstThought.id, 'handled'),
    /必须填写有效回答/,
  )
  await assert.rejects(
    updateThoughtStatus(managerRoot, projectRoot, firstThought.id, 'handled', '暂无。'),
    /必须填写有效回答/,
  )

  dashboard = await updateThoughtStatus(
    managerRoot,
    projectRoot,
    firstThought.shortId,
    'handled',
    '采用第一个版本的方案。',
  )
  assert.equal(dashboard.thoughts.find((item) => item.id === firstThought.id)?.status, 'handled')
  assert.equal(dashboard.thoughts.find((item) => item.id === firstThought.id)?.answer, '采用第一个版本的方案。')
  assert.equal(dashboard.thoughts.find((item) => item.id === secondThought.id)?.status, 'inbox')

  dashboard = await updateThoughtStatus(managerRoot, projectRoot, firstThought.id, 'inbox')
  assert.equal(dashboard.thoughts.find((item) => item.id === firstThought.id)?.status, 'inbox')
  assert.equal(dashboard.thoughts.find((item) => item.id === firstThought.id)?.answer, '采用第一个版本的方案。')

  dashboard = await updateDialogueStatus(managerRoot, projectRoot, firstDialogue.shortId, 'doing')
  assert.equal(dashboard.dialogues.find((item) => item.id === firstDialogue.id)?.status, 'doing')
  assert.equal(dashboard.dialogues.find((item) => item.id === secondDialogue.id)?.status, 'pending')
  await assert.rejects(
    updateDialogueStatus(managerRoot, projectRoot, secondDialogue.id, 'unknown'),
    /研究状态不合法/,
  )

  const secondThoughtPath = path.join(initial.config.dataRoot, 'versions/V002/想法与问题.md')
  const secondThoughtMarkdown = await readFile(secondThoughtPath, 'utf8')
  await writeFile(secondThoughtPath, secondThoughtMarkdown.replace('status:: inbox', 'status:: done'), 'utf8')
  dashboard = await getDashboard(managerRoot, projectRoot)
  assert.equal(dashboard.thoughts.find((item) => item.id === secondThought.id)?.status, 'handled')

  await writeFile(secondThoughtPath, secondThoughtMarkdown.replace('status:: inbox', 'status:: invalid'), 'utf8')
  dashboard = await getDashboard(managerRoot, projectRoot)
  assert.equal(dashboard.thoughts.find((item) => item.id === secondThought.id)?.status, 'inbox')
})

test('work logs without status remain done when their task status changes', async (t) => {
  const managerRoot = await mkdtemp(path.join(os.tmpdir(), 'project-records-data-'))
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'project-records-project-'))
  t.after(async () => {
    await rm(managerRoot, { recursive: true, force: true })
    await rm(projectRoot, { recursive: true, force: true })
  })

  let dashboard = await initProject(managerRoot, projectRoot, 'Log Status Records')
  const initialTask = dashboard.tasks.find((item) => item.shortId === 'T001')
  assert.ok(initialTask)
  dashboard = await updateTaskStatus(managerRoot, projectRoot, initialTask.id, 'doing')
  assert.equal(dashboard.tasks.find((item) => item.id === initialTask.id)?.status, 'doing')
  assert.equal(dashboard.logs.find((item) => item.shortId === 'L001')?.status, 'done')
})

test('project records support controlled field edits without crossing version or history boundaries', async (t) => {
  const managerRoot = await mkdtemp(path.join(os.tmpdir(), 'project-records-data-'))
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'project-records-project-'))
  t.after(async () => {
    await rm(managerRoot, { recursive: true, force: true })
    await rm(projectRoot, { recursive: true, force: true })
  })

  let dashboard = await initProject(managerRoot, projectRoot, 'Editable Records')
  dashboard = await appendTask(managerRoot, projectRoot, {
    versionId: 'V001',
    title: 'Task typo',
    executionDefinition: 'Old definition',
    acceptance: 'Old acceptance',
  })
  dashboard = await appendThought(managerRoot, projectRoot, { versionId: 'V001', content: 'Idea typo' })
  dashboard = await appendDialogue(managerRoot, projectRoot, {
    versionId: 'V001',
    content: 'Research typo',
    acceptance: 'Old research acceptance',
  })
  dashboard = await appendConstraint(managerRoot, projectRoot, {
    versionId: 'V001',
    title: 'Constraint typo',
    content: 'Old constraint',
  })
  dashboard = await appendProjectQuestion(managerRoot, projectRoot, {
    versionId: 'V001',
    title: 'Question typo',
    question: 'Old question?',
    background: 'Old background',
    recommendation: 'Old recommendation',
    relations: ['T001'],
  })

  const task = dashboard.tasks.find((item) => item.title === 'Task typo')
  const thought = dashboard.thoughts.find((item) => item.content === 'Idea typo')
  const research = dashboard.dialogues.find((item) => item.recordContent === 'Research typo')
  const constraint = dashboard.constraints.find((item) => item.title === 'Constraint typo')
  const question = dashboard.questions.find((item) => item.title === 'Question typo')
  const firstVersion = dashboard.versions.find((item) => item.shortId === 'V001')
  assert.ok(task)
  assert.ok(thought)
  assert.ok(research)
  assert.ok(constraint)
  assert.ok(question)
  assert.ok(firstVersion)

  dashboard = await createProjectVersion(managerRoot, projectRoot, {
    label: 'Second',
    title: 'Second version',
    goal: 'Keep edits isolated',
  })
  dashboard = await appendTask(managerRoot, projectRoot, { versionId: 'V002', title: 'V002 task' })

  const taskStatus = task.status
  dashboard = await updateProjectRecord(managerRoot, projectRoot, 'task', task.shortId, {
    title: 'Correct task',
    priority: 'high',
    workLevel: 'deep',
    depthReason: 'architecture',
    area: 'core',
    userOriginal: 'Correct request',
    executionDefinition: 'Correct definition',
    acceptance: 'Correct acceptance',
    constraints: 'Keep compatibility',
    planRollback: 'Revert the record update',
  })
  const editedTask = dashboard.tasks.find((item) => item.id === task.id)
  assert.equal(editedTask?.title, 'Correct task')
  assert.equal(editedTask?.priority, 'high')
  assert.equal(editedTask?.workLevel, 'deep')
  assert.equal(editedTask?.depthReason, 'architecture')
  assert.equal(editedTask?.detail, 'Correct definition')
  assert.equal(editedTask?.status, taskStatus)
  assert.equal(editedTask?.version, 'V001')
  assert.equal(dashboard.tasks.find((item) => item.title === 'V002 task')?.version, 'V002')

  dashboard = await updateProjectRecord(managerRoot, projectRoot, 'thought', thought.shortId, {
    content: 'Correct idea',
  })
  assert.equal(dashboard.thoughts.find((item) => item.id === thought.id)?.content, 'Correct idea')
  dashboard = await updateThoughtStatus(managerRoot, projectRoot, thought.id, 'handled', 'Initial valid answer')
  await assert.rejects(
    updateProjectRecord(managerRoot, projectRoot, 'thought', thought.shortId, { answer: '暂无。' }),
    /已处理想法必须保留有效回答/,
  )
  dashboard = await updateProjectRecord(managerRoot, projectRoot, 'thought', thought.id, {
    content: 'Final idea',
    answer: 'Final valid answer',
  })
  const editedThought = dashboard.thoughts.find((item) => item.id === thought.id)
  assert.equal(editedThought?.content, 'Final idea')
  assert.equal(editedThought?.answer, 'Final valid answer')
  assert.equal(editedThought?.status, 'handled')

  dashboard = await updateProjectRecord(managerRoot, projectRoot, 'research', research.shortId, {
    content: 'Correct research',
    answer: 'Research result',
    acceptance: '',
    mode: 'depth',
    tags: ['architecture', 'editing'],
    relatedTasks: [task.shortId],
    relatedThoughts: [thought.shortId],
    relatedDocuments: ['W001'],
  })
  const editedResearch = dashboard.dialogues.find((item) => item.id === research.id)
  assert.equal(editedResearch?.recordContent, 'Correct research')
  assert.equal(editedResearch?.answer, 'Research result')
  assert.equal(editedResearch?.mode, 'depth')
  assert.equal(editedResearch?.acceptance, '按深度研究默认标准执行。')
  assert.deepEqual(editedResearch?.relatedTasks, [task.shortId])
  assert.equal(editedResearch?.status, 'pending')
  assert.equal(editedResearch?.version, 'V001')

  dashboard = await updateProjectRecord(managerRoot, projectRoot, 'constraint', constraint.shortId, {
    title: 'Correct constraint',
    content: 'Correct constraint content',
    status: 'draft',
    scope: 'version',
  })
  const editedConstraint = dashboard.constraints.find((item) => item.id === constraint.id)
  assert.equal(editedConstraint?.title, 'Correct constraint')
  assert.equal(editedConstraint?.status, 'draft')
  assert.equal(editedConstraint?.scope, 'version')
  assert.equal(editedConstraint?.version, 'V001')
  await assert.rejects(
    updateProjectRecord(managerRoot, projectRoot, 'constraint', 'system-data-spec', { title: 'Mutable system rule' }),
    /系统约束为只读/,
  )

  dashboard = await updateProjectRecord(managerRoot, projectRoot, 'version', firstVersion.id, {
    label: 'Correct label',
    title: 'Correct version title',
    goal: 'Correct version goal',
    summary: 'Correct version summary',
    outcomes: ['Editable task fields'],
    followUps: ['Add remaining record kinds'],
  })
  const editedVersion = dashboard.versions.find((item) => item.shortId === 'V001')
  assert.equal(editedVersion?.label, 'Correct label')
  assert.equal(editedVersion?.title, 'Correct version title')
  assert.equal(editedVersion?.goal, 'Correct version goal')
  assert.deepEqual(editedVersion?.outcomes, ['Editable task fields'])
  assert.equal(editedVersion?.status, firstVersion.status)
  assert.equal(dashboard.versions.find((item) => item.shortId === 'V002')?.title, 'Second version')

  dashboard = await replyOpenQuestion(managerRoot, projectRoot, {
    questionId: question.shortId,
    answer: 'Preserved later reply',
  })
  const questionBeforeEdit = dashboard.questions.find((item) => item.id === question.id)
  assert.ok(questionBeforeEdit)
  const originalMessages = questionBeforeEdit.messages
  const originalConclusion = questionBeforeEdit.conclusion
  dashboard = await updateProjectRecord(managerRoot, projectRoot, 'question', question.shortId, {
    title: 'Correct question title',
    question: 'Correct question?',
    background: 'Correct background',
    recommendation: 'Correct recommendation',
    kind: 'clarification',
    scope: 'project',
    blocking: true,
    relations: [task.shortId, research.shortId],
  })
  const editedQuestion = dashboard.questions.find((item) => item.id === question.id)
  assert.equal(editedQuestion?.title, 'Correct question title')
  assert.equal(editedQuestion?.question, 'Correct question?')
  assert.equal(editedQuestion?.kind, 'clarification')
  assert.equal(editedQuestion?.scope, 'project')
  assert.equal(editedQuestion?.blocking, true)
  assert.deepEqual(editedQuestion?.relations, [task.shortId, research.shortId])
  assert.equal(editedQuestion?.messages[0]?.content, 'Correct question?')
  assert.deepEqual(editedQuestion?.messages.slice(1), originalMessages.slice(1))
  assert.equal(editedQuestion?.conclusion, originalConclusion)
  assert.equal(editedQuestion?.status, questionBeforeEdit.status)
  assert.equal(editedQuestion?.version, 'V001')

  const v002Tasks = await readFile(path.join(dashboard.config.dataRoot, 'versions/V002/工程任务.md'), 'utf8')
  assert.doesNotMatch(v002Tasks, /Correct task/)

  await updateProjectVersionStatus(managerRoot, projectRoot, 'V001', 'completed')
  for (const [kind, target, patch] of [
    ['task', task.shortId, { title: 'Forbidden task rewrite' }],
    ['thought', thought.shortId, { content: 'Forbidden thought rewrite' }],
    ['research', research.shortId, { content: 'Forbidden research rewrite' }],
    ['question', question.shortId, { question: 'Forbidden question rewrite?' }],
  ]) {
    await assert.rejects(
      updateProjectRecord(managerRoot, projectRoot, kind, target, patch),
      /版本 V001 已完成，默认禁止编辑记录/,
    )
  }

  dashboard = await updateProjectRecord(managerRoot, projectRoot, 'constraint', constraint.id, {
    content: 'Project constraint correction after version completion',
  })
  assert.match(
    dashboard.constraints.find((item) => item.id === constraint.id)?.content || '',
    /Project constraint correction after version completion/,
  )
  dashboard = await updateProjectRecord(managerRoot, projectRoot, 'version', 'V001', {
    summary: 'Version metadata correction after completion',
  })
  assert.equal(
    dashboard.versions.find((item) => item.shortId === 'V001')?.summary,
    'Version metadata correction after completion',
  )
  await assert.rejects(
    updateProjectRecord(managerRoot, projectRoot, 'task', task.id, { status: 'done' }),
    /不支持编辑字段：status/,
  )
})

async function exists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}
