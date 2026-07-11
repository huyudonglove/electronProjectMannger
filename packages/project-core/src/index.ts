import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

export const DATA_DIR = 'projects'
export const COLLABORATION_ENTRY = '.agent-collaboration.md'

export type ProjectConfig = {
  projectId: string
  name: string
  projectRoot: string
  dataRoot: string
  createdAt: string
  version: 1
}

export type ProjectTask = {
  id: string
  shortId: string
  title: string
  status: string
  priority: string
  area: string
  updated: string
  detail: string
  acceptance: string
  openQuestions: string
}

export type ProjectThought = {
  id: string
  shortId: string
  title: string
  status: string
  created: string
  content: string
  answer: string
  openQuestions: string
  replyRecords: string[]
}

export type ProjectLog = {
  shortId: string
  title: string
  created: string
  status: string
  source: string
  userGoal: string
  userOriginal: string
  understanding: string
  answer: string
  executionScope: string
  acceptance: string
  outputs: string[]
  keySteps: string[]
  decisions: string[]
  actions: string[]
  changedFiles: string[]
  verification: string[]
  openQuestions: string[]
  replyRecords: string[]
  followUps: string[]
  relatedTasks: Array<{ shortId: string; id: string; title: string; status: string }>
  content: string
}

export type ProjectDialogue = {
  id: string
  shortId: string
  title: string
  created: string
  tags: string[]
  relatedTasks: string[]
  relatedThoughts: string[]
  relatedDocuments: string[]
  recordContent: string
  answer: string
  acceptance: string
  content: string
}

export type ProjectDocumentNote = {
  path: string
  folder: string
  title: string
  type: string
  status: string
  shortId: string
  updated: string
  tags: string[]
  summary: string
  content: string
}

export type ProjectKnowledgeNote = ProjectDocumentNote & {
  id: string
  aliases: string[]
  sourceProject: string
  source: string
  relatedRecords: string[]
  relatedTasks: string[]
  relatedNotes: string[]
}

export type ProjectConstraint = {
  id: string
  shortId: string
  title: string
  status: string
  scope: string
  source: 'user' | 'system'
  created: string
  updated: string
  path: string
  summary: string
  content: string
}

export type ProjectOpenQuestion = {
  id: string
  displayId: string
  source: 'task' | 'thought' | 'log'
  shortId: string
  title: string
  openQuestions: string
  created: string
  relations: string[]
  thoughtId?: string
  logIndex?: number
}

export type ProjectReplyRecord = {
  questionId: string
  displayId: string
  source: 'task' | 'thought' | 'log'
  shortId: string
  title: string
  openQuestions: string
  reply: string
  replyCreated: string
  replyAnswer: string
  created: string
  relations: string[]
  thoughtId?: string
  logIndex?: number
}

export type AgentBrief = {
  generatedAt: string
  projectRoot: string
  dataRoot: string
  knowledgeRoot: string
  skillPath: string
  activeTasks: ProjectTask[]
  openQuestions: ProjectOpenQuestion[]
  latestLogs: string[]
  instructions: string[]
}

export type Dashboard = {
  config: ProjectConfig
  tasks: ProjectTask[]
  thoughts: ProjectThought[]
  dialogues: ProjectDialogue[]
  knowledge: ProjectKnowledgeNote[]
  documents: ProjectDocumentNote[]
  constraints: ProjectConstraint[]
  logs: ProjectLog[]
  activeTasks: ProjectTask[]
  openQuestions: AgentBrief['openQuestions']
  replyRecords: ProjectReplyRecord[]
  latestLogs: string[]
  agentBrief: AgentBrief
}

export type ManagedProject = {
  projectId: string
  projectName: string
  projectRoot: string
  dataRoot: string
  createdAt: string
  lastOpenedAt: string
}

export type NewTaskInput = {
  title: string
  status?: string
  priority?: string
  area?: string
  userOriginal?: string
  agentUnderstanding?: string
  executionScope?: string
  acceptance?: string
  openQuestions?: string
}

export type NewDialogueInput = {
  content: string
  answer?: string
  acceptance?: string
}

export type NewConstraintInput = {
  title: string
  content: string
  status?: string
  scope?: string
}

export type OpenQuestionReplyInput = {
  questionId?: string
  source?: 'task' | 'thought' | 'log'
  shortId?: string
  thoughtId?: string
  title?: string
  openQuestions: string
  answer: string
}

const TASKS_PATH = 'tasks/工程任务.md'
const DATA_SPEC_PATH = 'collaboration/数据层规范.md'
const HANDOFF_PATH = 'collaboration/Agent 同步交接.md'
const THOUGHTS_PATH = 'thoughts/想法与问题.md'
const DIALOGUES_PATH = 'research/研究.md'
const AGENT_LOG_PATH = 'work-logs/Agent 工作记录.md'
const CHANGE_INDEX_PATH = 'collaboration/需求变更索引.md'
const CONSTRAINTS_PATH = 'constraints/项目约束.md'
const DOCUMENTS_DIR = 'documents'
const GLOBAL_KNOWLEDGE_DIR = 'knowledge'
const SKILL_PATH = 'skills/project-collaboration/SKILL.md'

function requiredProjectFiles() {
  return [
    'project.json',
    TASKS_PATH,
    DATA_SPEC_PATH,
    HANDOFF_PATH,
    THOUGHTS_PATH,
    DIALOGUES_PATH,
    AGENT_LOG_PATH,
    CHANGE_INDEX_PATH,
    CONSTRAINTS_PATH,
    SKILL_PATH,
  ]
}

export function createProjectId(projectRoot: string, projectName = path.basename(projectRoot)) {
  return `${slug(projectName)}-${createHash('sha1').update(path.resolve(projectRoot)).digest('hex').slice(0, 10)}`
}

export function resolveDataRoot(managerDataRoot: string, projectRoot: string, projectName = path.basename(projectRoot)) {
  return path.join(managerDataRoot, DATA_DIR, createProjectId(projectRoot, projectName))
}

async function resolveExistingDataRoot(managerDataRoot: string, projectRoot: string) {
  const project = (await readProjectIndex(managerDataRoot))
    .find((item) => path.resolve(item.projectRoot) === path.resolve(projectRoot))
  return project?.dataRoot || resolveDataRoot(managerDataRoot, projectRoot)
}

export async function isInitialized(managerDataRoot: string, projectRoot: string) {
  try {
    const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
    await Promise.all(requiredProjectFiles().map((relativePath) => readFile(path.join(dataRoot, relativePath), 'utf8')))
    return true
  } catch {
    return false
  }
}

export async function initProject(managerDataRoot: string, projectRoot: string, name = path.basename(projectRoot)) {
  const projectId = createProjectId(projectRoot, name)
  const dataRoot = resolveDataRoot(managerDataRoot, projectRoot, name)
  const config: ProjectConfig = {
    projectId,
    name,
    projectRoot,
    dataRoot,
    createdAt: new Date().toISOString(),
    version: 1,
  }

  await writeProjectFile(dataRoot, 'project.json', `${JSON.stringify(config, null, 2)}\n`)
  await writeProjectFile(dataRoot, TASKS_PATH, tasksTemplate(name))
  await writeProjectFile(dataRoot, DATA_SPEC_PATH, dataSpecTemplate())
  await writeProjectFile(dataRoot, HANDOFF_PATH, handoffTemplate(projectRoot))
  await ensureProjectDirectory(dataRoot, DOCUMENTS_DIR)
  await writeProjectFile(dataRoot, THOUGHTS_PATH, thoughtsTemplate())
  await writeProjectFile(dataRoot, DIALOGUES_PATH, dialoguesTemplate())
  await writeProjectFile(dataRoot, AGENT_LOG_PATH, agentLogTemplate())
  await writeProjectFile(dataRoot, CHANGE_INDEX_PATH, changeIndexTemplate())
  await writeProjectFile(dataRoot, CONSTRAINTS_PATH, constraintsTemplate())
  await ensureGlobalKnowledgeRoot(managerDataRoot)
  await writeProjectFile(dataRoot, SKILL_PATH, skillTemplate(projectRoot, dataRoot))
  await writeCollaborationEntry(projectRoot, dataRoot)
  await ensureCollaborationIgnored(projectRoot)
  await upsertProjectIndex(managerDataRoot, config)

  const dashboard = await getDashboard(managerDataRoot, projectRoot)
  await writeAgentBrief(managerDataRoot, projectRoot, dashboard.agentBrief)
  await writeProjectFile(dataRoot, 'index.json', `${JSON.stringify(indexFromDashboard(dashboard), null, 2)}\n`)

  return dashboard
}

export async function updateProjectGuidance(managerDataRoot: string, projectRoot: string) {
  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const config = await readProjectConfig(managerDataRoot, projectRoot)
  await writeProjectFile(dataRoot, DATA_SPEC_PATH, dataSpecTemplate())
  await writeProjectFile(dataRoot, HANDOFF_PATH, handoffTemplate(projectRoot))
  await ensureProjectFile(dataRoot, DIALOGUES_PATH, dialoguesTemplate())
  await ensureProjectFile(dataRoot, CONSTRAINTS_PATH, constraintsTemplate())
  await ensureGlobalKnowledgeRoot(managerDataRoot)
  await normalizeGlobalKnowledgeFiles(managerDataRoot)
  await writeProjectFile(dataRoot, SKILL_PATH, skillTemplate(projectRoot, dataRoot))
  await refreshAgentBrief(managerDataRoot, projectRoot)
  await upsertProjectIndex(managerDataRoot, config)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function getDashboard(managerDataRoot: string, projectRoot: string): Promise<Dashboard> {
  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const config = await readProjectConfig(managerDataRoot, projectRoot)
  await ensureGlobalKnowledgeRoot(managerDataRoot)
  await normalizeProjectDocumentFiles(dataRoot)
  await normalizeGlobalKnowledgeFiles(managerDataRoot)
  const tasksContent = await readProjectFile(dataRoot, TASKS_PATH)
  const logContent = await readProjectFile(dataRoot, AGENT_LOG_PATH)
  const tasks = parseProjectTasks(tasksContent)
  const thoughts = parseThoughts(await readProjectFile(dataRoot, THOUGHTS_PATH))
  const dialogues = parseDialogues(await readResearchRecordsFile(dataRoot))
  const documents = await listProjectDocuments(dataRoot)
  const knowledge = parseKnowledgeNotes(await listGlobalKnowledgeDocuments(managerDataRoot))
  const constraints = await listProjectConstraints(dataRoot)
  const logs = parseProjectLogs(logContent, tasks)
  const latestLogs = logs.slice(0, 5).map((log) => log.title)
  const activeTasks = tasks.filter((task) => ['backlog', 'todo', 'doing'].includes(task.status))
  const taskOpenQuestions = activeTasks
    .filter((task) => hasOpenQuestionText(task.openQuestions))
    .map((task) => ({
      source: 'task' as const,
      shortId: task.shortId,
      title: task.title,
      openQuestions: task.openQuestions,
      created: task.updated,
    }))
  const thoughtOpenQuestions = thoughts
    .filter((thought) => hasOpenQuestionText(thought.openQuestions))
    .flatMap((thought) => listSectionItems(thought.openQuestions).map((question) => ({
      source: 'thought' as const,
      shortId: thought.shortId,
      title: thought.title,
      openQuestions: question,
      created: thought.created,
      thoughtId: thought.id,
    })))
  const logOpenQuestions = logs
    .flatMap((log, logIndex) => log.openQuestions.map((question) => ({
      source: 'log' as const,
      shortId: log.shortId,
      title: log.title,
      openQuestions: question,
      created: log.created,
      logIndex,
    })))
  const openQuestions = assignOpenQuestionIds([...taskOpenQuestions, ...thoughtOpenQuestions, ...logOpenQuestions])
  const replyRecords = [
    ...parseTaskReplyRecords(tasksContent).map((reply) => enrichReplyRecord(reply)),
    ...thoughts.flatMap((thought) => thought.replyRecords.map((reply) => ({
      parsed: parseReplyRecordParts(reply),
      source: 'thought' as const,
      shortId: thought.shortId,
      title: thought.title,
      reply,
      created: thought.created,
      thoughtId: thought.id,
    })).filter((reply) => reply.parsed).map(({ parsed, ...reply }) => ({
      ...reply,
      ...parsed!,
    }))).map((reply) => enrichReplyRecord(reply)),
    ...logs.flatMap((log, logIndex) => log.replyRecords.map((reply) => ({
      parsed: parseReplyRecordParts(reply),
      source: 'log' as const,
      shortId: log.shortId,
      title: log.title,
      reply,
      created: log.created,
      logIndex,
    })).filter((reply) => reply.parsed).map(({ parsed, ...reply }) => ({
      ...reply,
      ...parsed!,
    }))).map((reply) => enrichReplyRecord(reply)),
  ]

  const agentBrief: AgentBrief = {
    generatedAt: new Date().toISOString(),
    projectRoot,
    dataRoot,
    knowledgeRoot: resolveGlobalKnowledgeRoot(managerDataRoot),
    skillPath: path.join(dataRoot, SKILL_PATH),
    activeTasks,
    openQuestions,
    latestLogs,
    instructions: [
      `先读取 ${path.join(dataRoot, 'agent-brief.json')} 建立最新上下文。`,
      `然后读取 ${path.join(dataRoot, SKILL_PATH)}，按其中规则写任务和工作记录。`,
      `读取 ${path.join(dataRoot, CONSTRAINTS_PATH)} 获取当前项目全局约束；约束记录使用 Cxxx。`,
      `需要完整任务时读取 ${path.join(dataRoot, TASKS_PATH)}。`,
      '所有记录型 Markdown 都必须按 ID 倒序维护：较大的 Txxx/Ixxx/Dxxx/Wxxx/Kxxx/Lxxx/Cxxx 写在较小 ID 上方，例如 T036 在 T001 上面。',
      `处理 Dxxx 研究时读取 ${path.join(dataRoot, DIALOGUES_PATH)}，同时读取关联 Wxxx 文档；默认按 Tree-of-Thought 至少 3 条路径、优缺点、适用条件和建议结论组织研究。`,
      `长期知识库是全局共享的，读取 ${resolveGlobalKnowledgeRoot(managerDataRoot)} 中的 Kxxx 条目。`,
      `工作记录必须包含 ### 用户目标、### 需求理解、### 产出、### 关键步骤、### 验证、### 验收标准、### 未确认事项。`,
      '工作流顺序：想法/输入 -> 整理回答 -> 必要时产生任务 -> 任务进入 todo/doing/done -> 任务执行并验收后写 Agent 工作记录。',
      '整理想法只更新想法回答和必要任务卡；未执行工程任务时不要写 Agent 工作记录。',
      '执行任务前将任务状态改为 doing，完成验收后改为 done。',
      `完成后写入 ${path.join(dataRoot, AGENT_LOG_PATH)}。`,
      '不要回滚或覆盖用户、其他 Agent 的无关改动。',
    ],
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
    activeTasks,
    openQuestions,
    replyRecords,
    latestLogs,
    agentBrief,
  }
}

export async function listManagedProjects(managerDataRoot: string): Promise<ManagedProject[]> {
  return (await readProjectIndex(managerDataRoot))
    .slice()
    .sort((a, b) => projectOpenTime(b).localeCompare(projectOpenTime(a)))
}

function projectOpenTime(project: ManagedProject) {
  return project.lastOpenedAt || project.createdAt || ''
}

export async function recordProjectOpen(managerDataRoot: string, projectRoot: string) {
  const config = await readProjectConfig(managerDataRoot, projectRoot)
  await upsertProjectIndex(managerDataRoot, config)
  return config
}

export async function removeManagedProject(managerDataRoot: string, projectId: string): Promise<ManagedProject[]> {
  const id = String(projectId || '').trim()
  if (!id) throw new Error('项目 ID 不能为空')

  const projects = await readProjectIndex(managerDataRoot)
  const next = projects.filter((project) => project.projectId !== id)
  await mkdir(managerDataRoot, { recursive: true })
  await writeFile(path.join(managerDataRoot, 'projects.json'), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return listManagedProjects(managerDataRoot)
}

export async function appendTask(managerDataRoot: string, projectRoot: string, input: NewTaskInput) {
  if (!input) throw new Error('任务内容不能为空')
  const title = normalizeTitle(input.title || '')
  if (!title) throw new Error('任务标题不能为空')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const current = await readProjectFile(dataRoot, TASKS_PATH)
  const tasks = parseProjectTasks(current)
  const now = localTime()
  const task = taskToMarkdown({
    id: createId('task', title),
    shortId: nextShortId(tasks.map((item) => item.shortId), 'T'),
    title,
    status: normalizeStatus(input.status || 'todo'),
    priority: input.priority || 'medium',
    area: input.area || 'tool',
    updated: now,
    detail: input.executionScope || '待补充。',
    acceptance: input.acceptance || '待补充。',
    openQuestions: input.openQuestions || '无。',
  }, {
    created: now,
    userOriginal: input.userOriginal || title,
    agentUnderstanding: input.agentUnderstanding || '待补充。',
  })

  await writeProjectFile(dataRoot, TASKS_PATH, insertMarkdownEntry(current, task))
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function updateTaskStatus(managerDataRoot: string, projectRoot: string, taskId: string, status: string) {
  const id = String(taskId || '').trim()
  const nextStatus = String(status || '').trim()
  if (!id) throw new Error('任务 ID 不能为空')
  if (!nextStatus) throw new Error('任务状态不能为空')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const current = await readProjectFile(dataRoot, TASKS_PATH)
  let updatedTask = false
  const next = current
    .split(/\n(?=##\s+)/)
    .map((block, index) => {
      if (index === 0 && !block.trim().startsWith('## ')) return block
      if (!block.includes(`id:: ${id}`)) return block
      updatedTask = true
      const updated = block
        .replace(/^status::\s*.+$/m, `status:: ${normalizeStatus(nextStatus)}`)
        .replace(/^updated::\s*.+$/m, `updated:: ${localTime()}`)
      return updated
    })
    .join('\n')

  if (!updatedTask) throw new Error('未找到任务记录')

  await writeProjectFile(dataRoot, TASKS_PATH, next.endsWith('\n') ? next : `${next}\n`)
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function deleteTask(managerDataRoot: string, projectRoot: string, taskId: string) {
  const id = String(taskId || '').trim()
  if (!id) throw new Error('任务 ID 不能为空')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const current = await readProjectFile(dataRoot, TASKS_PATH)
  let deleted = false
  const blocks = current.split(/\n(?=##\s+)/)
  const next = blocks
    .filter((block, index) => {
      if (index === 0 && !block.trim().startsWith('## ')) return true
      const shouldDelete = block.includes(`id:: ${id}`)
      if (shouldDelete) deleted = true
      return !shouldDelete
    })
    .map((block) => block.trim())
    .filter(Boolean)
    .join('\n\n')

  if (!deleted) throw new Error('未找到任务记录')

  await writeProjectFile(dataRoot, TASKS_PATH, `${next}\n`)
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function appendThought(managerDataRoot: string, projectRoot: string, content: string) {
  const normalized = String(content || '').trim()
  if (!normalized) throw new Error('输入内容不能为空')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const current = await readProjectFile(dataRoot, THOUGHTS_PATH)
  const thoughts = parseThoughts(current)
  const now = localTime()
  const entry = `## ${now} 想法

id:: ${createId('thought', normalized.slice(0, 24))}
short_id:: ${nextShortId(thoughts.map((item) => item.shortId), 'I')}
status:: inbox
type:: thought
created:: ${now}

### 内容

${normalized}

### 回答

暂无。

### 未确认事项

无。
`

  await writeProjectFile(dataRoot, THOUGHTS_PATH, insertMarkdownEntry(current, entry))
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function appendDialogue(managerDataRoot: string, projectRoot: string, input: NewDialogueInput) {
  if (!input) throw new Error('研究内容不能为空')
  const normalized = String(input.content || '').trim()
  if (!normalized) throw new Error('研究内容不能为空')
  const answer = String(input.answer || '').trim() || '暂无。'
  const acceptance = String(input.acceptance || '').trim() || defaultResearchStandard()

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  await normalizeProjectDocumentFiles(dataRoot)
  const current = await readResearchRecordsFile(dataRoot)
  const dialogues = parseDialogues(current)
  const documents = await listProjectDocuments(dataRoot)
  const logContent = await readProjectFile(dataRoot, AGENT_LOG_PATH)
  const logs = parseProjectLogs(logContent, parseProjectTasks(await readProjectFile(dataRoot, TASKS_PATH)))
  const now = localTime()
  const shortId = nextShortId(dialogues.map((item) => item.shortId), 'D')
  const documentShortId = nextDocumentShortId(documents.map((item) => item.shortId))()
  const logShortId = nextShortId(logs.map((item) => item.shortId), 'L')
  const title = firstMeaningfulLine(normalized).slice(0, 40) || '研究'
  const documentPath = `${DOCUMENTS_DIR}/研究/${shortId}-${slug(title) || 'research'}.md`
  const entry = `## ${now} 研究

id:: ${createId('dialogue', normalized.slice(0, 24))}
short_id:: ${shortId}
type:: dialogue
created:: ${now}
updated:: ${now}
mode:: research
tags:: research
related_tasks:: 无
related_thoughts:: 无
related_documents:: ${documentShortId}

### 内容

${firstMeaningfulLine(normalized)}

### 回答

详细研究文档：${documentShortId}（${documentPath}）

### 验收标准

${acceptance}
`
  const document = researchDocumentMarkdown({
    title,
    shortId: documentShortId,
    dialogueShortId: shortId,
    created: now,
    content: normalized,
    answer,
    acceptance,
  })
  const logEntry = researchLogMarkdown({
    title,
    logShortId,
    dialogueShortId: shortId,
    documentShortId,
    documentPath,
    created: now,
    summary: firstMeaningfulLine(normalized),
    acceptance,
  })

  await writeProjectFile(dataRoot, DIALOGUES_PATH, insertMarkdownEntry(current, entry))
  await writeProjectFile(dataRoot, documentPath, document)
  await writeProjectFile(dataRoot, AGENT_LOG_PATH, insertMarkdownEntry(logContent, logEntry))
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function appendConstraint(managerDataRoot: string, projectRoot: string, input: NewConstraintInput) {
  if (!input) throw new Error('约束内容不能为空')
  const title = normalizeTitle(input.title || '')
  const content = String(input.content || '').trim()
  if (!title) throw new Error('约束标题不能为空')
  if (!content) throw new Error('约束内容不能为空')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const current = await readConstraintsRecordsFile(dataRoot)
  const constraints = parseUserConstraints(current)
  const now = localTime()
  const entry = `## ${title}

id:: ${createId('constraint', title)}
short_id:: ${nextShortId(constraints.map((item) => item.shortId), 'C')}
type:: constraint
status:: ${normalizeConstraintStatus(input.status || 'active')}
scope:: ${String(input.scope || '').trim() || 'project'}
created:: ${now}
updated:: ${now}

### 内容

${content}
`

  await writeProjectFile(dataRoot, CONSTRAINTS_PATH, insertMarkdownEntry(current, entry))
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function deleteConstraint(managerDataRoot: string, projectRoot: string, constraintId: string) {
  const id = String(constraintId || '').trim()
  if (!id) throw new Error('约束 ID 不能为空')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const current = await readConstraintsRecordsFile(dataRoot)
  let deleted = false
  const blocks = current.split(/\n(?=##\s+)/)
  const next = blocks
    .filter((block, index) => {
      if (index === 0 && !block.trim().startsWith('## ')) return true
      const fields = parseFields(block)
      const shouldDelete = fields.id === id
      if (shouldDelete) deleted = true
      return !shouldDelete
    })
    .map((block) => block.trim())
    .filter(Boolean)
    .join('\n\n')

  if (!deleted) throw new Error('未找到约束记录')

  await writeProjectFile(dataRoot, CONSTRAINTS_PATH, `${next}\n`)
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function deleteThought(managerDataRoot: string, projectRoot: string, thoughtId: string) {
  const id = String(thoughtId || '').trim()
  if (!id) throw new Error('输入 ID 不能为空')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const current = await readProjectFile(dataRoot, THOUGHTS_PATH)
  let deleted = false
  const blocks = current.split(/\n(?=##\s+)/)
  const next = blocks
    .filter((block, index) => {
      if (index === 0 && !block.trim().startsWith('## ')) return true
      const shouldDelete = block.includes(`id:: ${id}`)
      if (shouldDelete) deleted = true
      return !shouldDelete
    })
    .map((block) => block.trim())
    .filter(Boolean)
    .join('\n\n')

  if (!deleted) throw new Error('未找到输入记录')

  await writeProjectFile(dataRoot, THOUGHTS_PATH, `${next}\n`)
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function replyOpenQuestion(managerDataRoot: string, projectRoot: string, input: OpenQuestionReplyInput) {
  if (!input) throw new Error('回复内容不能为空')
  const answer = String(input.answer || '').trim()
  const question = String(input.openQuestions || '').trim()
  if (!answer) throw new Error('回复内容不能为空')
  if (!question) throw new Error('未确认事项不能为空')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  if (input.source === 'log') {
    await replyLogOpenQuestion(dataRoot, input, answer)
  } else if (input.source === 'thought') {
    await replyThoughtOpenQuestion(dataRoot, input, answer)
  } else {
    await replyTaskOpenQuestion(dataRoot, input, answer)
  }

  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function refreshAgentBrief(managerDataRoot: string, projectRoot: string) {
  const dashboard = await getDashboard(managerDataRoot, projectRoot)
  await writeAgentBrief(managerDataRoot, projectRoot, dashboard.agentBrief)
  await writeProjectFile(await resolveExistingDataRoot(managerDataRoot, projectRoot), 'index.json', `${JSON.stringify(indexFromDashboard(dashboard), null, 2)}\n`)
  await upsertProjectIndex(managerDataRoot, dashboard.config)
  return dashboard.agentBrief
}

async function readProjectConfig(managerDataRoot: string, projectRoot: string): Promise<ProjectConfig> {
  const raw = await readProjectFile(await resolveExistingDataRoot(managerDataRoot, projectRoot), 'project.json')
  return JSON.parse(raw) as ProjectConfig
}

async function writeAgentBrief(managerDataRoot: string, projectRoot: string, brief: AgentBrief) {
  await writeProjectFile(await resolveExistingDataRoot(managerDataRoot, projectRoot), 'agent-brief.json', `${JSON.stringify(brief, null, 2)}\n`)
}

function resolveGlobalKnowledgeRoot(managerDataRoot: string) {
  return path.join(managerDataRoot, GLOBAL_KNOWLEDGE_DIR)
}

async function ensureGlobalKnowledgeRoot(managerDataRoot: string) {
  await mkdir(resolveGlobalKnowledgeRoot(managerDataRoot), { recursive: true })
}

async function readProjectFile(dataRoot: string, relativePath: string) {
  try {
    return await readFile(path.join(dataRoot, relativePath), 'utf8')
  } catch (error) {
    if (relativePath === DIALOGUES_PATH) return dialoguesTemplate()
    throw error
  }
}

async function readExistingProjectFile(dataRoot: string, relativePath: string) {
  try {
    return await readFile(path.join(dataRoot, relativePath), 'utf8')
  } catch {
    return ''
  }
}

async function readExistingRootFile(root: string, relativePath: string) {
  try {
    return await readFile(path.join(root, relativePath), 'utf8')
  } catch {
    return ''
  }
}

async function readResearchRecordsFile(dataRoot: string) {
  const current = await readExistingProjectFile(dataRoot, DIALOGUES_PATH)
  if (current) return current
  const content = dialoguesTemplate()
  await writeProjectFile(dataRoot, DIALOGUES_PATH, content)
  return content
}

async function readConstraintsRecordsFile(dataRoot: string) {
  const current = await readExistingProjectFile(dataRoot, CONSTRAINTS_PATH)
  if (current) return current
  const content = constraintsTemplate()
  await writeProjectFile(dataRoot, CONSTRAINTS_PATH, content)
  return content
}

async function writeProjectFile(dataRoot: string, relativePath: string, content: string) {
  const absolutePath = path.join(dataRoot, relativePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content, 'utf8')
}

async function ensureProjectDirectory(dataRoot: string, relativePath: string) {
  await mkdir(path.join(dataRoot, relativePath), { recursive: true })
}

async function writeRootFile(root: string, relativePath: string, content: string) {
  const absolutePath = path.join(root, relativePath)
  await mkdir(path.dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content, 'utf8')
}

async function ensureProjectFile(dataRoot: string, relativePath: string, content: string) {
  try {
    await readFile(path.join(dataRoot, relativePath), 'utf8')
  } catch {
    await writeProjectFile(dataRoot, relativePath, content)
  }
}

async function listProjectDocuments(dataRoot: string): Promise<ProjectDocumentNote[]> {
  const files = await listMarkdownFiles(dataRoot, DOCUMENTS_DIR)
  const notes = await Promise.all(files.map(async (relativePath) => parseDocumentNote(relativePath, await readProjectFile(dataRoot, relativePath))))
  return notes.sort((a, b) => a.path.localeCompare(b.path, 'zh-Hans-CN'))
}

async function listGlobalKnowledgeDocuments(managerDataRoot: string): Promise<ProjectDocumentNote[]> {
  const files = await listMarkdownFiles(managerDataRoot, GLOBAL_KNOWLEDGE_DIR)
  const notes = await Promise.all(files.map(async (relativePath) => parseDocumentNote(relativePath, await readExistingRootFile(managerDataRoot, relativePath))))
  return notes.sort((a, b) => a.path.localeCompare(b.path, 'zh-Hans-CN'))
}

async function listProjectConstraints(dataRoot: string): Promise<ProjectConstraint[]> {
  const userConstraints = parseUserConstraints(await readConstraintsRecordsFile(dataRoot))
  const systemConstraints = await listSystemConstraints(dataRoot)
  return [...userConstraints, ...systemConstraints]
}

async function listSystemConstraints(dataRoot: string): Promise<ProjectConstraint[]> {
  const now = localTime()
  const sources = [
    { id: 'system-data-spec', shortId: 'SYS-数据规范', title: '数据层规范', path: DATA_SPEC_PATH },
    { id: 'system-handoff', shortId: 'SYS-交接', title: 'Agent 同步交接', path: HANDOFF_PATH },
    { id: 'system-skill', shortId: 'SYS-SKILL', title: 'Project Collaboration Skill', path: SKILL_PATH },
  ]

  return Promise.all(sources.map(async (source) => {
    const content = await readExistingProjectFile(dataRoot, source.path)
    return {
      id: source.id,
      shortId: source.shortId,
      title: source.title,
      status: 'readonly',
      scope: 'system',
      source: 'system' as const,
      created: now,
      updated: now,
      path: source.path,
      summary: firstContentSummary(content) || source.title,
      content: content.trim(),
    }
  }))
}

async function listMarkdownFiles(dataRoot: string, base = ''): Promise<string[]> {
  const absoluteBase = path.join(dataRoot, base)
  let entries
  try {
    entries = await readdir(absoluteBase, { withFileTypes: true })
  } catch {
    return []
  }

  const files = await Promise.all(entries
    .filter((entry) => !['.git', 'node_modules', 'dist', 'release'].includes(entry.name))
    .map(async (entry) => {
      const relativePath = path.join(base, entry.name)
      if (entry.isDirectory()) return listMarkdownFiles(dataRoot, relativePath)
      return entry.isFile() && entry.name.endsWith('.md') ? [relativePath] : []
    }))
  return files.flat()
}

async function normalizeProjectDocumentFiles(dataRoot: string) {
  const files = (await listMarkdownFiles(dataRoot, DOCUMENTS_DIR))
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))

  let nextShortId = nextDocumentShortId(await Promise.all(files.map(async (relativePath) => {
    const content = await readExistingProjectFile(dataRoot, relativePath)
    return parseFields(content).short_id
  })))
  const usedShortIds = new Set<string>()

  for (const relativePath of files) {
    const content = await readExistingProjectFile(dataRoot, relativePath)
    const fields = parseFields(content)
    const title = noteTitle(content, relativePath)
    const created = fields.created || localTime()
    let shortId = normalizeDocumentShortId(fields.short_id)
    while (!shortId || usedShortIds.has(shortId)) shortId = nextShortId()
    usedShortIds.add(shortId)
    const missing: Record<string, string> = {
      id: fields.id || `document-${slug(relativePath.replace(/\.md$/, ''))}`,
      short_id: shortId,
      type: fields.type || 'document',
      status: fields.status || 'active',
      created,
      updated: fields.updated || created,
      tags: fields.tags || 'document',
      summary: fields.summary || firstContentSummary(content) || title,
    }
    const next = addMissingMetadataFields(content, fields, missing)
    const withUniqueShortId = next.replace(/^short_id::\s*.+$/m, `short_id:: ${shortId}`)
    if (withUniqueShortId !== content) await writeProjectFile(dataRoot, relativePath, withUniqueShortId)
  }
}

async function normalizeGlobalKnowledgeFiles(managerDataRoot: string) {
  const files = (await listMarkdownFiles(managerDataRoot, GLOBAL_KNOWLEDGE_DIR))
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))

  let nextShortId = nextKnowledgeShortId(await Promise.all(files.map(async (relativePath) => {
    const content = await readExistingRootFile(managerDataRoot, relativePath)
    return parseFields(content).short_id
  })))
  const usedShortIds = new Set<string>()

  for (const relativePath of files) {
    const content = await readExistingRootFile(managerDataRoot, relativePath)
    const fields = parseFields(content)
    const title = noteTitle(content, relativePath)
    const created = fields.created || localTime()
    let shortId = normalizeKnowledgeShortId(fields.short_id)
    while (!shortId || usedShortIds.has(shortId)) shortId = nextShortId()
    usedShortIds.add(shortId)
    const missing: Record<string, string> = {
      id: fields.id || `knowledge-${slug(relativePath.replace(/\.md$/, ''))}`,
      short_id: shortId,
      type: fields.type || 'knowledge',
      status: fields.status || 'active',
      created,
      updated: fields.updated || created,
      tags: fields.tags || 'knowledge',
      aliases: fields.aliases || '无',
      source_project: fields.source_project || '未标注项目',
      source: fields.source || '无',
      related_records: fields.related_records || '无',
      related_tasks: fields.related_tasks || '无',
      related_notes: fields.related_notes || '无',
      summary: fields.summary || firstContentSummary(content) || title,
    }
    const next = addMissingMetadataFields(content, fields, missing)
    const withUniqueShortId = next.replace(/^short_id::\s*.+$/m, `short_id:: ${shortId}`)
    if (withUniqueShortId !== content) await writeRootFile(managerDataRoot, relativePath, withUniqueShortId)
  }
}

function nextKnowledgeShortId(existingValues: Array<string | undefined>) {
  let current = Math.max(0, ...existingValues.map((value) => Number(String(value || '').match(/^K(\d+)$/i)?.[1] || 0)))
  return () => `K${String(++current).padStart(3, '0')}`
}

function normalizeKnowledgeShortId(value: string | undefined) {
  const match = String(value || '').trim().match(/^K(\d{1,4})$/i)
  return match ? `K${match[1].padStart(3, '0')}` : ''
}

function nextDocumentShortId(existingValues: Array<string | undefined>) {
  let current = Math.max(0, ...existingValues.map((value) => Number(String(value || '').match(/^W(\d+)$/i)?.[1] || 0)))
  return () => `W${String(++current).padStart(3, '0')}`
}

function normalizeDocumentShortId(value: string | undefined) {
  const match = String(value || '').trim().match(/^W(\d{1,4})$/i)
  return match ? `W${match[1].padStart(3, '0')}` : ''
}

function addMissingMetadataFields(content: string, fields: Record<string, string>, values: Record<string, string>) {
  const missing = Object.entries(values)
    .filter(([key]) => !fields[key])
    .map(([key, value]) => `${key}:: ${value}`)
  if (!missing.length) return content

  const normalized = content.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const titleIndex = lines.findIndex((line) => /^#\s+/.test(line))
  let insertIndex = titleIndex >= 0 ? titleIndex + 1 : 0
  while (insertIndex < lines.length && (lines[insertIndex].trim() === '' || /^[A-Za-z0-9_-]+::\s*/.test(lines[insertIndex]))) {
    insertIndex += 1
  }

  const prefix = lines.slice(0, insertIndex).join('\n').trimEnd()
  const suffix = lines.slice(insertIndex).join('\n').replace(/^\n+/, '')
  return `${prefix}\n${missing.join('\n')}\n\n${suffix}`.trimEnd() + '\n'
}

function parseDocumentNote(relativePath: string, content: string): ProjectDocumentNote {
  const fields = parseFields(content)
  const type = fields.type || noteTypeFromPath(relativePath)
  return {
    path: relativePath,
    folder: path.dirname(relativePath) === '.' ? '' : path.dirname(relativePath),
    title: noteTitle(content, relativePath),
    type,
    status: fields.status || 'active',
    shortId: fields.short_id || '',
    updated: fields.updated || fields.created || '',
    tags: splitRefs(fields.tags),
    summary: fields.summary || readSection(content, ['摘要']) || firstContentSummary(content),
    content: content.trim(),
  }
}

function parseKnowledgeNotes(notes: ProjectDocumentNote[]): ProjectKnowledgeNote[] {
  return notes
    .filter((note) => note.type === 'knowledge' || note.path.startsWith(`${GLOBAL_KNOWLEDGE_DIR}/`))
    .map((note) => {
      const fields = parseFields(note.content)
      return {
        ...note,
        id: fields.id || '',
        aliases: splitRefs(fields.aliases),
        sourceProject: fields.source_project || '未标注项目',
        source: fields.source || '无',
        relatedRecords: splitRefs(fields.related_records),
        relatedTasks: splitRefs(fields.related_tasks),
        relatedNotes: splitRefs(fields.related_notes),
      }
    })
    .sort((a, b) => knowledgeSortKey(b).localeCompare(knowledgeSortKey(a)) || b.shortId.localeCompare(a.shortId) || a.title.localeCompare(b.title, 'zh-Hans-CN'))
}

function knowledgeSortKey(note: Pick<ProjectKnowledgeNote, 'updated' | 'shortId' | 'title'>) {
  return [
    note.updated ? parseDisplayTimeKey(note.updated) : '000000000000',
    note.shortId,
    note.title,
  ].join('\u0000')
}

function noteTypeFromPath(relativePath: string) {
  if (relativePath.startsWith('tasks/')) return 'task'
  if (relativePath.startsWith('thoughts/')) return 'thought'
  if (relativePath.startsWith('research/')) return 'research'
  if (relativePath.startsWith('collaboration/')) return 'collaboration'
  if (relativePath.startsWith('constraints/')) return 'constraint'
  if (relativePath.startsWith('work-logs/')) return 'work-log'
  if (relativePath.startsWith('documents/')) return 'document'
  if (relativePath.startsWith(`${GLOBAL_KNOWLEDGE_DIR}/`)) return 'knowledge'
  return 'note'
}

function noteTitle(content: string, relativePath: string) {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim()
    || content.match(/^##\s+(.+)$/m)?.[1]?.trim()
    || path.basename(relativePath, '.md')
}

function firstContentSummary(content: string) {
  const text = stripFencedCode(content)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^#+\s+/.test(line) && !/^[A-Za-z0-9_-]+::\s*/.test(line) && !/^>/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, 120)
}

function stripFencedCode(content: string) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  let inFence = false
  return lines
    .filter((line) => {
      if (/^\s*(?:```|~~~)/.test(line)) {
        inFence = !inFence
        return false
      }
      return !inFence
    })
    .join('\n')
}

async function replyTaskOpenQuestion(dataRoot: string, input: OpenQuestionReplyInput, answer: string) {
  const current = await readProjectFile(dataRoot, TASKS_PATH)
  let handled = false
  const next = updateMarkdownBlocks(current, (block) => {
    const fields = parseFields(block)
    const matchesTask = input.shortId
      ? fields.short_id === input.shortId
      : block.includes(input.title || input.openQuestions)
    if (!matchesTask) return block

    handled = true
    const remaining = removeListItemText(readSection(block, ['未确认事项']), input.openQuestions)
    const replacement = remaining.length ? remaining.map((item) => `- ${item}`).join('\n') : '无。'
    const withQuestions = replaceSection(block, ['未确认事项'], '未确认事项', replacement)
    return appendToSection(withQuestions, '回答记录', `- ${formatQuestionReply(input, answer)}`)
  })

  if (!handled) throw new Error('未找到未确认事项来源')
  await writeProjectFile(dataRoot, TASKS_PATH, next)
}

async function replyThoughtOpenQuestion(dataRoot: string, input: OpenQuestionReplyInput, answer: string) {
  const current = await readProjectFile(dataRoot, THOUGHTS_PATH)
  let handled = false
  const next = updateMarkdownBlocks(current, (block) => {
    const fields = parseFields(block)
    const title = block.match(/^##\s+(.+)$/m)?.[1]?.trim() || ''
    const matchesThought = input.thoughtId
      ? fields.id === input.thoughtId
      : input.shortId
        ? fields.short_id === input.shortId
        : title === input.title || block.includes(input.openQuestions)
    if (!matchesThought) return block

    handled = true
    const remaining = removeListItemText(readSection(block, ['未确认事项']), input.openQuestions)
    const replacement = remaining.length ? remaining.map((item) => `- ${item}`).join('\n') : '无。'
    const withQuestions = replaceSection(block, ['未确认事项'], '未确认事项', replacement)
    return appendToSection(withQuestions, '回答记录', `- ${formatQuestionReply(input, answer)}`)
  })

  if (!handled) throw new Error('未找到未确认事项来源')
  await writeProjectFile(dataRoot, THOUGHTS_PATH, next)
}

async function replyLogOpenQuestion(dataRoot: string, input: OpenQuestionReplyInput, answer: string) {
  const current = await readProjectFile(dataRoot, AGENT_LOG_PATH)
  let handled = false
  const next = updateMarkdownBlocks(current, (block) => {
    const title = block.match(/^##\s+(.+)$/m)?.[1]?.trim() || ''
    if (title !== input.title && !block.includes(input.openQuestions)) return block

    handled = true
    const remaining = removeListItemText(readSection(block, ['未确认事项']), input.openQuestions)
    const replacement = remaining.length ? remaining.map((item) => `- ${item}`).join('\n') : '无。'
    const withQuestions = replaceSection(block, ['未确认事项'], '未确认事项', replacement)
    return appendToSection(withQuestions, '回答记录', `- ${formatQuestionReply(input, answer)}`)
  })

  if (!handled) throw new Error('未找到未确认事项来源')
  await writeProjectFile(dataRoot, AGENT_LOG_PATH, next)
}

function updateMarkdownBlocks(content: string, update: (block: string) => string) {
  const next = content
    .split(/\n(?=##\s+)/)
    .map((block, index) => {
      if (index === 0 && !block.trim().startsWith('## ')) return block.trimEnd()
      return update(block.trim())
    })
    .filter(Boolean)
    .join('\n\n')
  return `${next.trimEnd()}\n`
}

function replaceSection(content: string, titles: string[], title: string, value: string) {
  const escaped = titles.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const pattern = new RegExp(`###\\s+(?:${escaped})\\s+[\\s\\S]*?(?=\\n### |\\n## |$)`)
  const replacement = `### ${title}\n\n${value.trim()}`
  return pattern.test(content) ? content.replace(pattern, replacement) : `${content.trimEnd()}\n\n${replacement}`
}

function appendToSection(content: string, title: string, line: string) {
  const current = readSection(content, [title])
  const value = current ? `${current.trim()}\n${line}` : line
  return replaceSection(content, [title], title, value)
}

function removeListItemText(section: string, target: string) {
  const normalizedTarget = normalizeQuestionText(target)
  return section
    .split('\n')
    .map((line) => line.trim().replace(/^[-*]\s+/, ''))
    .filter((line) => line && !/^(?:无|暂无|没有|none|n\/a)[。.!！]?$/i.test(line))
    .filter((line) => normalizeQuestionText(line) !== normalizedTarget)
}

async function writeCollaborationEntry(projectRoot: string, dataRoot: string) {
  const knowledgeRoot = path.join(path.dirname(path.dirname(dataRoot)), GLOBAL_KNOWLEDGE_DIR)
  const content = `# Electron Manager Collaboration

This project is managed by Electron Manager.

## Managed Data

Data root:

\`${dataRoot}\`

Agent brief:

\`${path.join(dataRoot, 'agent-brief.json')}\`

Shared knowledge root:

\`${knowledgeRoot}\`

Local skill:

\`${path.join(dataRoot, SKILL_PATH)}\`

Project constraints:

\`${path.join(dataRoot, CONSTRAINTS_PATH)}\`

## Agent Start

1. Read the agent brief first.
2. Read the local skill before writing tasks or agent logs.
3. Read project constraints for current global rules.
4. If more context is needed, read the Markdown files in the managed data root.
`
  await writeFile(path.join(projectRoot, COLLABORATION_ENTRY), content, 'utf8')
}

async function ensureCollaborationIgnored(projectRoot: string) {
  const gitignorePath = path.join(projectRoot, '.gitignore')
  let current = ''

  try {
    current = await readFile(gitignorePath, 'utf8')
  } catch {
    await writeFile(gitignorePath, `${COLLABORATION_ENTRY}\n`, 'utf8')
    return
  }

  const alreadyIgnored = current
    .split(/\r?\n/)
    .some((line) => line.trim() === COLLABORATION_ENTRY)
  if (alreadyIgnored) return

  const separator = current.endsWith('\n') || current.length === 0 ? '' : '\n'
  await writeFile(gitignorePath, `${current}${separator}${COLLABORATION_ENTRY}\n`, 'utf8')
}

async function upsertProjectIndex(managerDataRoot: string, config: ProjectConfig) {
  const indexPath = path.join(managerDataRoot, 'projects.json')
  const projects = await readProjectIndex(managerDataRoot)

  const now = new Date().toISOString()
  const next: ManagedProject = {
    projectId: config.projectId,
    projectName: config.name,
    projectRoot: config.projectRoot,
    dataRoot: config.dataRoot,
    createdAt: projects.find((project) => project.projectId === config.projectId)?.createdAt || config.createdAt,
    lastOpenedAt: now,
  }
  const merged = [next, ...projects.filter((project) => project.projectId !== config.projectId)]
  await mkdir(managerDataRoot, { recursive: true })
  await writeFile(indexPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
}

async function readProjectIndex(managerDataRoot: string): Promise<ManagedProject[]> {
  try {
    return JSON.parse(await readFile(path.join(managerDataRoot, 'projects.json'), 'utf8')) as ManagedProject[]
  } catch {
    return []
  }
}

function parseProjectTasks(content: string): ProjectTask[] {
  return content
    .split(/\n(?=##\s+)/)
    .filter((block) => block.trim().startsWith('## '))
    .map((block) => {
      const fields = parseFields(block)
      return {
        id: fields.id || '',
        shortId: fields.short_id || '',
        title: block.match(/^##\s+(.+)$/m)?.[1]?.trim() || '未命名任务',
        status: fields.status || 'todo',
        priority: fields.priority || 'medium',
        area: fields.area || 'tool',
        updated: fields.updated || fields.created || '',
        detail: readSection(block, ['执行范围']),
        acceptance: readSection(block, ['验收']),
        openQuestions: readSection(block, ['未确认事项']),
      }
    })
}

function parseThoughts(content: string): ProjectThought[] {
  return content
    .split(/\n(?=##\s+)/)
    .filter((block) => block.trim().startsWith('## '))
    .map((block) => {
      const fields = parseFields(block)
      return {
        id: fields.id || '',
        shortId: fields.short_id || '',
        title: block.match(/^##\s+(.+)$/m)?.[1]?.trim() || '输入',
        status: fields.status || 'inbox',
        created: fields.created || '',
        content: readSection(block, ['内容']),
        answer: readSection(block, ['回答']),
        openQuestions: readSection(block, ['未确认事项']),
        replyRecords: readListSection(block, ['回答记录']),
      }
    })
}

function parseUserConstraints(content: string): ProjectConstraint[] {
  return content
    .split(/\n(?=##\s+)/)
    .filter((block) => block.trim().startsWith('## '))
    .map((block) => {
      const fields = parseFields(block)
      const constraintContent = readSection(block, ['内容']) || firstContentSummary(block)
      const title = block.match(/^##\s+(.+)$/m)?.[1]?.trim() || '项目约束'
      return {
        id: fields.id || '',
        shortId: normalizeConstraintShortId(fields.short_id),
        title,
        status: normalizeConstraintStatus(fields.status || 'active'),
        scope: fields.scope || 'project',
        source: 'user' as const,
        created: fields.created || '',
        updated: fields.updated || fields.created || '',
        path: CONSTRAINTS_PATH,
        summary: firstContentSummary(constraintContent) || title,
        content: block.trim(),
      }
    })
    .sort((a, b) => b.shortId.localeCompare(a.shortId) || parseDisplayTimeKey(b.updated).localeCompare(parseDisplayTimeKey(a.updated)))
}

function parseDialogues(content: string): ProjectDialogue[] {
  return content
    .split(/\n(?=##\s+)/)
    .filter((block) => block.trim().startsWith('## '))
    .map((block) => {
      const title = block.match(/^##\s+(.+)$/m)?.[1]?.trim() || '研究'
      const fields = parseFields(block)
      return {
        id: fields.id || '',
        shortId: normalizeDialogueShortId(fields.short_id),
        title,
        created: fields.created || '',
        tags: splitRefs(fields.tags),
        relatedTasks: splitRefs(fields.related_tasks),
        relatedThoughts: splitRefs(fields.related_thoughts),
        relatedDocuments: splitRefs(fields.related_documents),
        recordContent: readSection(block, ['内容']),
        answer: readSection(block, ['回答']),
        acceptance: readSection(block, ['验收标准']),
        content: block.trim(),
      }
    })
    .sort((a, b) => dialogueSortKey(b).localeCompare(dialogueSortKey(a)) || b.shortId.localeCompare(a.shortId))
}

function dialogueSortKey(dialogue: Pick<ProjectDialogue, 'created' | 'title' | 'shortId'>) {
  return [
    parseDisplayTimeKey(dialogue.created || dialogue.title),
    dialogue.shortId,
  ].join('\u0000')
}

function parseProjectLogs(content: string, tasks: ProjectTask[] = []): ProjectLog[] {
  const taskByShortId = new Map(tasks.map((task) => [task.shortId, task]))
  const parsedLogs = content
    .split(/\n(?=##\s+)/)
    .filter((block) => block.trim().startsWith('## '))
    .map((block, index) => {
      const fields = parseFields(block)
      const relatedTasks = logTaskRefs(block, fields)
        .map((shortId) => {
          const task = taskByShortId.get(shortId)
          return {
            shortId,
            id: task?.id || '',
            title: task?.title || '',
            status: task?.status || '',
          }
        })
      return {
        shortId: normalizeLogShortId(fields.log_short_id),
        title: block.match(/^##\s+(.+)$/m)?.[1]?.trim() || '工作记录',
        created: fields.created || '',
        status: fields.status || relatedTasks[0]?.status || 'done',
        source: fields.source || '',
        userGoal: readSection(block, ['用户目标']),
        userOriginal: readSection(block, ['用户原话']),
        understanding: readSection(block, ['需求理解']),
        answer: readSection(block, ['回答']),
        executionScope: readSection(block, ['执行范围']),
        acceptance: readSection(block, ['验收标准']),
        outputs: readListSection(block, ['产出']),
        keySteps: readListSection(block, ['关键步骤']),
        decisions: readListSection(block, ['关键判断']),
        actions: readListSection(block, ['执行动作']),
        changedFiles: readListSection(block, ['修改文件']),
        verification: readListSection(block, ['验证']),
        openQuestions: readListSection(block, ['未确认事项']),
        replyRecords: readListSection(block, ['回答记录']),
        followUps: readListSection(block, ['后续事项']),
        relatedTasks,
        content: block.trim(),
        sortKey: projectLogSortKey(block, fields.created, index),
      }
    })
  return parsedLogs
    .sort((a, b) => b.sortKey.localeCompare(a.sortKey))
    .map(({ sortKey: _sortKey, ...log }) => log)
}

function logTaskRefs(_block: string, fields: Record<string, string>) {
  const explicitRefs = [
    fields.task_short_id,
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/[,，\s]+/))
  const refs = [...new Set(explicitRefs.map(normalizeTaskShortId).filter(Boolean))]
  return refs.length ? refs : ['T000']
}

function normalizeTaskShortId(value: string) {
  const match = String(value || '').trim().match(/^T(\d{1,4})$/i)
  return match ? `T${match[1].padStart(3, '0')}` : ''
}

function normalizeLogShortId(value: string) {
  const match = String(value || '').trim().match(/^L(\d{1,4})$/i)
  return match ? `L${match[1].padStart(3, '0')}` : ''
}

function normalizeDialogueShortId(value: string) {
  const match = String(value || '').trim().match(/^D(\d{1,4})$/i)
  return match ? `D${match[1].padStart(3, '0')}` : ''
}

function normalizeConstraintShortId(value: string) {
  const match = String(value || '').trim().match(/^C(\d{1,4})$/i)
  return match ? `C${match[1].padStart(3, '0')}` : ''
}

function splitRefs(value: string) {
  return String(value || '')
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function projectLogSortKey(block: string, created: string, order: number) {
  const title = block.match(/^##\s+(.+)$/m)?.[1] || ''
  const titleTime = title.match(/(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/)
  const date = titleTime?.[1] || created.slice(0, 10) || '0000-00-00'
  const time = titleTime?.[2] || created.match(/\d{2}:\d{2}/)?.[0] || '00:00'
  const reverseOrder = 999999 - order
  return `${date} ${time} ${String(reverseOrder).padStart(6, '0')}`
}

function parseFields(block: string) {
  const fields: Record<string, string> = {}
  for (const line of stripFencedCode(block).split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+)::\s*(.+)$/)
    if (match) fields[match[1]] = match[2].trim()
  }
  return fields
}

function parseTaskReplyRecords(content: string): Array<Omit<ProjectReplyRecord, 'displayId' | 'relations'>> {
  return content
    .split(/\n(?=##\s+)/)
    .filter((block) => block.trim().startsWith('## '))
    .flatMap((block) => {
      const fields = parseFields(block)
      const title = block.match(/^##\s+(.+)$/m)?.[1]?.trim() || '任务'
      return readListSection(block, ['回答记录']).flatMap((reply) => {
        const parsed = parseReplyRecordParts(reply)
        if (!parsed) return []
        return [{
          ...parsed,
          source: 'task' as const,
          shortId: fields.short_id || '',
          title,
          reply,
          created: fields.updated || fields.created || '',
        }]
      })
    })
}

function assignOpenQuestionIds(items: Array<Omit<ProjectOpenQuestion, 'id' | 'displayId' | 'relations'>>): ProjectOpenQuestion[] {
  const orderedIds = new Map(
    items
      .slice()
      .sort(compareOpenQuestionsForNumbering)
      .map((item, index) => [item, createQuestionId(item, index)]),
  )
  return items.map((item) => ({
    ...enrichOpenQuestion(item, orderedIds.get(item) || createQuestionId(item, 0)),
  }))
}

function compareOpenQuestionsForNumbering(
  a: Omit<ProjectOpenQuestion, 'id' | 'displayId' | 'relations'>,
  b: Omit<ProjectOpenQuestion, 'id' | 'displayId' | 'relations'>,
) {
  return openQuestionSortKey(a).localeCompare(openQuestionSortKey(b))
}

function openQuestionSortKey(item: Pick<ProjectOpenQuestion, 'created' | 'source' | 'shortId' | 'title' | 'openQuestions'>) {
  return [
    parseDisplayTimeKey(item.created),
    item.source,
    item.shortId,
    item.title,
    item.openQuestions,
  ].join('\u0000')
}

function enrichOpenQuestion(item: Omit<ProjectOpenQuestion, 'id' | 'displayId' | 'relations'>, id: string): ProjectOpenQuestion {
  return {
    id,
    displayId: displayQuestionId(id),
    relations: questionRelations(item),
    ...item,
  }
}

function enrichReplyRecord(item: Omit<ProjectReplyRecord, 'displayId' | 'relations'>): ProjectReplyRecord {
  return {
    displayId: displayQuestionId(item.questionId),
    relations: questionRelations(item),
    ...item,
  }
}

function displayQuestionId(id: string) {
  return id.match(/^(Q\d{3})\b/)?.[1] || id
}

function questionRelations(item: Pick<ProjectOpenQuestion | ProjectReplyRecord, 'shortId' | 'source'>) {
  const relations = []
  if (item.shortId) relations.push(item.shortId)
  if (item.source === 'thought') relations.push('想法')
  return [...new Set(relations)]
}

function createQuestionId(item: Pick<ProjectOpenQuestion, 'source' | 'shortId' | 'title' | 'openQuestions'>, index: number) {
  const seed = `${item.source}:${item.shortId}:${item.title}:${item.openQuestions}`
  const hash = createHash('sha1').update(seed).digest('hex').slice(0, 4).toUpperCase()
  return `Q${String(index + 1).padStart(3, '0')}-${hash}`
}

function parseReplyQuestionId(reply: string) {
  return reply.match(/\b(Q\d{3}-[A-F0-9]{4})\b/)?.[1] || ''
}

function parseReplyQuestionText(reply: string) {
  return reply.match(/问题：(.+?)(?:\s+回复：|$)/)?.[1]?.trim() || ''
}

function parseReplyCreated(reply: string) {
  return reply.match(/\bQ\d{3}-[A-F0-9]{4}\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/)?.[1] || ''
}

function parseReplyAnswer(reply: string) {
  return reply.match(/回复：([\s\S]*)$/)?.[1]?.trim() || ''
}

function parseReplyRecordParts(reply: string) {
  const questionId = parseReplyQuestionId(reply)
  const openQuestions = parseReplyQuestionText(reply)
  const replyCreated = parseReplyCreated(reply)
  const replyAnswer = parseReplyAnswer(reply)
  if (!questionId || !openQuestions || !replyCreated) return null
  return { questionId, openQuestions, replyCreated, replyAnswer }
}

function formatQuestionReply(input: OpenQuestionReplyInput, answer: string) {
  const id = input.questionId || ''
  const prefix = id ? `${id} ` : ''
  return `${prefix}${localTime()} 问题：${input.openQuestions} 回复：${answer}`
}

function readSection(content: string, titles: string[]) {
  const escaped = titles.map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const match = content.match(new RegExp(`###\\s+(?:${escaped})\\s+([\\s\\S]*?)(?=\\n### |\\n## |$)`))
  return (match?.[1] || '').trim()
}

function readListSection(content: string, titles: string[]) {
  return listSectionItems(readSection(content, titles))
}

function listSectionItems(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim().replace(/^[-*]\s+/, ''))
    .filter((line) => line && !/^(?:无|暂无|没有|none|n\/a)[。.!！]?$/i.test(line))
}

function hasOpenQuestionText(value: string) {
  const text = normalizeQuestionText(value)
  return Boolean(text && !/^(?:无|暂无|没有|none|n\/a)[。.!！]?$/i.test(text))
}

function normalizeQuestionText(value: string) {
  return value.trim().replace(/^[-*]\s*/, '').replace(/\s+/g, '')
}

function indexFromDashboard(dashboard: Dashboard) {
  return {
    generatedAt: new Date().toISOString(),
    project: dashboard.config.name,
    taskCount: dashboard.tasks.length,
    dialogueCount: dashboard.dialogues.length,
    knowledgeCount: dashboard.knowledge.length,
    documentCount: dashboard.documents.length,
    constraintCount: dashboard.constraints.length,
    activeTaskCount: dashboard.activeTasks.length,
    openQuestionCount: dashboard.openQuestions.length,
  }
}

function taskToMarkdown(
  task: ProjectTask,
  meta: { created: string; userOriginal: string; agentUnderstanding: string },
) {
  return `## ${task.title}

id:: ${task.id}
short_id:: ${task.shortId}
type:: task
status:: ${task.status}
priority:: ${task.priority}
area:: ${task.area}
created:: ${meta.created}
updated:: ${task.updated}

### 用户原话

${meta.userOriginal}

### Agent 理解

${meta.agentUnderstanding}

### 执行范围

${task.detail}

### 验收

${task.acceptance}

### 未确认事项

${task.openQuestions}
`
}

function researchDocumentMarkdown(input: {
  title: string
  shortId: string
  dialogueShortId: string
  created: string
  content: string
  answer: string
  acceptance: string
}) {
  return `# ${input.title}

id:: document-${Date.now()}-${slug(input.title)}
short_id:: ${input.shortId}
type:: document
status:: active
created:: ${input.created}
updated:: ${input.created}
tags:: research, document
source:: ${input.dialogueShortId}
summary:: ${firstMeaningfulLine(input.answer) || firstMeaningfulLine(input.content)}

## 研究概要

${firstMeaningfulLine(input.content)}

## 默认研究标准

${input.acceptance}

## 研究输入

${input.content}

## 研究结果

${input.answer}
`
}

function researchLogMarkdown(input: {
  title: string
  logShortId: string
  dialogueShortId: string
  documentShortId: string
  documentPath: string
  created: string
  summary: string
  acceptance: string
}) {
  return `## ${input.created} 研究记录 ${input.dialogueShortId}

type:: agent-log
log_short_id:: ${input.logShortId}
created:: ${input.created}
task_short_id:: T000
source:: research

### 用户目标

保存研究：${input.title}

### 需求理解

研究需要保留概要、详细文档和工作记录，避免结论只停留在研究页。

### 产出

- 研究概要：${input.dialogueShortId}
- 详细文档：${input.documentShortId}（${input.documentPath}）

### 关键步骤

- 保存研究概要。
- 生成项目文档。
- 写入研究工作记录。

### 执行动作

- 写入 ${DIALOGUES_PATH}
- 写入 ${input.documentPath}
- 写入 ${AGENT_LOG_PATH}

### 验证

- 研究概要、详细文档和工作记录已生成。

### 验收标准

${input.acceptance}

### 未确认事项

无。
`
}

function insertMarkdownEntry(current: string, entry: string) {
  const blocks = current.split(/\n(?=##\s+)/)
  const preface = blocks.shift() || ''
  return `${preface.trimEnd()}\n\n${entry.trim()}\n\n${blocks.map((block) => block.trim()).filter(Boolean).join('\n\n')}\n`
}

function normalizeTitle(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function defaultResearchStandard() {
  return `默认采用 Tree-of-Thought 研究方式：至少给出 3 条可选路径；每条路径必须包含思路、优点、缺点和适用条件；最后给出建议结论。用户可以在验收标准中覆盖或细化这套默认标准。`
}

function firstMeaningfulLine(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .find(Boolean) || '暂无摘要。'
}

function parseDisplayTimeKey(value: string) {
  const text = String(value || '').trim()
  const localMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/)
  if (localMatch) {
    return [
      localMatch[1],
      localMatch[2].padStart(2, '0'),
      localMatch[3].padStart(2, '0'),
      String(localMatch[4] || '0').padStart(2, '0'),
      String(localMatch[5] || '0').padStart(2, '0'),
    ].join('')
  }
  const timestamp = Date.parse(text)
  return Number.isNaN(timestamp) ? '999999999999' : String(timestamp).padStart(12, '0')
}

function normalizeStatus(value: string) {
  return ['backlog', 'todo', 'doing', 'done', 'abandoned'].includes(value) ? value : 'todo'
}

function normalizeConstraintStatus(value: string) {
  return ['active', 'draft', 'archived', 'readonly'].includes(value) ? value : 'active'
}

function nextShortId(values: string[], prefix: string) {
  const next = Math.max(0, ...values.map((value) => Number(value.match(/\d+$/)?.[0] || 0))) + 1
  return `${prefix}${String(next).padStart(3, '0')}`
}

function createId(prefix: string, value: string) {
  return `${prefix}-${Date.now()}-${value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'item'}`
}

function tasksTemplate(projectName: string) {
  const now = localTime()
  return `# 工程任务

> Electron Manager 初始化的数据源。每个二级标题是一张任务卡。
> 写入时必须按 short_id 倒序维护：较大的 Txxx 写在较小的 Txxx 上方，例如 T036 在 T001 上面。

## 初始化 ${projectName} 项目协作数据

id:: task-${Date.now()}-init-agent-hub
short_id:: T001
type:: task
status:: done
priority:: high
area:: tool
created:: ${now}
updated:: ${now}

### 用户原话

初始化项目协作数据。

### Agent 理解

已为项目创建 Electron Manager 管理数据、agent brief 和本地协作 skill。

### 执行范围

- 创建任务、输入、研究、工作记录、文档目录和协作规则文件。
- 生成 agent-brief.json。
- 生成本地协作 skill。

### 验收

- Electron Manager 管理数据目录存在。
- agent-brief.json 存在。
- skills/project-collaboration/SKILL.md 存在。

### 未确认事项

无。
`
}

function dataSpecTemplate() {
  return `# 数据层规范

## 基本原则

- Markdown 是主数据源。
- JSON 只作为配置、同步包和可再生成缓存。
- 任务卡必须保留用户原话、Agent 理解、执行范围、验收和未确认事项。
- 所有记录型 Markdown 都必须按 ID 倒序维护：较大的 \`Txxx\`、\`Ixxx\`、\`Dxxx\`、\`Wxxx\`、\`Kxxx\`、\`Lxxx\`、\`Cxxx\` 写在较小 ID 上方，例如 \`T036\` 在 \`T001\` 上面、\`D012\` 在 \`D001\` 上面。这是写入准则，不依赖界面排序或解析层重排。
- 工作记录必须保留用户目标、需求理解、产出、关键步骤、验证、验收标准和未确认事项。
- 研究保存概要、研究标准和详细文档引用，使用 \`Dxxx\` 作为引用 ID；详细研究过程、路径分析和结论写入关联 \`Wxxx\` 文档。
- 处理 \`Dxxx\` 研究时，必须同时读取 \`### 内容\` 和 \`### 验收标准\`；\`### 验收标准\` 是 Agent 回答或执行的约束，不是仅供 UI 展示的备注。
- 研究默认采用 Tree-of-Thought：至少给出 3 条路径，并写明各自优点、缺点、适用条件和建议结论；用户可以自定义或覆盖这个默认标准。
- 研究页只保留概要和详细文档引用；详细研究结果写入 \`${DOCUMENTS_DIR}/\` 的 \`Wxxx\` 文档，同时写入 Agent 工作记录。
- 文档保存项目本地资料、手册、说明和附件型 Markdown，使用 \`Wxxx\` 作为引用 ID；文档不自动进入知识库。
- 知识条目保存沉淀后的稳定知识、可复用结论、方案和运行经验，使用 \`Kxxx\` 作为引用 ID。
- 项目约束保存当前项目全局规则、长期约定和 Agent 必须遵守的协作准则，使用 \`Cxxx\` 作为引用 ID；系统生成的数据规范、交接说明和本地 SKILL 作为只读系统约束展示，不从用户约束文件删除。
- 数据结构、字段或文件名调整后，应一次性整理当前 Markdown 数据并补齐缺失字段；没有内容写 \`无\` 或 \`暂无\`，不要新增长期运行时兼容判断或只在界面兜底。
- 未确认事项由 Electron Manager 展示为独立 QID；任务 \`Txxx\`、想法 \`Ixxx\` 和工作记录引用 \`Lxxx\` 只作为 relation，不复用为未确认事项 ID。工作记录仍是任务副产品，不是独立执行模块。
- 执行任务前将状态改为 doing，完成验收后改为 done。
- 输入/想法被处理时，不能只修改 status；必须写入 \`### 回答\`，说明处理结论、关联任务或不处理原因。
- 整理输入/想法时，只更新 \`${THOUGHTS_PATH}\` 的 \`### 回答\` 和必要任务卡；不要为单纯想法整理写 Agent 工作记录。
- 只有执行工程任务、修改代码/文档/规则或完成验收后，才写入 Agent 工作记录。

## 工作流顺序

\`\`\`text
想法/输入 -> 整理回答 -> 必要时产生任务 -> 任务进入 todo/doing/done -> 任务执行并验收后写 Agent 工作记录
\`\`\`

- 想法/输入是收集入口，不代表承诺执行。
- 整理想法时只更新 \`${THOUGHTS_PATH}\` 的 \`### 回答\`，必要时创建或关联任务短 ID。
- 任务是执行单位，必须有明确状态：\`todo\`、\`doing\`、\`done\` 或 \`abandoned\`。
- Agent 开始执行任务前，把任务改为 \`doing\`；验收通过后改为 \`done\`。
- Agent 工作记录只记录任务执行、代码/文档/规则修改和验收过程，不记录单纯想法整理。

## 输入/想法记录格式

\`\`\`markdown
## YYYY-MM-DD HH:mm 想法

id:: thought-...
short_id:: I001
status:: inbox
type:: thought
created:: YYYY-MM-DD HH:mm

### 内容

用户输入原文。

### 回答

处理结论。若已转成任务，写明关联任务短 ID；若不处理，写明原因。

### 未确认事项

无。
\`\`\`

\`status\` 表示处理状态，\`### 回答\` 表示处理结论。标记为 done/handled 前必须先补充回答。
如果想法本身产生待确认事项，写入 \`### 未确认事项\`；Electron Manager 会分配独立 QID，并把 \`Ixxx\` 作为 relation。
如果想法被整理成任务，只在回答中写明关联任务短 ID；后续 Agent 工作记录只记录该任务真正执行和验收的过程。

## 知识条目格式

\`\`\`markdown
# 知识标题

id:: knowledge-...
short_id:: K001
type:: knowledge
status:: draft | active | archived
created:: YYYY-MM-DD HH:mm
updated:: YYYY-MM-DD HH:mm
tags:: electron, local-first
aliases:: 无
source_project:: 项目名称
source:: D001
related_records:: D001
related_tasks:: T001
related_notes:: K002
summary:: 这条知识保存的稳定结论。

## 正文

稳定知识、方案、运行经验或长期复用信息。
\`\`\`

知识条目是沉淀后的长期知识，不替代研究或文档。研究保存内容和简单回复；文档保存项目本地资料；知识条目保存详细答案、稳定结论、方案和经验。知识库位于 Electron Manager app data 外层的全局 \`${GLOBAL_KNOWLEDGE_DIR}/\` 目录，所有项目共享。知识文档被 Electron 读取或刷新 guidance 时，如果缺少 \`id\`、\`short_id\`、\`type\`、\`status\`、\`tags\`、\`source_project\`、\`summary\` 等字段，应直接补写为明确值，例如 \`无\` 或 \`暂无\`，不只依赖界面默认值。

展示规则：

- 知识库入口只展示 \`Kxxx\` 知识条目。
- 文档入口只展示项目数据目录下 \`${DOCUMENTS_DIR}/\` 文件夹中的 Markdown，不汇总任务、想法、研究、协作或工作记录等模块文件。
- \`无\`、\`暂无\` 等占位字段应保留在 Markdown 中，但不作为卡片关联信息展示。
- 研究和文档不会自动进入知识库；用户明确说“沉淀”“整理成知识库”“形成 K”，或要求 Agent 判断是否值得沉淀时，Agent 才汇总相关 \`Dxxx\`/\`Wxxx\`。
- 沉淀时应对照已有 \`Kxxx\`，判断新增、合并、更新、冲突或升华；不同主题可生成多个 \`Kxxx\`。
- 如果与已有知识冲突、缺少判断依据或需要用户选择，写入未确认事项，让协作页出现可回复问题，并关联相关 \`Dxxx\`/\`Wxxx\`/\`Kxxx\`。
- 生成或更新 \`Kxxx\` 时必须写明来源项目和来源记录，例如 \`source_project:: 项目名称\`、\`source:: D003\` 和 \`related_records:: D003\`。

## 文档格式

\`\`\`markdown
# 文档标题

id:: document-...
short_id:: W001
type:: document
status:: active | archived
created:: YYYY-MM-DD HH:mm
updated:: YYYY-MM-DD HH:mm
tags:: document
summary:: 这份文档的简短摘要。

## 正文

项目本地手册、说明、资料或其他 Markdown 文档。
\`\`\`

文档位于项目本地 \`${DOCUMENTS_DIR}/\` 目录，使用 \`Wxxx\` 独立编号。文档和知识库都是 Markdown，但语义不同：文档是项目资料，知识库是沉淀后的稳定结论。不要自动把文档转成知识；只有用户明确要求，或用户要求 Agent 判断是否值得沉淀时，Agent 才评估并建议生成或更新 \`Kxxx\`。

## 项目约束格式

\`\`\`markdown
## 约束标题

id:: constraint-...
short_id:: C001
type:: constraint
status:: active | draft | archived
scope:: project
created:: YYYY-MM-DD HH:mm
updated:: YYYY-MM-DD HH:mm

### 内容

需要当前项目所有 Agent 长期遵守的规则、边界或协作准则。
\`\`\`

约束位于项目本地 \`${CONSTRAINTS_PATH}\`，用于保存用户手动输入或要求 Agent 长期遵守的项目级全局规则。新增约束时按 \`Cxxx\` 倒序写入；删除操作只删除用户约束，不删除系统生成的数据规范、交接说明或本地 SKILL。

## 研究格式

\`\`\`markdown
## YYYY-MM-DD HH:mm 研究

id:: dialogue-...
short_id:: D001
type:: dialogue
created:: YYYY-MM-DD HH:mm
mode:: learning | research | decision
tags:: learning, research
related_tasks:: T001
related_thoughts:: I001
related_documents:: W001

### 内容

研究概要。详细输入、路径分析和结论放入关联的 Wxxx 文档。

### 回答

详细研究文档：W001

### 验收标准

默认采用 Tree-of-Thought 研究方式：至少给出 3 条可选路径；每条路径必须包含思路、优点、缺点和适用条件；最后给出建议结论。用户可以在验收标准中覆盖或细化这套默认标准。
\`\`\`

当用户要求处理某条 \`Dxxx\` 研究，或新 Agent 根据研究继续回答/执行时，必须把 \`### 验收标准\` 作为完成口径；如果用户没有自定义标准，使用默认 Tree-of-Thought 标准。研究记录本身只展示概要，详细内容必须写入关联 \`Wxxx\` 文档；研究动作也必须写入工作记录，避免结论流失。

研究不替代想法或任务：可执行事项仍应进入任务，待确认事项仍使用独立 QID，任务执行和验收仍写入工作记录。

写入触发规则：

- 用户明确说“记一下”“保存到研究”“这段很重要”“后面 Agent 要知道”时，直接写入研究。
- Agent 判断某段对话值得长期保留时，先询问用户是否保存为 \`Dxxx\`。
- 学习/预研项目中，思路演进、关键问答、方案比较和技术背景都可以进入研究。
- 常规工程项目中，研究主要保存重要背景、决策、约定和上下文。
- 临时 UI 微调、已进入任务的执行细节、工作记录验收过程、待确认事项和普通聊天不写研究。

## Agent 工作记录格式

~~~markdown
## YYYY-MM-DD HH:mm 工作标题

type:: agent-log
log_short_id:: L001
created:: YYYY-MM-DD HH:mm
task_short_id:: T001

### 用户目标

用户希望达成什么。

### 用户原话

用户原始输入。若没有单独原话，可省略。

### 需求理解

Agent 对目标、边界、风险和上下文的理解。

### 产出

- 已完成的可见结果。

### 关键步骤

- 最关键的实现或判断步骤。

### 关键判断

- 重要取舍和原因。

### 执行动作

- 实际执行的代码、文档或数据修改。

### 修改文件

- /absolute/path/to/file

### 验证

- 使用过的验证命令和结果。

### 验收标准

- 判断任务完成的标准。

### 未确认事项

无。
~~~
`
}

function handoffTemplate(projectRoot: string) {
  return `# Agent 同步交接

## 启动顺序

1. 先读取 Electron Manager 管理数据目录中的 \`agent-brief.json\`。
2. 再读取 \`skills/project-collaboration/SKILL.md\`，写任务和工作记录时必须遵守其中规则。
3. 需要完整上下文时读取 \`${TASKS_PATH}\` 和 \`${AGENT_LOG_PATH}\`。
4. 写入或整理记录时，任务、想法、研究、文档、知识、工作记录和项目约束 Markdown 都必须按 ID 倒序维护：较大的 \`Txxx\`、\`Ixxx\`、\`Dxxx\`、\`Wxxx\`、\`Kxxx\`、\`Lxxx\`、\`Cxxx\` 写在较小 ID 上方，例如 \`T036\` 在 \`T001\` 上面。
5. 处理 \`Dxxx\` 研究时读取 \`${DIALOGUES_PATH}\`，同时使用 \`### 内容\` 和 \`### 验收标准\`；验收标准是回答或执行的完成口径。默认研究标准是 Tree-of-Thought：至少 3 条路径，并写明各自优缺点、适用条件和建议结论。
6. 需要长期知识时读取全局共享知识库 \`${GLOBAL_KNOWLEDGE_DIR}/\` 中的 \`Kxxx\` 条目；知识库不属于单个项目。
7. 需要当前项目全局约束时读取 \`${CONSTRAINTS_PATH}\` 中的 \`Cxxx\` 条目；系统生成的数据规范、交接说明和本地 SKILL 是只读系统约束。
8. 执行任务前更新任务状态为 doing。
9. 完成验收后更新任务状态为 done，并写入工作记录。
10. 整理输入/想法时只写回想法回答和必要任务卡；没有执行工程任务时，不写入 Agent 工作记录。

## 工作流顺序

\`\`\`text
想法/输入 -> 整理回答 -> 必要时产生任务 -> 任务进入 todo/doing/done -> 任务执行并验收后写 Agent 工作记录
\`\`\`

- 想法是入口，任务是执行单位，工作记录是任务执行后的记录。
- 研究保存概要、标准和详细文档引用，使用 \`Dxxx\` 引用；详细研究结果写入 \`Wxxx\` 文档，研究动作写入工作记录。
- 文档保存项目本地资料和说明，使用 \`Wxxx\` 引用；文档不会自动进入知识库。
- 项目约束保存当前项目长期规则，使用 \`Cxxx\` 引用；新增约束要写入 \`${CONSTRAINTS_PATH}\`。
- 处理研究时不要只看标题或内容；必须检查同一条记录的 \`### 验收标准\`，并用它校准回答深度、列举范围、验证方式或交付边界。没有自定义标准时，按默认 Tree-of-Thought 标准执行。
- 想法被采纳时，在 \`### 回答\` 中写清关联任务短 ID。
- 待确认事项是独立 QID；用 relation 标明关联的 \`Txxx\`、\`Ixxx\` 或工作记录引用 \`Lxxx\`。
- 任务开始前更新为 \`doing\`，验收通过后更新为 \`done\`。
- 只有实际执行任务、修改代码/文档/规则或完成验收时，才写 Agent 工作记录。

## 工作记录要求

写入 \`${AGENT_LOG_PATH}\` 时必须保留：

- \`### 用户目标\`
- \`### 需求理解\`
- \`### 产出\`
- \`### 关键步骤\`
- \`### 执行动作\`
- \`### 验证\`
- \`### 验收标准\`
- \`### 未确认事项\`

## 本地 Skill

协作说明位于 Electron Manager 管理数据目录中的 \`skills/project-collaboration/SKILL.md\`。
`
}

function thoughtsTemplate() {
  return `# 想法与问题

> 这里记录输入、想法、问题和待确认回复。
> 写入时必须按 short_id 倒序维护：较大的 Ixxx 写在较小的 Ixxx 上方，例如 I036 在 I001 上面。
`
}

function dialoguesTemplate() {
  return `# 研究

> 这里记录研究概要、研究标准和详细文档引用；详细研究结果写入 documents/ 下的 Wxxx 文档。
> 写入时必须按 short_id 倒序维护：较大的 Dxxx 写在较小的 Dxxx 上方，例如 D036 在 D001 上面。

## ${localTime()} 初始化研究

id:: dialogue-${Date.now()}-init
short_id:: D001
type:: dialogue
created:: ${localTime()}
mode:: decision
tags:: init
related_tasks:: T001
related_thoughts:: 无

### 内容

Electron Manager 初始化项目管理数据。

### 回答

初始化研究入口。研究用于保存思路演进、关键问答、方案比较、技术背景和重要上下文；详细答案和可长期复用结论应沉淀到知识库。

### 验收标准

无。
`
}

function agentLogTemplate() {
  return `# Agent 工作记录

> 写入时必须按记录 ID 倒序维护：较大的 Lxxx 写在较小的 Lxxx 上方，例如 L036 在 L001 上面。

## 初始化 Agent Hub

type:: agent-log
log_short_id:: L001
created:: ${localTime()}
task_short_id:: T001

### 用户目标

初始化项目协作数据。

### 需求理解

为当前项目创建可供 Electron Manager 和其他 Agent 共同读取的本地协作数据。

### 产出

- Electron Manager 管理数据目录。
- agent-brief.json。
- 本地协作 skill。

### 关键步骤

- 创建 Markdown 主数据文件。
- 写入项目协作入口。
- 生成 Agent 同步说明。

### 执行动作

- 创建 Electron Manager 管理数据目录。
- 生成 agent-brief.json。
- 生成本地协作 skill。

### 验收标准

- Electron Manager 管理数据目录存在。
- agent-brief.json 存在。
- 本地协作 skill 存在。

### 未确认事项

无。
`
}

function changeIndexTemplate() {
  return `# 需求变更索引

> 业务范围、页面能力、交互方式和数据模型变化记录在这里。
`
}

function constraintsTemplate() {
  return `# 项目约束

> 当前项目的全局约束、协作准则和长期规则。手动写入时使用 Cxxx，并按 short_id 倒序维护：较大的 Cxxx 写在较小的 Cxxx 上方，例如 C036 在 C001 上面。
> 系统生成的协作规则会在界面中作为只读约束展示；这里主要保存用户手动补充或要求 Agent 长期遵守的项目约束。
`
}

function skillTemplate(projectRoot: string, dataRoot: string) {
  return `# Project Collaboration Skill

Use this skill when working on this project with Electron Manager initialized data.

## Data Root

\`${dataRoot}\`

## Start Here

1. Read \`${path.join(dataRoot, 'agent-brief.json')}\`.
2. Read this skill file before writing tasks or agent logs: \`${path.join(dataRoot, SKILL_PATH)}\`.
3. If more context is needed, read \`${path.join(dataRoot, TASKS_PATH)}\`.
4. Read \`${path.join(dataRoot, CONSTRAINTS_PATH)}\` for current project constraints.
5. Read \`${path.join(dataRoot, AGENT_LOG_PATH)}\` for recent decisions.

## Rules

- Before executing a task, set its status to \`doing\`.
- After verification, set its status to \`done\`.
- Keep all record Markdown physically ordered by descending record ID: larger \`Txxx\`, \`Ixxx\`, \`Dxxx\`, \`Wxxx\`, \`Kxxx\`, \`Lxxx\`, and \`Cxxx\` entries must appear above smaller IDs, for example \`T036\` above \`T001\` and \`D012\` above \`D001\`. This is a writing rule; do not rely on UI sorting or parser reordering to fix record order.
- Preserve user wording in \`### 用户原话\`.
- Keep \`### Agent 理解\`, \`### 执行范围\`, \`### 验收\`, and \`### 未确认事项\` explicit.
- Keep agent logs explicit with \`### 需求理解\`, \`### 产出\`, \`### 关键步骤\`, \`### 验证\`, \`### 验收标准\`, and \`### 未确认事项\`.
- Agent logs should include \`log_short_id:: Lxxx\` and should include \`task_short_id:: Txxx\` for real task execution; general logs without a task relation use \`T000\`.
- Put acceptance criteria near the end of agent logs, after execution and verification details.
- Do not omit required agent-log sections just because the UI can display \`未记录\`; write the sections into Markdown.
- When data structures, fields, or file names change, normalize the current Markdown data in place and fill missing fields with explicit values such as \`无\` or \`暂无\`. Do not add long-lived runtime compatibility branches or rely only on UI fallbacks.
- Treat open questions as independent QID items in Electron Manager. Task short IDs, thought short IDs, and work-log reference IDs such as \`L001\` are relation labels, not open-question IDs.
- Treat work logs as task execution byproducts. Use \`Lxxx\` only for reference, jump, and audit trails; do not treat logs as execution modules.
- Use \`Wxxx\` documents in project-local \`${DOCUMENTS_DIR}/\` for manuals, source material, specs, and other Markdown documents. Documents do not automatically become knowledge notes.
- Use knowledge notes in the global shared \`${path.join(path.dirname(path.dirname(dataRoot)), GLOBAL_KNOWLEDGE_DIR)}\` directory for stable knowledge, detailed answers, decisions refined from research notes, runbooks, and reusable context. Reference them as \`Kxxx\`. Knowledge is shared by all projects and is not stored under a single project data root. The Knowledge Base view shows only \`Kxxx\` notes; each knowledge note should include \`source_project:: <project name>\` so the card can show where it came from. The Documents view shows only project-local Markdown files under \`${DOCUMENTS_DIR}/\`, not tasks, thoughts, research, collaboration, or work logs. Research notes and documents do not automatically become knowledge notes; when the user asks to distill or summarize into knowledge, or asks the Agent to judge whether something should enter knowledge, collect the relevant \`Dxxx\`/\`Wxxx\`, compare them with existing global \`Kxxx\`, then create, update, merge, or refine knowledge. If there is a conflict or missing decision, create an open question linked to the relevant \`Dxxx\`/\`Wxxx\`/\`Kxxx\`.
- Use project constraints in \`${CONSTRAINTS_PATH}\` for project-wide rules, collaboration boundaries, long-lived preferences, and requirements that every Agent should obey. Reference them as \`Cxxx\`. New constraints are user-authored records; generated data specs, handoff notes, and this skill are read-only system constraints in the app view.
- Use research notes in \`${DIALOGUES_PATH}\` for research summaries, standards, and links to detailed \`Wxxx\` documents. Reference them as \`Dxxx\`. Default research uses Tree-of-Thought: provide at least 3 paths with pros, cons, fit conditions, and a recommendation, unless the user provides a custom standard. Keep research entries brief; write detailed research results into project-local \`Wxxx\` documents and write the research action into \`${AGENT_LOG_PATH}\`. If the user explicitly asks to save something, write a record; if you judge something is worth preserving, ask before saving it. Executable work still belongs in tasks, task execution still belongs in agent logs, and open questions still use QIDs.
- When a user asks an agent to answer, continue, verify, or execute a \`Dxxx\` research record, read that specific record from \`${DIALOGUES_PATH}\`, then read its related \`Wxxx\` document for the detailed research result. Treat \`### 验收标准\` as the completion criteria, and do not answer from the \`Dxxx\` summary alone.
- If an input/thought itself raises an open question, add \`### 未确认事项\`; Electron Manager displays it as a QID with the thought's \`Ixxx\` relation.
- When handling an input/thought in \`${THOUGHTS_PATH}\`, do not only change \`status\`; add \`### 回答\` with the conclusion, related task short ID, or reason for not acting.
- Follow the workflow: thought/input -> answered triage -> optional task -> task status -> agent log after task execution and verification.
- Do not create an agent log for thought triage alone. If a thought becomes a task, record the task short ID in \`### 回答\`; write an agent log only when that task is actually executed and verified.
- Record task execution, code/document/rule changes, and verification in \`${AGENT_LOG_PATH}\`.
- Do not revert unrelated user or agent changes.

## Copyable Sync Prompt

\`\`\`text
请读取当前项目的 .agent-collaboration.md，找到 Electron Manager 数据目录；然后读取 agent-brief.json 和 skills/project-collaboration/SKILL.md，按这些文件中的规则建立上下文并协作。
\`\`\`
`
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'project'
}

function localTime() {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
