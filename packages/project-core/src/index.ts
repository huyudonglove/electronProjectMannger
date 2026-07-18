import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
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
  schemaVersion: 3
  currentVersionId: string
}

export type ProjectTask = {
  id: string
  shortId: string
  title: string
  status: string
  priority: string
  area: string
  updated: string
  version: string
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
  version: string
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
  version: string
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
  version: string
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
  version: string
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
  version: string
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
  shortId: string
  title: string
  question: string
  background: string
  recommendation: string
  conclusion: string
  status: 'open' | 'decided' | 'resolved' | 'expired'
  kind: 'decision' | 'clarification' | 'blocker'
  scope: 'version' | 'project'
  version: string
  blocking: boolean
  created: string
  updated: string
  relations: string[]
}

export type ProjectRisk = {
  id: string
  shortId: string
  title: string
  kind: 'risk' | 'verification' | 'follow-up'
  status: 'open' | 'resolved' | 'expired'
  version: string
  content: string
  handling: string
  created: string
  updated: string
  relations: string[]
}

export type ProjectVersion = {
  id: string
  shortId: string
  label: string
  title: string
  status: 'active' | 'completed'
  created: string
  completed: string
  goal: string
  summary: string
  outcomes: string[]
  followUps: string[]
}

export type AgentBrief = {
  generatedAt: string
  projectRoot: string
  dataRoot: string
  knowledgeRoot: string
  skillPath: string
  baselinePath: string
  currentVersionRoot: string
  currentDataPaths: {
    tasks: string
    thoughts: string
    research: string
    questions: string
    risks: string
    workLogs: string
  }
  currentVersion: ProjectVersion | null
  activeTasks: ProjectTask[]
  openQuestions: ProjectOpenQuestion[]
  pendingDecisions: ProjectOpenQuestion[]
  activeRisks: ProjectRisk[]
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
  versions: ProjectVersion[]
  currentVersion: ProjectVersion | null
  questions: ProjectOpenQuestion[]
  risks: ProjectRisk[]
  activeTasks: ProjectTask[]
  openQuestions: AgentBrief['openQuestions']
  replyRecords: ProjectOpenQuestion[]
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
  questionId: string
  answer: string
}

export type NewVersionInput = {
  label: string
  title: string
  goal: string
  summary?: string
}

export type NewQuestionInput = {
  title: string
  question: string
  background?: string
  recommendation?: string
  kind?: ProjectOpenQuestion['kind']
  scope?: ProjectOpenQuestion['scope']
  blocking?: boolean
  relations?: string[]
}

const TASKS_PATH = 'tasks/工程任务.md'
const DATA_SPEC_PATH = 'collaboration/数据层规范.md'
const HANDOFF_PATH = 'collaboration/Agent 同步交接.md'
const THOUGHTS_PATH = 'thoughts/想法与问题.md'
const DIALOGUES_PATH = 'research/研究.md'
const AGENT_LOG_PATH = 'work-logs/Agent 工作记录.md'
const CHANGE_INDEX_PATH = 'collaboration/需求变更索引.md'
const CONSTRAINTS_PATH = 'constraints/项目约束.md'
const QUESTIONS_PATH = 'collaboration/待确认事项.md'
const RISKS_PATH = 'collaboration/风险与后续.md'
const BASELINE_PATH = 'collaboration/当前项目基线.md'
const VERSIONS_PATH = 'versions/版本索引.md'
const DOCUMENTS_DIR = 'documents'
const GLOBAL_KNOWLEDGE_DIR = 'knowledge'
const SKILL_PATH = 'skills/project-collaboration/SKILL.md'
const RECORD_COUNTERS_PATH = 'record-counters.json'
const fileMutationQueues = new Map<string, Promise<void>>()
const VERSION_TASKS_FILE = '工程任务.md'
const VERSION_THOUGHTS_FILE = '想法与问题.md'
const VERSION_DIALOGUES_FILE = '研究.md'
const VERSION_QUESTIONS_FILE = '待确认事项.md'
const VERSION_RISKS_FILE = '风险与后续.md'
const VERSION_LOGS_DIR = '工作记录'

function requiredProjectFiles() {
  return [
    'project.json',
    DATA_SPEC_PATH,
    HANDOFF_PATH,
    CHANGE_INDEX_PATH,
    CONSTRAINTS_PATH,
    VERSIONS_PATH,
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
  if (await readExistingProjectFile(dataRoot, 'project.json')) {
    return updateProjectGuidance(managerDataRoot, projectRoot)
  }
  const config: ProjectConfig = {
    projectId,
    name,
    projectRoot,
    dataRoot,
    createdAt: new Date().toISOString(),
    schemaVersion: 3,
    currentVersionId: 'V001',
  }

  await writeProjectFile(dataRoot, 'project.json', `${JSON.stringify(config, null, 2)}\n`)
  await writeProjectFile(dataRoot, DATA_SPEC_PATH, dataSpecTemplate())
  await writeProjectFile(dataRoot, HANDOFF_PATH, handoffTemplate(projectRoot))
  await ensureProjectDirectory(dataRoot, DOCUMENTS_DIR)
  await writeProjectFile(dataRoot, CHANGE_INDEX_PATH, changeIndexTemplate())
  await writeProjectFile(dataRoot, CONSTRAINTS_PATH, constraintsTemplate())
  await writeProjectFile(dataRoot, VERSIONS_PATH, versionsTemplate(name))
  await writeProjectFile(dataRoot, versionRecordPath('V001', VERSION_TASKS_FILE), tasksTemplate(name))
  await writeProjectFile(dataRoot, versionRecordPath('V001', VERSION_THOUGHTS_FILE), thoughtsTemplate())
  await writeProjectFile(dataRoot, versionRecordPath('V001', VERSION_DIALOGUES_FILE), dialoguesTemplate())
  await writeProjectFile(dataRoot, versionRecordPath('V001', VERSION_QUESTIONS_FILE), questionsTemplate())
  await writeProjectFile(dataRoot, versionRecordPath('V001', VERSION_RISKS_FILE), risksTemplate())
  await writeProjectFile(dataRoot, versionLogPath('V001'), agentLogTemplate())
  await ensureGlobalKnowledgeRoot(managerDataRoot)
  await writeProjectFile(dataRoot, SKILL_PATH, skillTemplate(projectRoot, dataRoot))
  await writeCollaborationEntry(projectRoot, dataRoot)
  await ensureCollaborationIgnored(projectRoot)
  await upsertProjectIndex(managerDataRoot, config)

  const dashboard = await getDashboard(managerDataRoot, projectRoot)
  await writeAgentBrief(managerDataRoot, projectRoot, dashboard.agentBrief)
  await writeProjectFile(dataRoot, BASELINE_PATH, baselineMarkdown(dashboard))
  await writeProjectFile(dataRoot, 'index.json', `${JSON.stringify(indexFromDashboard(dashboard), null, 2)}\n`)

  return dashboard
}

export async function updateProjectGuidance(managerDataRoot: string, projectRoot: string) {
  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const config = await normalizeProjectConfig(managerDataRoot, projectRoot)
  await writeProjectFile(dataRoot, DATA_SPEC_PATH, dataSpecTemplate())
  await writeProjectFile(dataRoot, HANDOFF_PATH, handoffTemplate(projectRoot))
  await ensureProjectFile(dataRoot, CONSTRAINTS_PATH, constraintsTemplate())
  await ensureProjectFile(dataRoot, VERSIONS_PATH, versionsTemplate(config.name))
  await ensureVersionRecordFiles(dataRoot, config.currentVersionId)
  await ensureGlobalKnowledgeRoot(managerDataRoot)
  await normalizeGlobalKnowledgeFiles(managerDataRoot)
  await normalizeProjectRecordVersions(dataRoot, config.currentVersionId)
  await normalizeProjectDocumentFiles(dataRoot, config.currentVersionId)
  await writeProjectFile(dataRoot, SKILL_PATH, skillTemplate(projectRoot, dataRoot))
  await writeCollaborationEntry(projectRoot, dataRoot)
  await ensureCollaborationIgnored(projectRoot)
  await refreshAgentBrief(managerDataRoot, projectRoot)
  await upsertProjectIndex(managerDataRoot, config)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function getDashboard(managerDataRoot: string, projectRoot: string): Promise<Dashboard> {
  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const config = await normalizeProjectConfig(managerDataRoot, projectRoot)
  await ensureProjectFile(dataRoot, VERSIONS_PATH, versionsTemplate(config.name))
  await ensureVersionRecordFiles(dataRoot, config.currentVersionId)
  await ensureGlobalKnowledgeRoot(managerDataRoot)
  await normalizeProjectRecordVersions(dataRoot, config.currentVersionId)
  await normalizeProjectDocumentFiles(dataRoot, config.currentVersionId)
  await normalizeGlobalKnowledgeFiles(managerDataRoot)
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
  const activeRisks = risks.filter((risk) =>
    risk.status === 'open' && recordInVersion(risk.version, currentVersionId),
  )
  const replyRecords = questions.filter((question) => question.status !== 'open')
  const currentVersionRoot = path.join(dataRoot, 'versions', currentVersionId)
  const currentDataPaths = {
    tasks: path.join(currentVersionRoot, VERSION_TASKS_FILE),
    thoughts: path.join(currentVersionRoot, VERSION_THOUGHTS_FILE),
    research: path.join(currentVersionRoot, VERSION_DIALOGUES_FILE),
    questions: path.join(currentVersionRoot, VERSION_QUESTIONS_FILE),
    risks: path.join(currentVersionRoot, VERSION_RISKS_FILE),
    workLogs: path.join(currentVersionRoot, VERSION_LOGS_DIR),
  }

  const agentBrief: AgentBrief = {
    generatedAt: new Date().toISOString(),
    projectRoot,
    dataRoot,
    knowledgeRoot: resolveGlobalKnowledgeRoot(managerDataRoot),
    skillPath: path.join(dataRoot, SKILL_PATH),
    baselinePath: path.join(dataRoot, BASELINE_PATH),
    currentVersionRoot,
    currentDataPaths,
    currentVersion,
    activeTasks,
    openQuestions,
    pendingDecisions,
    activeRisks,
    latestLogs,
    instructions: [
      `先读取 ${path.join(dataRoot, 'agent-brief.json')} 建立最新上下文。`,
      `然后读取 ${path.join(dataRoot, BASELINE_PATH)} 获取当前项目基线与版本范围。`,
      `然后读取 ${path.join(dataRoot, SKILL_PATH)}，按其中规则写任务和工作记录。`,
      `真正需要用户决定的问题只写入 ${currentDataPaths.questions}；验证限制、风险和后续事项写入 ${currentDataPaths.risks}。`,
      `读取 ${path.join(dataRoot, CONSTRAINTS_PATH)} 获取当前项目全局约束；约束记录使用 Cxxx。`,
      `需要完整任务时读取 ${currentDataPaths.tasks}。`,
      '所有记录型 Markdown 都必须按 ID 倒序维护：较大的 Txxx/Ixxx/Dxxx/Wxxx/Kxxx/Lxxx/Cxxx 写在较小 ID 上方，例如 T036 在 T001 上面。',
      `处理 Dxxx 研究时读取 ${currentDataPaths.research}，同时读取关联 Wxxx 文档；默认按 Tree-of-Thought 至少 3 条路径、优缺点、适用条件和建议结论组织研究。`,
      `Dxxx 研究、Wxxx 文档和 Kxxx 知识可独立删除；删除操作不级联，引用关系只由 related_documents 等字段表达。`,
      `长期知识库是全局共享的，读取 ${resolveGlobalKnowledgeRoot(managerDataRoot)} 中的 Kxxx 条目。`,
      `工作记录必须包含 ### 用户目标、### 需求理解、### 产出、### 关键步骤、### 验证、### 验收标准、### 已知风险、### 后续事项。`,
      `所有项目记录必须写入 version:: ${currentVersionId}；项目文档和项目约束仅用版本号追溯来源，不参与版本过滤。`,
      '工作流顺序：想法/输入 -> 整理回答 -> 必要时产生任务 -> 任务进入 todo/doing/done -> 任务执行并验收后写 Agent 工作记录。',
      '整理想法只更新想法回答和必要任务卡；未执行工程任务时不要写 Agent 工作记录。',
      '执行任务前将任务状态改为 doing，完成验收后改为 done。',
      `完成后按月份写入 ${currentDataPaths.workLogs}。`,
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
    versions,
    currentVersion,
    questions,
    risks,
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
  const config = await normalizeProjectConfig(managerDataRoot, projectRoot)
  await upsertProjectIndex(managerDataRoot, config)
  return config
}

export async function removeManagedProject(managerDataRoot: string, projectId: string): Promise<ManagedProject[]> {
  const id = String(projectId || '').trim()
  if (!id) throw new Error('项目 ID 不能为空')

  const indexPath = path.join(managerDataRoot, 'projects.json')
  await withFileMutation(indexPath, async () => {
    const projects = await readProjectIndex(managerDataRoot)
    const next = projects.filter((project) => project.projectId !== id)
    await atomicWriteFile(indexPath, `${JSON.stringify(next, null, 2)}\n`)
  })
  return listManagedProjects(managerDataRoot)
}

export async function appendTask(managerDataRoot: string, projectRoot: string, input: NewTaskInput) {
  if (!input) throw new Error('任务内容不能为空')
  const title = normalizeTitle(input.title || '')
  if (!title) throw new Error('任务标题不能为空')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const config = await normalizeProjectConfig(managerDataRoot, projectRoot)
  const taskPath = versionRecordPath(config.currentVersionId, VERSION_TASKS_FILE)
  await mutateProjectFile(dataRoot, taskPath, async (current) => {
    const tasks = parseProjectTasks(current)
    const now = localTime()
    const task = taskToMarkdown({
      id: createId('task', title),
      shortId: await allocateShortId(dataRoot, 'T', tasks.map((item) => item.shortId)),
      title,
      status: normalizeStatus(input.status || 'todo'),
      priority: input.priority || 'medium',
      area: input.area || 'tool',
      updated: now,
      version: config.currentVersionId,
      detail: input.executionScope || '待补充。',
      acceptance: input.acceptance || '待补充。',
      openQuestions: input.openQuestions || '无。',
    }, {
      created: now,
      userOriginal: input.userOriginal || title,
      agentUnderstanding: input.agentUnderstanding || '待补充。',
    })
    return { content: insertMarkdownEntry(current, task), value: undefined }
  })
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function updateTaskStatus(managerDataRoot: string, projectRoot: string, taskId: string, status: string) {
  const id = String(taskId || '').trim()
  const nextStatus = String(status || '').trim()
  if (!id) throw new Error('任务 ID 不能为空')
  if (!nextStatus) throw new Error('任务状态不能为空')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const taskPath = await findVersionRecordPath(dataRoot, VERSION_TASKS_FILE, id)
  if (!taskPath) throw new Error('未找到任务记录')
  await mutateProjectFile(dataRoot, taskPath, (current) => {
    let updatedTask = false
    const next = splitMarkdownBlocks(current)
      .map((block, index) => {
        if (index === 0 && !block.trim().startsWith('## ')) return block
        if (parseFields(block).id !== id) return block
        updatedTask = true
        return block
          .replace(/^status::\s*.+$/m, `status:: ${normalizeStatus(nextStatus)}`)
          .replace(/^updated::\s*.+$/m, `updated:: ${localTime()}`)
      })
      .join('\n')
    if (!updatedTask) throw new Error('未找到任务记录')
    return { content: next.endsWith('\n') ? next : `${next}\n`, value: undefined }
  })
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function deleteTask(managerDataRoot: string, projectRoot: string, taskId: string) {
  const id = String(taskId || '').trim()
  if (!id) throw new Error('任务 ID 不能为空')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const taskPath = await findVersionRecordPath(dataRoot, VERSION_TASKS_FILE, id)
  if (!taskPath) throw new Error('未找到任务记录')
  await mutateProjectFile(dataRoot, taskPath, (current) => {
    let deleted = false
    const next = splitMarkdownBlocks(current)
      .filter((block, index) => {
        if (index === 0 && !block.trim().startsWith('## ')) return true
        const shouldDelete = parseFields(block).id === id
        if (shouldDelete) deleted = true
        return !shouldDelete
      })
      .map((block) => block.trim())
      .filter(Boolean)
      .join('\n\n')
    if (!deleted) throw new Error('未找到任务记录')
    return { content: `${next}\n`, value: undefined }
  })
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function appendThought(managerDataRoot: string, projectRoot: string, content: string) {
  const normalized = String(content || '').trim()
  if (!normalized) throw new Error('输入内容不能为空')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const config = await normalizeProjectConfig(managerDataRoot, projectRoot)
  const thoughtPath = versionRecordPath(config.currentVersionId, VERSION_THOUGHTS_FILE)
  await mutateProjectFile(dataRoot, thoughtPath, async (current) => {
    const thoughts = parseThoughts(current)
    const now = localTime()
    const entry = `## ${now} 想法

id:: ${createId('thought', normalized.slice(0, 24))}
short_id:: ${await allocateShortId(dataRoot, 'I', thoughts.map((item) => item.shortId))}
status:: inbox
type:: thought
created:: ${now}
version:: ${config.currentVersionId}

### 内容

${normalized}

### 回答

暂无。
`
    return { content: insertMarkdownEntry(current, entry), value: undefined }
  })
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
  const config = await normalizeProjectConfig(managerDataRoot, projectRoot)
  await normalizeProjectDocumentFiles(dataRoot, config.currentVersionId)
  const dialoguePath = versionRecordPath(config.currentVersionId, VERSION_DIALOGUES_FILE)
  const dialogues = parseDialogues(await readVersionRecordFamily(dataRoot, VERSION_DIALOGUES_FILE))
  const documents = await listProjectDocuments(dataRoot)
  const allTasks = parseProjectTasks(await readVersionRecordFamily(dataRoot, VERSION_TASKS_FILE))
  const logs = parseProjectLogs(await readVersionLogs(dataRoot), allTasks)
  const now = localTime()
  const shortId = await allocateShortId(dataRoot, 'D', dialogues.map((item) => item.shortId))
  const documentShortId = await allocateShortId(dataRoot, 'W', documents.map((item) => item.shortId))
  const logShortId = await allocateShortId(dataRoot, 'L', logs.map((item) => item.shortId))
  const logPath = versionLogPath(config.currentVersionId, now)
  const title = firstMeaningfulLine(normalized).slice(0, 40) || '研究'
  const documentPath = `${DOCUMENTS_DIR}/研究/${shortId}-${slug(title) || 'research'}.md`
  const entry = `## ${now} 研究

id:: ${createId('dialogue', normalized.slice(0, 24))}
short_id:: ${shortId}
type:: dialogue
created:: ${now}
updated:: ${now}
version:: ${config.currentVersionId}
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
    version: config.currentVersionId,
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
    version: config.currentVersionId,
  })

  await writeProjectFile(dataRoot, documentPath, document)
  await mutateProjectFile(dataRoot, dialoguePath, (current) => ({
    content: insertMarkdownEntry(current || dialoguesTemplate(), entry),
    value: undefined,
  }))
  await mutateProjectFile(dataRoot, logPath, (current) => ({
    content: insertMarkdownEntry(current || agentLogRecordsTemplate(), logEntry),
    value: undefined,
  }))
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
  const config = await normalizeProjectConfig(managerDataRoot, projectRoot)
  await mutateProjectFile(dataRoot, CONSTRAINTS_PATH, async (current) => {
    const source = current || constraintsTemplate()
    const constraints = parseUserConstraints(source)
    const now = localTime()
    const entry = `## ${title}

id:: ${createId('constraint', title)}
short_id:: ${await allocateShortId(dataRoot, 'C', constraints.map((item) => item.shortId))}
type:: constraint
status:: ${normalizeConstraintStatus(input.status || 'active')}
scope:: ${String(input.scope || '').trim() || 'project'}
created:: ${now}
updated:: ${now}
version:: ${config.currentVersionId}

### 内容

${content}
`
    return { content: insertMarkdownEntry(source, entry), value: undefined }
  })
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function deleteConstraint(managerDataRoot: string, projectRoot: string, constraintId: string) {
  const id = String(constraintId || '').trim()
  if (!id) throw new Error('约束 ID 不能为空')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  await mutateProjectFile(dataRoot, CONSTRAINTS_PATH, (current) => {
    let deleted = false
    const next = splitMarkdownBlocks(current)
      .filter((block, index) => {
        if (index === 0 && !block.trim().startsWith('## ')) return true
        const shouldDelete = parseFields(block).id === id
        if (shouldDelete) deleted = true
        return !shouldDelete
      })
      .map((block) => block.trim())
      .filter(Boolean)
      .join('\n\n')
    if (!deleted) throw new Error('未找到约束记录')
    return { content: `${next}\n`, value: undefined }
  })
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function deleteThought(managerDataRoot: string, projectRoot: string, thoughtId: string) {
  const id = String(thoughtId || '').trim()
  if (!id) throw new Error('输入 ID 不能为空')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const thoughtPath = await findVersionRecordPath(dataRoot, VERSION_THOUGHTS_FILE, id)
  if (!thoughtPath) throw new Error('未找到输入记录')
  await mutateProjectFile(dataRoot, thoughtPath, (current) => {
    let deleted = false
    const next = splitMarkdownBlocks(current)
      .filter((block, index) => {
        if (index === 0 && !block.trim().startsWith('## ')) return true
        const shouldDelete = parseFields(block).id === id
        if (shouldDelete) deleted = true
        return !shouldDelete
      })
      .map((block) => block.trim())
      .filter(Boolean)
      .join('\n\n')
    if (!deleted) throw new Error('未找到输入记录')
    return { content: `${next}\n`, value: undefined }
  })
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function deleteDialogue(managerDataRoot: string, projectRoot: string, dialogueId: string) {
  const id = String(dialogueId || '').trim()
  if (!id) throw new Error('研究 ID 不能为空')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const dialoguePath = await findVersionRecordPath(dataRoot, VERSION_DIALOGUES_FILE, id, normalizeDialogueShortId)
  if (!dialoguePath) throw new Error('未找到研究记录')
  await mutateProjectFile(dataRoot, dialoguePath, (current) => {
    let deleted = false
    const next = splitMarkdownBlocks(current)
      .filter((block, index) => {
        if (index === 0 && !block.trim().startsWith('## ')) return true
        const fields = parseFields(block)
        const shouldDelete = fields.id === id || normalizeDialogueShortId(id) === normalizeDialogueShortId(fields.short_id)
        if (shouldDelete) deleted = true
        return !shouldDelete
      })
      .map((block) => block.trim())
      .filter(Boolean)
      .join('\n\n')
    if (!deleted) throw new Error('未找到研究记录')
    return { content: `${next}\n`, value: undefined }
  })
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function deleteDocument(managerDataRoot: string, projectRoot: string, documentTarget: string) {
  const target = String(documentTarget || '').trim()
  if (!target) throw new Error('文档 ID 不能为空')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const config = await normalizeProjectConfig(managerDataRoot, projectRoot)
  await normalizeProjectDocumentFiles(dataRoot, config.currentVersionId)
  const documents = await listProjectDocuments(dataRoot)
  const note = documents.find((item) =>
    item.path === target || item.shortId === normalizeDocumentShortId(target),
  )
  if (!note) throw new Error('未找到文档')

  await removeProjectMarkdownFile(dataRoot, note.path, DOCUMENTS_DIR)
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function deleteKnowledge(managerDataRoot: string, projectRoot: string, knowledgeTarget: string) {
  const target = String(knowledgeTarget || '').trim()
  if (!target) throw new Error('知识 ID 不能为空')

  await ensureGlobalKnowledgeRoot(managerDataRoot)
  await normalizeGlobalKnowledgeFiles(managerDataRoot)
  const notes = parseKnowledgeNotes(await listGlobalKnowledgeDocuments(managerDataRoot))
  const note = notes.find((item) =>
    item.path === target || item.id === target || item.shortId === normalizeKnowledgeShortId(target),
  )
  if (!note) throw new Error('未找到知识条目')

  await removeProjectMarkdownFile(managerDataRoot, note.path, GLOBAL_KNOWLEDGE_DIR)
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function createProjectVersion(managerDataRoot: string, projectRoot: string, input: NewVersionInput) {
  const label = normalizeTitle(input?.label || '')
  const title = normalizeTitle(input?.title || '')
  const goal = String(input?.goal || '').trim()
  if (!label) throw new Error('版本名称不能为空')
  if (!title) throw new Error('版本标题不能为空')
  if (!goal) throw new Error('版本目标不能为空')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const config = await normalizeProjectConfig(managerDataRoot, projectRoot)
  const shortId = await mutateProjectFile(dataRoot, VERSIONS_PATH, async (current) => {
    const versions = parseProjectVersions(current)
    const nextVersionId = await allocateShortId(dataRoot, 'V', versions.map((version) => version.shortId))
    const now = localTime()
    const closed = updateMarkdownBlocks(current, (block) => {
      const fields = parseFields(block)
      if (fields.status !== 'active') return block
      return block
        .replace(/^status::\s*.+$/m, 'status:: completed')
        .replace(/^completed::\s*.+$/m, `completed:: ${now}`)
    })
    const entry = `## ${title}

id:: ${createId('version', `${label}-${title}`)}
short_id:: ${nextVersionId}
label:: ${label}
status:: active
created:: ${now}
completed:: 无

### 版本目标

${goal}

### 内容描述

${String(input.summary || '').trim() || '当前版本进行中。'}

### 主要成果

- 无。

### 遗留事项

- 无。
`
    return { content: insertMarkdownEntry(closed, entry), value: nextVersionId }
  })
  await ensureVersionRecordFiles(dataRoot, shortId)
  await writeProjectFile(dataRoot, 'project.json', `${JSON.stringify({ ...config, currentVersionId: shortId }, null, 2)}\n`)
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function appendProjectQuestion(managerDataRoot: string, projectRoot: string, input: NewQuestionInput) {
  const title = normalizeTitle(input?.title || '')
  const question = String(input?.question || '').trim()
  if (!title) throw new Error('问题标题不能为空')
  if (!question) throw new Error('问题内容不能为空')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const config = await normalizeProjectConfig(managerDataRoot, projectRoot)
  const questionPath = versionRecordPath(config.currentVersionId, VERSION_QUESTIONS_FILE)
  await mutateProjectFile(dataRoot, questionPath, async (current) => {
    const questions = parseProjectQuestions(current)
    const now = localTime()
    const shortId = await allocateShortId(dataRoot, 'Q', questions.map((item) => item.shortId))
    const entry = `## ${title}

id:: ${createId('question', title)}
short_id:: ${shortId}
type:: question
status:: open
kind:: ${normalizeQuestionKind(input.kind)}
scope:: ${input.scope === 'project' ? 'project' : 'version'}
version:: ${config.currentVersionId}
blocking:: ${input.blocking ? 'yes' : 'no'}
created:: ${now}
updated:: ${now}
source_refs:: ${(input.relations || []).join(', ') || '无'}

### 问题

${question}

### 背景

${String(input.background || '').trim() || '无。'}

### 建议

${String(input.recommendation || '').trim() || '无。'}

### 结论

待确认。
`
    return { content: insertMarkdownEntry(current, entry), value: undefined }
  })
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function replyOpenQuestion(managerDataRoot: string, projectRoot: string, input: OpenQuestionReplyInput) {
  if (!input) throw new Error('回复内容不能为空')
  const answer = String(input.answer || '').trim()
  const questionId = String(input.questionId || '').trim()
  if (!questionId) throw new Error('未确认事项不能为空')
  if (!answer) throw new Error('回复内容不能为空')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  await updateQuestionRecord(dataRoot, questionId, (block) =>
    replaceSection(
      block
        .replace(/^status::\s*.+$/m, 'status:: decided')
        .replace(/^updated::\s*.+$/m, `updated:: ${localTime()}`),
      ['结论'],
      '结论',
      answer,
    ))
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function updateReplyRecord(managerDataRoot: string, projectRoot: string, input: OpenQuestionReplyInput) {
  if (!input) throw new Error('回复内容不能为空')
  const answer = String(input.answer || '').trim()
  const questionId = String(input.questionId || '').trim()
  if (!questionId) throw new Error('回复 ID 不能为空')
  if (!answer) throw new Error('回复内容不能为空')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  await updateQuestionRecord(dataRoot, questionId, (block) =>
    replaceSection(
      block.replace(/^updated::\s*.+$/m, `updated:: ${localTime()}`),
      ['结论'],
      '结论',
      answer,
    ))
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function updateQuestionStatus(
  managerDataRoot: string,
  projectRoot: string,
  questionId: string,
  status: ProjectOpenQuestion['status'],
) {
  const id = String(questionId || '').trim()
  const nextStatus = normalizeQuestionStatus(status)
  if (!id) throw new Error('问题 ID 不能为空')
  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  await updateQuestionRecord(dataRoot, id, (block) => block
    .replace(/^status::\s*.+$/m, `status:: ${nextStatus}`)
    .replace(/^updated::\s*.+$/m, `updated:: ${localTime()}`))
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function updateRiskStatus(
  managerDataRoot: string,
  projectRoot: string,
  riskId: string,
  status: ProjectRisk['status'],
) {
  const id = String(riskId || '').trim()
  const nextStatus = ['open', 'resolved', 'expired'].includes(String(status))
    ? status
    : 'open'
  if (!id) throw new Error('风险 ID 不能为空')
  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const riskPath = await findVersionRecordPath(dataRoot, VERSION_RISKS_FILE, id, normalizeRiskShortId)
  if (!riskPath) throw new Error('未找到风险或后续事项')
  await mutateProjectFile(dataRoot, riskPath, (current) => {
    let handled = false
    const next = updateMarkdownBlocks(current, (block) => {
      const fields = parseFields(block)
      if (fields.id !== id && normalizeRiskShortId(fields.short_id) !== normalizeRiskShortId(id)) return block
      handled = true
      return block
        .replace(/^status::\s*.+$/m, `status:: ${nextStatus}`)
        .replace(/^updated::\s*.+$/m, `updated:: ${localTime()}`)
    })
    if (!handled) throw new Error('未找到风险或后续事项')
    return { content: next, value: undefined }
  })
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function refreshAgentBrief(managerDataRoot: string, projectRoot: string) {
  const dashboard = await getDashboard(managerDataRoot, projectRoot)
  await writeAgentBrief(managerDataRoot, projectRoot, dashboard.agentBrief)
  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  await writeProjectFile(dataRoot, BASELINE_PATH, baselineMarkdown(dashboard))
  await writeProjectFile(dataRoot, 'index.json', `${JSON.stringify(indexFromDashboard(dashboard), null, 2)}\n`)
  await upsertProjectIndex(managerDataRoot, dashboard.config)
  return dashboard.agentBrief
}

async function readProjectConfig(managerDataRoot: string, projectRoot: string): Promise<ProjectConfig> {
  const raw = await readProjectFile(await resolveExistingDataRoot(managerDataRoot, projectRoot), 'project.json')
  return JSON.parse(raw) as ProjectConfig
}

async function normalizeProjectConfig(managerDataRoot: string, projectRoot: string): Promise<ProjectConfig> {
  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const raw = JSON.parse(await readProjectFile(dataRoot, 'project.json')) as Partial<ProjectConfig> & { version?: number }
  const currentVersionId = String(raw.currentVersionId || 'V001')
  if (Number(raw.schemaVersion || raw.version || 1) < 3) {
    await migrateVersionStorage(dataRoot, currentVersionId)
  }
  const config: ProjectConfig = {
    projectId: String(raw.projectId || createProjectId(projectRoot, raw.name || path.basename(projectRoot))),
    name: String(raw.name || path.basename(projectRoot)),
    projectRoot: String(raw.projectRoot || projectRoot),
    dataRoot: String(raw.dataRoot || dataRoot),
    createdAt: String(raw.createdAt || new Date().toISOString()),
    schemaVersion: 3,
    currentVersionId,
  }
  if (raw.schemaVersion !== 3 || raw.currentVersionId !== config.currentVersionId || 'version' in raw) {
    await writeProjectFile(dataRoot, 'project.json', `${JSON.stringify(config, null, 2)}\n`)
  }
  return config
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
  const current = await readVersionRecordFamily(dataRoot, VERSION_DIALOGUES_FILE)
  if (current) return current
  const content = dialoguesTemplate()
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
  await atomicWriteFile(absolutePath, content)
}

async function ensureProjectDirectory(dataRoot: string, relativePath: string) {
  await mkdir(path.join(dataRoot, relativePath), { recursive: true })
}

function versionRecordPath(versionId: string, fileName: string) {
  const normalized = normalizeVersionId(versionId)
  if (!normalized) throw new Error(`版本 ID 不合法：${versionId}`)
  return path.join('versions', normalized, fileName)
}

function versionLogPath(versionId: string, created = localTime()) {
  const month = created.match(/^(\d{4}-\d{2})/)?.[1] || localTime().slice(0, 7)
  return path.join('versions', normalizeVersionId(versionId), VERSION_LOGS_DIR, `${month}.md`)
}

async function ensureVersionRecordFiles(dataRoot: string, versionId: string) {
  await ensureProjectFile(dataRoot, versionRecordPath(versionId, VERSION_TASKS_FILE), taskRecordsTemplate())
  await ensureProjectFile(dataRoot, versionRecordPath(versionId, VERSION_THOUGHTS_FILE), thoughtsTemplate())
  await ensureProjectFile(dataRoot, versionRecordPath(versionId, VERSION_DIALOGUES_FILE), dialoguesTemplate())
  await ensureProjectFile(dataRoot, versionRecordPath(versionId, VERSION_QUESTIONS_FILE), questionsTemplate())
  await ensureProjectFile(dataRoot, versionRecordPath(versionId, VERSION_RISKS_FILE), risksTemplate())
}

async function readVersionRecordFamily(dataRoot: string, fileName: string) {
  const files = await listVersionRecordFiles(dataRoot, fileName)
  const contents = await Promise.all(files.map((relativePath) => readProjectFile(dataRoot, relativePath)))
  return contents.join('\n\n')
}

async function listVersionRecordFiles(dataRoot: string, fileName: string) {
  return (await listMarkdownFiles(dataRoot, 'versions'))
    .filter((relativePath) => new RegExp(`^versions/V\\d+/${escapeRegExp(fileName)}$`).test(relativePath.replaceAll('\\', '/')))
    .sort()
}

async function findVersionRecordPath(
  dataRoot: string,
  fileName: string,
  target: string,
  normalizeShortId: (value: string) => string = (value) => value,
) {
  for (const relativePath of await listVersionRecordFiles(dataRoot, fileName)) {
    const records = splitMarkdownBlocks(await readProjectFile(dataRoot, relativePath))
    if (records.some((block) => {
      const fields = parseFields(block)
      return fields.id === target
        || (fields.short_id && normalizeShortId(fields.short_id) === normalizeShortId(target))
    })) return relativePath
  }
  return ''
}

async function readVersionLogs(dataRoot: string) {
  const files = (await listMarkdownFiles(dataRoot, 'versions'))
    .filter((relativePath) => /^versions\/V\d+\/工作记录\/\d{4}-\d{2}\.md$/.test(relativePath.replaceAll('\\', '/')))
    .sort()
  const contents = await Promise.all(files.map((relativePath) => readProjectFile(dataRoot, relativePath)))
  return contents.join('\n\n')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function migrateVersionStorage(dataRoot: string, fallbackVersionId: string) {
  const fallbackVersion = normalizeVersionId(fallbackVersionId) || 'V001'
  const knownVersions = new Set<string>([fallbackVersion])
  const versionIndex = await readExistingProjectFile(dataRoot, VERSIONS_PATH)
  parseProjectVersions(versionIndex).forEach((version) => knownVersions.add(version.shortId))

  const families = [
    { legacyPath: TASKS_PATH, fileName: VERSION_TASKS_FILE, template: taskRecordsTemplate() },
    { legacyPath: THOUGHTS_PATH, fileName: VERSION_THOUGHTS_FILE, template: thoughtsTemplate() },
    { legacyPath: DIALOGUES_PATH, fileName: VERSION_DIALOGUES_FILE, template: dialoguesTemplate() },
    { legacyPath: QUESTIONS_PATH, fileName: VERSION_QUESTIONS_FILE, template: questionsTemplate() },
    { legacyPath: RISKS_PATH, fileName: VERSION_RISKS_FILE, template: risksTemplate() },
  ]

  for (const family of families) {
    const legacyContent = await readExistingProjectFile(dataRoot, family.legacyPath)
    if (!legacyContent) continue
    const records = splitMarkdownBlocks(legacyContent).filter((block) => block.trim().startsWith('## '))
    const grouped = groupRecordsByVersion(records, fallbackVersion)
    for (const [versionId, versionRecords] of grouped) {
      knownVersions.add(versionId)
      const next = joinRecordDocument(family.template, versionRecords)
      const destination = versionRecordPath(versionId, family.fileName)
      await writeProjectFile(dataRoot, destination, next)
      const written = splitMarkdownBlocks(await readProjectFile(dataRoot, destination))
        .filter((block) => block.trim().startsWith('## ')).length
      if (written !== versionRecords.length) {
        throw new Error(`版本迁移校验失败：${family.legacyPath} 预期 ${versionRecords.length} 条，实际 ${written} 条`)
      }
    }
  }

  const legacyLogs = await readExistingProjectFile(dataRoot, AGENT_LOG_PATH)
  if (legacyLogs) {
    const records = splitMarkdownBlocks(legacyLogs).filter((block) => block.trim().startsWith('## '))
    const grouped = new Map<string, string[]>()
    for (const record of records) {
      const fields = parseFields(record)
      const versionId = normalizeVersionId(fields.version) || fallbackVersion
      const month = fields.created?.match(/^(\d{4}-\d{2})/)?.[1] || '0000-00'
      knownVersions.add(versionId)
      const key = `${versionId}/${month}`
      grouped.set(key, [...(grouped.get(key) || []), record])
    }
    for (const [key, versionRecords] of grouped) {
      const [versionId, month] = key.split('/')
      const destination = path.join('versions', versionId, VERSION_LOGS_DIR, `${month}.md`)
      await writeProjectFile(dataRoot, destination, joinRecordDocument(agentLogRecordsTemplate(), versionRecords))
      const written = splitMarkdownBlocks(await readProjectFile(dataRoot, destination))
        .filter((block) => block.trim().startsWith('## ')).length
      if (written !== versionRecords.length) {
        throw new Error(`版本迁移校验失败：${AGENT_LOG_PATH} ${key} 预期 ${versionRecords.length} 条，实际 ${written} 条`)
      }
    }
  }

  for (const versionId of knownVersions) await ensureVersionRecordFiles(dataRoot, versionId)

  for (const family of families) await rm(path.join(dataRoot, family.legacyPath), { force: true })
  await rm(path.join(dataRoot, AGENT_LOG_PATH), { force: true })
  for (const legacyDirectory of ['tasks', 'thoughts', 'research', 'work-logs']) {
    await rm(path.join(dataRoot, legacyDirectory), { recursive: true, force: true })
  }
}

function groupRecordsByVersion(records: string[], fallbackVersion: string) {
  const grouped = new Map<string, string[]>()
  for (const record of records) {
    const versionId = normalizeVersionId(parseFields(record).version) || fallbackVersion
    grouped.set(versionId, [...(grouped.get(versionId) || []), record])
  }
  return grouped
}

function joinRecordDocument(template: string, records: string[]) {
  const body = records.map((record) => record.trim()).filter(Boolean).join('\n\n')
  return `${template.trimEnd()}${body ? `\n\n${body}` : ''}\n`
}

async function writeRootFile(root: string, relativePath: string, content: string) {
  const absolutePath = path.join(root, relativePath)
  await atomicWriteFile(absolutePath, content)
}

async function atomicWriteFile(absolutePath: string, content: string) {
  await mkdir(path.dirname(absolutePath), { recursive: true })
  const temporaryPath = path.join(
    path.dirname(absolutePath),
    `.${path.basename(absolutePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  )
  try {
    await writeFile(temporaryPath, content, 'utf8')
    await rename(temporaryPath, absolutePath)
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }
}

async function mutateProjectFile<T>(
  dataRoot: string,
  relativePath: string,
  update: (content: string) => Promise<{ content: string; value: T }> | { content: string; value: T },
): Promise<T> {
  const absolutePath = path.resolve(dataRoot, relativePath)
  return withFileMutation(absolutePath, async () => {
    const existing = await readExistingProjectFile(dataRoot, relativePath)
    const result = await update(existing)
    if (result.content !== existing) await writeProjectFile(dataRoot, relativePath, result.content)
    return result.value
  })
}

async function withFileMutation<T>(absolutePath: string, action: () => Promise<T>): Promise<T> {
  const previous = fileMutationQueues.get(absolutePath) || Promise.resolve()
  let resolveCurrent!: () => void
  const current = new Promise<void>((resolve) => {
    resolveCurrent = resolve
  })
  const queued = previous.catch(() => undefined).then(() => current)
  fileMutationQueues.set(absolutePath, queued)

  await previous.catch(() => undefined)
  try {
    return await action()
  } finally {
    resolveCurrent()
    if (fileMutationQueues.get(absolutePath) === queued) fileMutationQueues.delete(absolutePath)
  }
}

async function allocateShortId(dataRoot: string, prefix: string, observedValues: string[]) {
  return mutateProjectFile(dataRoot, RECORD_COUNTERS_PATH, (content) => {
    let counters: Record<string, number> = {}
    if (content.trim()) {
      try {
        counters = (JSON.parse(content) as { counters?: Record<string, number> }).counters || {}
      } catch {
        throw new Error('记录 ID 计数器已损坏，请先恢复 record-counters.json')
      }
    }
    const observedMaximum = Math.max(
      0,
      ...observedValues.map((value) => Number(String(value).match(/\d+$/)?.[0] || 0)),
    )
    const next = Math.max(Number(counters[prefix] || 0), observedMaximum) + 1
    const nextCounters = { ...counters, [prefix]: next }
    return {
      content: `${JSON.stringify({ schemaVersion: 1, counters: nextCounters }, null, 2)}\n`,
      value: `${prefix}${String(next).padStart(3, '0')}`,
    }
  })
}

async function ensureRecordCounters(dataRoot: string, observed: Record<string, string[]>) {
  await mutateProjectFile(dataRoot, RECORD_COUNTERS_PATH, (content) => {
    let counters: Record<string, number> = {}
    if (content.trim()) {
      try {
        counters = (JSON.parse(content) as { counters?: Record<string, number> }).counters || {}
      } catch {
        throw new Error('记录 ID 计数器已损坏，请先恢复 record-counters.json')
      }
    }
    for (const [prefix, values] of Object.entries(observed)) {
      const maximum = Math.max(0, ...values.map((value) => Number(String(value).match(/\d+$/)?.[0] || 0)))
      counters[prefix] = Math.max(Number(counters[prefix] || 0), maximum)
    }
    return {
      content: `${JSON.stringify({ schemaVersion: 1, counters }, null, 2)}\n`,
      value: undefined,
    }
  })
}

async function removeProjectMarkdownFile(root: string, relativePath: string, baseDir: string) {
  const safePath = safeMarkdownPath(relativePath, baseDir)
  await rm(path.join(root, safePath), { force: true })
}

function safeMarkdownPath(relativePath: string, baseDir: string) {
  const normalized = path.normalize(String(relativePath || '').trim()).replace(/\\/g, '/')
  if (
    !normalized ||
    path.isAbsolute(normalized) ||
    normalized.split('/').includes('..') ||
    !normalized.startsWith(`${baseDir}/`) ||
    !normalized.endsWith('.md')
  ) {
    throw new Error('文件路径不合法')
  }
  return normalized
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
  return notes.sort((a, b) => compareShortIdDesc(a.shortId, b.shortId, 'W') || a.path.localeCompare(b.path, 'zh-Hans-CN'))
}

async function listGlobalKnowledgeDocuments(managerDataRoot: string): Promise<ProjectDocumentNote[]> {
  const files = await listMarkdownFiles(managerDataRoot, GLOBAL_KNOWLEDGE_DIR)
  const notes = await Promise.all(files.map(async (relativePath) => parseDocumentNote(relativePath, await readExistingRootFile(managerDataRoot, relativePath))))
  return notes.sort((a, b) => compareShortIdDesc(a.shortId, b.shortId, 'K') || a.path.localeCompare(b.path, 'zh-Hans-CN'))
}

async function listProjectConstraints(dataRoot: string, currentVersionId: string): Promise<ProjectConstraint[]> {
  const userConstraints = parseUserConstraints(await readConstraintsRecordsFile(dataRoot))
  const systemConstraints = await listSystemConstraints(dataRoot, currentVersionId)
  return [...userConstraints, ...systemConstraints]
}

async function listSystemConstraints(dataRoot: string, currentVersionId: string): Promise<ProjectConstraint[]> {
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
      version: currentVersionId,
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

async function normalizeProjectRecordVersions(dataRoot: string, currentVersionId: string) {
  const versionRecordPaths = (await listMarkdownFiles(dataRoot, 'versions'))
    .filter((relativePath) => relativePath !== VERSIONS_PATH)
  const recordPaths = [...versionRecordPaths, CHANGE_INDEX_PATH, CONSTRAINTS_PATH]

  for (const relativePath of recordPaths) {
    const content = await readExistingProjectFile(dataRoot, relativePath)
    if (!content) continue
    const containingVersion = normalizeVersionId(relativePath.replaceAll('\\', '/').match(/^versions\/(V\d+)\//)?.[1])
      || currentVersionId
    const next = updateMarkdownBlocks(content, (block) => {
      const fields = parseFields(block)
      if (normalizeVersionId(fields.version)) return block
      if (/^version::/m.test(block)) {
        return block.replace(/^version::\s*.*$/m, `version:: ${containingVersion}`)
      }
      if (/^updated::/m.test(block)) {
        return block.replace(/^(updated::\s*.+)$/m, `$1\nversion:: ${containingVersion}`)
      }
      if (/^created::/m.test(block)) {
        return block.replace(/^(created::\s*.+)$/m, `$1\nversion:: ${containingVersion}`)
      }
      if (/^type::/m.test(block)) {
        return block.replace(/^(type::\s*.+)$/m, `$1\nversion:: ${containingVersion}`)
      }
      return block
    })
    if (next !== content) await writeProjectFile(dataRoot, relativePath, next)
  }
}

async function normalizeProjectDocumentFiles(dataRoot: string, currentVersionId: string) {
  const files = (await listMarkdownFiles(dataRoot, DOCUMENTS_DIR))
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))

  const existingShortIds = await Promise.all(files.map(async (relativePath) => {
    const content = await readExistingProjectFile(dataRoot, relativePath)
    return parseFields(content).short_id
  }))
  const usedShortIds = new Set<string>()

  for (const relativePath of files) {
    const content = await readExistingProjectFile(dataRoot, relativePath)
    const fields = parseFields(content)
    const title = noteTitle(content, relativePath)
    const created = fields.created || localTime()
    let shortId = normalizeDocumentShortId(fields.short_id)
    while (!shortId || usedShortIds.has(shortId)) {
      shortId = await allocateShortId(dataRoot, 'W', [...existingShortIds, ...usedShortIds])
    }
    usedShortIds.add(shortId)
    const missing: Record<string, string> = {
      id: fields.id || `document-${slug(relativePath.replace(/\.md$/, ''))}`,
      short_id: shortId,
      type: fields.type || 'document',
      status: fields.status || 'active',
      created,
      updated: fields.updated || created,
      version: normalizeVersionId(fields.version) || currentVersionId,
      tags: fields.tags || 'document',
      summary: fields.summary || firstContentSummary(content) || title,
    }
    const next = addMissingMetadataFields(content, fields, missing)
    const withNormalizedFields = next
      .replace(/^short_id::\s*.+$/m, `short_id:: ${shortId}`)
      .replace(/^version::\s*.*$/m, `version:: ${normalizeVersionId(fields.version) || currentVersionId}`)
    if (withNormalizedFields !== content) await writeProjectFile(dataRoot, relativePath, withNormalizedFields)
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

function compareShortIdDesc(a: string | undefined, b: string | undefined, prefix: string) {
  const left = shortIdNumber(a, prefix)
  const right = shortIdNumber(b, prefix)
  if (left !== right) return right - left
  return String(b || '').localeCompare(String(a || ''))
}

function shortIdNumber(value: string | undefined, prefix: string) {
  const match = String(value || '').trim().match(new RegExp(`^${prefix}(\\d+)$`, 'i'))
  return match ? Number(match[1]) : 0
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
    version: normalizeVersionId(fields.version),
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
    .sort((a, b) => compareShortIdDesc(a.shortId, b.shortId, 'K') || a.title.localeCompare(b.title, 'zh-Hans-CN') || knowledgeSortKey(b).localeCompare(knowledgeSortKey(a)))
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

function updateMarkdownBlocks(content: string, update: (block: string) => string) {
  const next = splitMarkdownBlocks(content)
    .map((block, index) => {
      if (index === 0 && !block.trim().startsWith('## ')) return block.trimEnd()
      return update(block.trim())
    })
    .filter(Boolean)
    .join('\n\n')
  return `${next.trimEnd()}\n`
}

async function updateQuestionRecord(dataRoot: string, questionId: string, update: (block: string) => string) {
  const questionPath = await findVersionRecordPath(dataRoot, VERSION_QUESTIONS_FILE, questionId, normalizeQuestionShortId)
  if (!questionPath) throw new Error('未找到待确认事项')
  await mutateProjectFile(dataRoot, questionPath, (current) => {
    let handled = false
    const next = updateMarkdownBlocks(current, (block) => {
      const fields = parseFields(block)
      if (fields.id !== questionId && normalizeQuestionShortId(fields.short_id) !== normalizeQuestionShortId(questionId)) {
        return block
      }
      handled = true
      return update(block)
    })
    if (!handled) throw new Error('未找到待确认事项')
    return { content: next, value: undefined }
  })
}

function replaceSection(content: string, titles: string[], title: string, value: string) {
  const escaped = titles.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const pattern = new RegExp(`###\\s+(?:${escaped})\\s+[\\s\\S]*?(?=\\n### |$)`)
  const replacement = `### ${title}\n\n${value.trim()}`
  return pattern.test(content) ? content.replace(pattern, replacement) : `${content.trimEnd()}\n\n${replacement}`
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

Current baseline:

\`${path.join(dataRoot, BASELINE_PATH)}\`

Version index:

\`${path.join(dataRoot, VERSIONS_PATH)}\`

Version records:

\`${path.join(dataRoot, 'versions/Vxxx/')}\`

The current version's exact task, question, risk, research, and work-log paths are listed in \`agent-brief.json.currentDataPaths\`.

Shared knowledge root:

\`${knowledgeRoot}\`

Local skill:

\`${path.join(dataRoot, SKILL_PATH)}\`

Project constraints:

\`${path.join(dataRoot, CONSTRAINTS_PATH)}\`

## Agent Start

1. Read the agent brief and current baseline first.
2. Read the local skill before writing records.
3. Work in the current active version by default.
4. Read project constraints for project-wide rules.
5. Read decisions, risks, and historical versions only when relevant.
`
  await atomicWriteFile(path.join(projectRoot, COLLABORATION_ENTRY), content)
}

async function ensureCollaborationIgnored(projectRoot: string) {
  const gitignorePath = path.join(projectRoot, '.gitignore')
  let current = ''

  try {
    current = await readFile(gitignorePath, 'utf8')
  } catch {
    await atomicWriteFile(gitignorePath, `${COLLABORATION_ENTRY}\n`)
    return
  }

  const alreadyIgnored = current
    .split(/\r?\n/)
    .some((line) => line.trim() === COLLABORATION_ENTRY)
  if (alreadyIgnored) return

  const separator = current.endsWith('\n') || current.length === 0 ? '' : '\n'
  await atomicWriteFile(gitignorePath, `${current}${separator}${COLLABORATION_ENTRY}\n`)
}

async function upsertProjectIndex(managerDataRoot: string, config: ProjectConfig) {
  const indexPath = path.join(managerDataRoot, 'projects.json')
  await withFileMutation(indexPath, async () => {
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
    await atomicWriteFile(indexPath, `${JSON.stringify(merged, null, 2)}\n`)
  })
}

async function readProjectIndex(managerDataRoot: string): Promise<ManagedProject[]> {
  try {
    return JSON.parse(await readFile(path.join(managerDataRoot, 'projects.json'), 'utf8')) as ManagedProject[]
  } catch {
    return []
  }
}

function parseProjectVersions(content: string): ProjectVersion[] {
  return splitMarkdownBlocks(content)
    .filter((block) => block.trim().startsWith('## '))
    .map((block) => {
      const fields = parseFields(block)
      const shortId = normalizeVersionId(fields.short_id)
      return {
        id: fields.id || `version-${shortId || createHash('sha1').update(block).digest('hex').slice(0, 8)}`,
        shortId,
        label: fields.label || shortId,
        title: block.match(/^##\s+(.+)$/m)?.[1]?.trim() || fields.label || shortId || '未命名版本',
        status: fields.status === 'completed' ? 'completed' as const : 'active' as const,
        created: fields.created || '',
        completed: fields.completed || '',
        goal: readSection(block, ['版本目标']),
        summary: readSection(block, ['内容描述', '版本总结']),
        outcomes: readListSection(block, ['主要成果']),
        followUps: readListSection(block, ['遗留事项']),
      }
    })
    .sort((a, b) => compareShortIdDesc(a.shortId, b.shortId, 'V'))
}

function parseProjectQuestions(content: string): ProjectOpenQuestion[] {
  return splitMarkdownBlocks(content)
    .filter((block) => block.trim().startsWith('## '))
    .map((block) => {
      const fields = parseFields(block)
      const shortId = normalizeQuestionShortId(fields.short_id)
      return {
        id: fields.id || `question-${shortId}`,
        displayId: shortId,
        shortId,
        title: block.match(/^##\s+(.+)$/m)?.[1]?.trim() || '待确认事项',
        question: readSection(block, ['问题']),
        background: readSection(block, ['背景']),
        recommendation: readSection(block, ['建议']),
        conclusion: readSection(block, ['结论']),
        status: normalizeQuestionStatus(fields.status),
        kind: normalizeQuestionKind(fields.kind),
        scope: fields.scope === 'project' ? 'project' as const : 'version' as const,
        version: normalizeVersionId(fields.version),
        blocking: fields.blocking === 'yes' || fields.blocking === 'true',
        created: fields.created || '',
        updated: fields.updated || fields.created || '',
        relations: splitRefs(fields.source_refs),
      }
    })
    .sort((a, b) => compareShortIdDesc(a.shortId, b.shortId, 'Q'))
}

function parseProjectRisks(content: string): ProjectRisk[] {
  return splitMarkdownBlocks(content)
    .filter((block) => block.trim().startsWith('## '))
    .map((block) => {
      const fields = parseFields(block)
      const shortId = normalizeRiskShortId(fields.short_id)
      return {
        id: fields.id || `risk-${shortId}`,
        shortId,
        title: block.match(/^##\s+(.+)$/m)?.[1]?.trim() || '风险与后续事项',
        kind: normalizeRiskKind(fields.kind),
        status: fields.status === 'resolved' ? 'resolved' as const : fields.status === 'expired' ? 'expired' as const : 'open' as const,
        version: normalizeVersionId(fields.version),
        content: readSection(block, ['内容']),
        handling: readSection(block, ['处理建议']),
        created: fields.created || '',
        updated: fields.updated || fields.created || '',
        relations: splitRefs(fields.source_refs),
      }
    })
    .sort((a, b) => compareShortIdDesc(a.shortId, b.shortId, 'R'))
}

function parseProjectTasks(content: string): ProjectTask[] {
  return splitMarkdownBlocks(content)
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
        version: normalizeVersionId(fields.version),
        detail: readSection(block, ['执行范围']),
        acceptance: readSection(block, ['验收']),
        openQuestions: readSection(block, ['未确认事项']),
      }
    })
}

function parseThoughts(content: string): ProjectThought[] {
  return splitMarkdownBlocks(content)
    .filter((block) => block.trim().startsWith('## '))
    .map((block) => {
      const fields = parseFields(block)
      return {
        id: fields.id || '',
        shortId: fields.short_id || '',
        title: block.match(/^##\s+(.+)$/m)?.[1]?.trim() || '输入',
        status: fields.status || 'inbox',
        created: fields.created || '',
        version: normalizeVersionId(fields.version),
        content: readSection(block, ['内容']),
        answer: readSection(block, ['回答']),
        openQuestions: readSection(block, ['未确认事项']),
        replyRecords: readListSection(block, ['回答记录']),
      }
    })
}

function parseUserConstraints(content: string): ProjectConstraint[] {
  return splitMarkdownBlocks(content)
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
        version: normalizeVersionId(fields.version),
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
  return splitMarkdownBlocks(content)
    .filter((block) => block.trim().startsWith('## '))
    .map((block) => {
      const title = block.match(/^##\s+(.+)$/m)?.[1]?.trim() || '研究'
      const fields = parseFields(block)
      return {
        id: fields.id || '',
        shortId: normalizeDialogueShortId(fields.short_id),
        title,
        created: fields.created || '',
        version: normalizeVersionId(fields.version),
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
    .sort((a, b) => compareShortIdDesc(a.shortId, b.shortId, 'D') || dialogueSortKey(b).localeCompare(dialogueSortKey(a)))
}

function dialogueSortKey(dialogue: Pick<ProjectDialogue, 'created' | 'title' | 'shortId'>) {
  return [
    parseDisplayTimeKey(dialogue.created || dialogue.title),
    dialogue.shortId,
  ].join('\u0000')
}

function parseProjectLogs(content: string, tasks: ProjectTask[] = []): ProjectLog[] {
  const taskByShortId = new Map(tasks.map((task) => [task.shortId, task]))
  const parsedLogs = splitMarkdownBlocks(content)
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
        version: normalizeVersionId(fields.version),
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

function normalizeVersionId(value: string | undefined) {
  const match = String(value || '').trim().match(/^V(\d{1,4})$/i)
  return match ? `V${match[1].padStart(3, '0')}` : ''
}

function recordInVersion(recordVersion: string | undefined, versionId: string) {
  return normalizeVersionId(recordVersion) === normalizeVersionId(versionId)
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
  const lines = stripFencedCode(block).split('\n')
  const headingIndex = lines.findIndex((line) => /^#{1,2}\s+/.test(line))
  let started = false
  for (const line of lines.slice(headingIndex >= 0 ? headingIndex + 1 : 0)) {
    if (!line.trim() && !started) continue
    const match = line.match(/^([A-Za-z0-9_-]+)::\s*(.+)$/)
    if (!match) {
      if (started) break
      continue
    }
    started = true
    fields[match[1]] = match[2].trim()
  }
  return fields
}

function readSection(content: string, titles: string[]) {
  const escaped = titles.map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const match = content.match(new RegExp(`###\\s+(?:${escaped})\\s+([\\s\\S]*?)(?=\\n### |$)`))
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

function indexFromDashboard(dashboard: Dashboard) {
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

function baselineMarkdown(dashboard: Dashboard) {
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
    .map((risk) => `- ${risk.shortId} [${risk.kind}] ${risk.content || risk.title}`)

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
version:: ${task.version}
question_refs:: 无

### 用户原话

${meta.userOriginal}

### Agent 理解

${meta.agentUnderstanding}

### 执行范围

${task.detail}

### 验收

${task.acceptance}
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
  version: string
}) {
  return `# ${input.title}

id:: document-${Date.now()}-${slug(input.title)}
short_id:: ${input.shortId}
type:: document
status:: active
created:: ${input.created}
updated:: ${input.created}
version:: ${input.version}
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
  version: string
}) {
  return `## ${input.created} 研究记录 ${input.dialogueShortId}

type:: agent-log
log_short_id:: ${input.logShortId}
created:: ${input.created}
task_short_id:: T000
source:: research
version:: ${input.version}

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

- 写入 versions/${input.version}/${VERSION_DIALOGUES_FILE}
- 写入 ${input.documentPath}
- 写入 versions/${input.version}/${VERSION_LOGS_DIR}/

### 验证

- 研究概要、详细文档和工作记录已生成。

### 验收标准

${input.acceptance}

### 已知风险

无。

### 后续事项

无。
`
}

function insertMarkdownEntry(current: string, entry: string) {
  const blocks = splitMarkdownBlocks(current)
  const preface = blocks.shift() || ''
  return `${preface.trimEnd()}\n\n${entry.trim()}\n\n${blocks.map((block) => block.trim()).filter(Boolean).join('\n\n')}\n`
}

function splitMarkdownBlocks(content: string) {
  const normalized = content.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const offsets: number[] = []
  let offset = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^##\s+/.test(line) && isRecordHeading(lines, index)) offsets.push(offset)
    offset += line.length + 1
  }

  if (!offsets.length) return [normalized]

  const blocks = [normalized.slice(0, offsets[0]).trimEnd()]
  offsets.forEach((start, index) => {
    const end = offsets[index + 1] ?? normalized.length
    blocks.push(normalized.slice(start, end).trim())
  })
  return blocks.filter((block, index) => index === 0 || Boolean(block))
}

function isRecordHeading(lines: string[], headingIndex: number) {
  const fields: Record<string, string> = {}
  let started = false

  for (let index = headingIndex + 1; index < Math.min(lines.length, headingIndex + 32); index += 1) {
    const line = lines[index]
    if (!line.trim() && !started) continue
    if (/^#{1,3}\s+/.test(line)) break
    const match = line.match(/^([A-Za-z0-9_-]+)::\s*(.+)$/)
    if (!match) {
      if (started) break
      continue
    }
    started = true
    fields[match[1]] = match[2].trim()
  }

  return Boolean(fields.short_id || fields.log_short_id || (fields.id && fields.type))
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

function normalizeQuestionShortId(value: string | undefined) {
  const match = String(value || '').trim().match(/^Q(\d{1,4})$/i)
  return match ? `Q${match[1].padStart(3, '0')}` : ''
}

function normalizeRiskShortId(value: string | undefined) {
  const match = String(value || '').trim().match(/^R(\d{1,4})$/i)
  return match ? `R${match[1].padStart(3, '0')}` : ''
}

function normalizeQuestionStatus(value: string | undefined): ProjectOpenQuestion['status'] {
  return ['open', 'decided', 'resolved', 'expired'].includes(String(value))
    ? value as ProjectOpenQuestion['status']
    : 'open'
}

function normalizeQuestionKind(value: string | undefined): ProjectOpenQuestion['kind'] {
  return ['decision', 'clarification', 'blocker'].includes(String(value))
    ? value as ProjectOpenQuestion['kind']
    : 'decision'
}

function normalizeRiskKind(value: string | undefined): ProjectRisk['kind'] {
  return ['risk', 'verification', 'follow-up'].includes(String(value))
    ? value as ProjectRisk['kind']
    : 'risk'
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
  return `${taskRecordsTemplate()}

## 初始化 ${projectName} 项目协作数据

id:: task-${Date.now()}-init-agent-hub
short_id:: T001
type:: task
status:: done
priority:: high
area:: tool
created:: ${now}
updated:: ${now}
version:: V001
question_refs:: 无

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
`
}

function taskRecordsTemplate() {
  return `# 工程任务

> 当前版本的任务数据源。每个带任务元数据的二级标题是一张任务卡。
> 写入时必须按 short_id 倒序维护：较大的 Txxx 写在较小的 Txxx 上方，例如 T036 在 T001 上面。
`
}

function dataSpecTemplate() {
  return `# 数据层规范

## 基本原则

- Markdown 是主数据源。
- JSON 只作为配置、同步包和可再生成缓存。
- 版本是协作记录的物理边界：任务、想法、研究、问题和风险保存在 \`versions/Vxxx/\`，工作记录保存在 \`versions/Vxxx/工作记录/YYYY-MM.md\`。
- 已完成版本默认只读；新记录只写入 \`agent-brief.json.currentDataPaths\` 指向的当前版本文件。
- 所有项目记录必须写入 \`version:: Vxxx\`，用于标识产生或主要维护阶段，避免后续检索遗漏版本上下文。
- 任务、想法、研究、问题、风险和工作记录按版本进入默认展示和检索范围；文档和项目约束是项目级资料，版本号只用于追溯，不决定是否可见。
- 任务卡必须保留用户原话、Agent 理解、执行范围和验收。
- 所有记录型 Markdown 都必须按 ID 倒序维护：较大的 \`Txxx\`、\`Ixxx\`、\`Dxxx\`、\`Wxxx\`、\`Kxxx\`、\`Lxxx\`、\`Cxxx\` 写在较小 ID 上方，例如 \`T036\` 在 \`T001\` 上面、\`D036\` 在 \`D012\` 上面。这是写入准则，不依赖界面排序或解析层重排。
- 工作记录必须保留用户目标、需求理解、产出、关键步骤、验证、验收标准、已知风险和后续事项。
- 研究保存概要、研究标准和详细文档引用，使用 \`Dxxx\` 作为引用 ID；详细研究过程、路径分析和结论写入关联 \`Wxxx\` 文档。
- 处理 \`Dxxx\` 研究时，必须同时读取 \`### 内容\` 和 \`### 验收标准\`；\`### 验收标准\` 是 Agent 回答或执行的约束，不是仅供 UI 展示的备注。
- 研究默认采用 Tree-of-Thought：至少给出 3 条路径，并写明各自优点、缺点、适用条件和建议结论；用户可以自定义或覆盖这个默认标准。
- 研究页只保留概要和详细文档引用；详细研究结果写入 \`${DOCUMENTS_DIR}/\` 的 \`Wxxx\` 文档，同时写入 Agent 工作记录。
- 文档保存项目本地资料、手册、说明和附件型 Markdown，使用 \`Wxxx\` 作为引用 ID；文档不自动进入知识库。
- 文档属于项目整体，不随版本切换隐藏；历史版本和当前版本都读取同一组项目文档。文档的 \`version::\` 仅表示来源版本。
- 知识条目保存沉淀后的稳定知识、可复用结论、方案和运行经验，使用 \`Kxxx\` 作为引用 ID。
- 研究、文档和知识条目允许独立删除；删除操作不级联，引用关系只由 \`related_documents\` 等字段表达。删除 \`Dxxx\` 研究不删除关联 \`Wxxx\` 文档，删除 \`Wxxx\` 文档不改写研究引用；删除 \`Kxxx\` 知识条目会删除全局共享知识库中的 Markdown，对所有项目生效。
- 项目约束保存当前项目全局规则、长期约定和 Agent 必须遵守的协作准则，使用 \`Cxxx\` 作为引用 ID，并用 \`version:: Vxxx\` 标识来源版本；约束始终项目级可见，不参与版本过滤。系统生成的数据规范、交接说明和本地 SKILL 作为只读系统约束展示，不从用户约束文件删除。
- 数据结构、字段或文件名调整后，应一次性整理当前 Markdown 数据并补齐缺失字段；没有内容写 \`无\` 或 \`暂无\`，不要新增长期运行时兼容判断或只在界面兜底。
- 真正需要用户决定、澄清或解除阻塞的问题只写入当前版本的 \`待确认事项.md\`，使用稳定 \`Qxxx\`；状态为 \`open\`、\`decided\`、\`resolved\` 或 \`expired\`。
- 验证限制、技术风险和后续事项写入当前版本的 \`风险与后续.md\`，使用 \`Rxxx\`，不得塞入任务、想法或工作记录的“未确认事项”。
- 工作记录仍是任务副产品，不是独立执行模块。
- 执行任务前将状态改为 doing，完成验收后改为 done。
- 输入/想法被处理时，不能只修改 status；必须写入 \`### 回答\`，说明处理结论、关联任务或不处理原因。
- 整理输入/想法时，只更新当前版本 \`想法与问题.md\` 的 \`### 回答\` 和必要任务卡；不要为单纯想法整理写 Agent 工作记录。
- 只有执行工程任务、修改代码/文档/规则或完成验收后，才写入 Agent 工作记录。

## 工作流顺序

\`\`\`text
想法/输入 -> 整理回答 -> 必要时产生任务 -> 任务进入 todo/doing/done -> 任务执行并验收后写 Agent 工作记录
\`\`\`

- 想法/输入是收集入口，不代表承诺执行。
- 整理想法时只更新当前版本 \`想法与问题.md\` 的 \`### 回答\`，必要时创建或关联任务短 ID。
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
version:: V001
question_refs:: 无

### 内容

用户输入原文。

### 回答

处理结论。若已转成任务，写明关联任务短 ID；若不处理，写明原因。

\`\`\`

\`status\` 表示处理状态，\`### 回答\` 表示处理结论。标记为 done/handled 前必须先补充回答。
如果想法产生真正需要用户决定的问题，在当前版本 \`待确认事项.md\` 新建独立 QID，并把 \`Ixxx\` 写入 \`source_refs\`。
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
source:: D123
related_records:: D123
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
- 如果与已有知识冲突、缺少判断依据或需要用户选择，在当前版本 \`待确认事项.md\` 创建独立 QID，并关联相关 \`Dxxx\`/\`Wxxx\`/\`Kxxx\`；仅需补充验证或后续跟进时写入当前版本 \`风险与后续.md\`。
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
version:: V001
tags:: document
summary:: 这份文档的简短摘要。

## 正文

项目本地手册、说明、资料或其他 Markdown 文档。
\`\`\`

文档位于项目本地 \`${DOCUMENTS_DIR}/\` 目录，使用 \`Wxxx\` 独立编号。文档和知识库都是 Markdown，但语义不同：文档是项目资料，知识库是沉淀后的稳定结论。不要自动把文档转成知识；只有用户明确要求，或用户要求 Agent 判断是否值得沉淀时，Agent 才评估并建议生成或更新 \`Kxxx\`。

删除文档时，只删除该 \`Wxxx\` 文档本身，不自动改写引用它的 \`Dxxx\` 研究记录。\`related_documents\` 只表达关系，不代表删除级联。

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
version:: V001

### 内容

需要当前项目所有 Agent 长期遵守的规则、边界或协作准则。
\`\`\`

约束位于项目本地 \`${CONSTRAINTS_PATH}\`，用于保存用户手动输入或要求 Agent 长期遵守的项目级全局规则。\`version::\` 只标识约束首次产生或主要维护的版本，约束不随版本切换隐藏。新增约束时按 \`Cxxx\` 倒序写入；删除操作只删除用户约束，不删除系统生成的数据规范、交接说明或本地 SKILL。

## 研究格式

\`\`\`markdown
## YYYY-MM-DD HH:mm 研究

id:: dialogue-...
short_id:: D123
type:: dialogue
created:: YYYY-MM-DD HH:mm
updated:: YYYY-MM-DD HH:mm
version:: V001
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

删除 \`Dxxx\` 研究时，只删除研究记录本身，不自动删除关联 \`Wxxx\` 文档。\`related_documents\` 只表达关系，不代表删除级联。

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
version:: V001

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

### 已知风险

无。

### 后续事项

无。
~~~
`
}

function handoffTemplate(projectRoot: string) {
  return `# Agent 同步交接

## 启动顺序

1. 先读取 Electron Manager 管理数据目录中的 \`agent-brief.json\` 和 \`${BASELINE_PATH}\`。
2. 再读取 \`skills/project-collaboration/SKILL.md\`，写任务和工作记录时必须遵守其中规则。
3. 从 \`agent-brief.json.currentDataPaths\` 获取当前版本的实际文件路径；默认只检索这些文件。
4. 信息不足或用户指定历史版本时，再读取 \`${VERSIONS_PATH}\` 和对应 \`versions/Vxxx/\` 目录。
5. 所有项目记录都必须写入当前 \`version:: Vxxx\`；文档和项目约束的版本号只用于来源追溯，不参与版本过滤。
6. 写入或整理记录时，任务、想法、研究、文档、知识、工作记录和项目约束 Markdown 都必须按 ID 倒序维护：较大的 \`Txxx\`、\`Ixxx\`、\`Dxxx\`、\`Wxxx\`、\`Kxxx\`、\`Lxxx\`、\`Cxxx\` 写在较小 ID 上方，例如 \`T036\` 在 \`T001\` 上面。
7. 处理 \`Dxxx\` 研究时读取当前版本 \`研究.md\`，同时使用 \`### 内容\` 和 \`### 验收标准\`；验收标准是回答或执行的完成口径。默认研究标准是 Tree-of-Thought：至少 3 条路径，并写明各自优缺点、适用条件和建议结论。
8. 需要长期知识时读取全局共享知识库 \`${GLOBAL_KNOWLEDGE_DIR}/\` 中的 \`Kxxx\` 条目；知识库不属于单个项目。
9. 需要当前项目全局约束时读取 \`${CONSTRAINTS_PATH}\` 中的 \`Cxxx\` 条目；系统生成的数据规范、交接说明和本地 SKILL 是只读系统约束。
10. 执行任务前更新任务状态为 doing。
11. 完成验收后更新任务状态为 done，并写入当前版本的当月工作记录。
12. 整理输入/想法时只写回想法回答和必要任务卡；没有执行工程任务时，不写入 Agent 工作记录。

## 工作流顺序

\`\`\`text
想法/输入 -> 整理回答 -> 必要时产生任务 -> 任务进入 todo/doing/done -> 任务执行并验收后写 Agent 工作记录
\`\`\`

- 想法是入口，任务是执行单位，工作记录是任务执行后的记录。
- 研究保存概要、标准和详细文档引用，使用 \`Dxxx\` 引用；详细研究结果写入 \`Wxxx\` 文档，研究动作写入工作记录。
- 文档保存项目本地资料和说明，使用 \`Wxxx\` 引用；文档不会自动进入知识库。
- 文档和项目约束是项目级资料，必须标注来源版本，但不按版本过滤；版本切换只影响协作记录视野。
- 研究、文档和知识可独立删除；删除操作不级联，引用关系只由字段表达。
- 项目约束保存当前项目长期规则，使用 \`Cxxx\` 引用；新增约束要写入 \`${CONSTRAINTS_PATH}\` 并标注当前版本。
- 处理研究时不要只看标题或内容；必须检查同一条记录的 \`### 验收标准\`，并用它校准回答深度、列举范围、验证方式或交付边界。没有自定义标准时，按默认 Tree-of-Thought 标准执行。
- 想法被采纳时，在 \`### 回答\` 中写清关联任务短 ID。
- 待确认事项只写入当前版本 \`待确认事项.md\`，使用稳定 QID 和明确生命周期；验证限制、风险和后续事项写入当前版本 \`风险与后续.md\`。
- 任务开始前更新为 \`doing\`，验收通过后更新为 \`done\`。
- 只有实际执行任务、修改代码/文档/规则或完成验收时，才写 Agent 工作记录。

## 工作记录要求

写入当前版本 \`工作记录/YYYY-MM.md\` 时必须保留：

- \`### 用户目标\`
- \`### 需求理解\`
- \`### 产出\`
- \`### 关键步骤\`
- \`### 执行动作\`
- \`### 验证\`
- \`### 验收标准\`
- \`### 已知风险\`
- \`### 后续事项\`

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
> 写入时必须按 short_id 倒序维护：较大的 Dxxx 写在较小的 Dxxx 上方，例如 D036 在 D012 上面。
`
}

function agentLogTemplate() {
  return `${agentLogRecordsTemplate()}

## 初始化 Agent Hub

type:: agent-log
log_short_id:: L001
created:: ${localTime()}
task_short_id:: T001
version:: V001
question_refs:: 无

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

### 已知风险

无。

### 后续事项

无。
`
}

function agentLogRecordsTemplate() {
  return `# Agent 工作记录

> 当前版本当月的执行记录。写入时必须按记录 ID 倒序维护：较大的 Lxxx 写在较小的 Lxxx 上方，例如 L036 在 L001 上面。
`
}

function changeIndexTemplate() {
  return `# 需求变更索引

> 业务范围、页面能力、交互方式和数据模型变化记录在这里。
`
}

function constraintsTemplate() {
  return `# 项目约束

> 当前项目的全局约束、协作准则和长期规则。手动写入时使用 Cxxx、标注 version:: Vxxx，并按 short_id 倒序维护：较大的 Cxxx 写在较小的 Cxxx 上方，例如 C036 在 C001 上面。
> 系统生成的协作规则会在界面中作为只读约束展示；这里主要保存用户手动补充或要求 Agent 长期遵守的项目约束。
`
}

function questionsTemplate() {
  return `# 待确认事项

> 这里只记录确实需要用户决定、澄清或解除阻塞的问题。验证限制、风险和后续事项写入 collaboration/风险与后续.md。
> 问题状态：open（待决定）、decided（已决定待落实）、resolved（已解决）、expired（已过期）。
`
}

function risksTemplate() {
  return `# 风险与后续

> 保存验证限制、技术风险和后续事项，不要求用户逐条回复。
> 类型：risk、verification、follow-up。状态：open、resolved、expired。
`
}

function versionsTemplate(projectName: string) {
  const now = localTime()
  return `# 版本索引

> 版本是人和 Agent 共用的阶段上下文。新记录默认归入当前 active 版本。

## ${projectName} 初始版本

id:: version-${Date.now()}-initial
short_id:: V001
label:: v0.1
status:: active
created:: ${now}
completed:: 无

### 版本目标

建立当前项目的稳定协作上下文。

### 内容描述

项目初始化后的当前工作阶段。

### 主要成果

- 无。

### 遗留事项

- 无。
`
}

function skillTemplate(projectRoot: string, dataRoot: string) {
  return `# Project Collaboration Skill

Use this skill when working on this project with Electron Manager initialized data.

## Data Root

\`${dataRoot}\`

## Start Here

1. Read \`${path.join(dataRoot, 'agent-brief.json')}\`.
2. Read the current project baseline: \`${path.join(dataRoot, BASELINE_PATH)}\`.
3. Read this skill file before writing records: \`${path.join(dataRoot, SKILL_PATH)}\`.
4. Work within the current version from \`${path.join(dataRoot, VERSIONS_PATH)}\` by default.
5. Resolve the exact current task, thought, research, question, risk, and work-log paths from \`agent-brief.json.currentDataPaths\`.
6. Read current questions only for decisions or clarifications that need user input; read current risks for verification limits and follow-up work.
7. Read historical \`versions/Vxxx/\` directories only when the current context is insufficient or the user explicitly requests history.
8. Read \`${path.join(dataRoot, CONSTRAINTS_PATH)}\` for project-wide constraints.

## Rules

- Treat the current active version as the default context. Store version-scoped records inside \`versions/Vxxx/\` and add \`version:: Vxxx\` to every project record. Project documents and project constraints use it only as provenance; both remain project-wide and are never version-filtered.
- Treat completed version directories as read-only history. Write new records only to the paths exposed by \`agent-brief.json.currentDataPaths\`.
- Search historical versions only when current context is insufficient or the user explicitly asks for history.
- Before executing a task, set its status to \`doing\`.
- After verification, set its status to \`done\`.
- Keep all record Markdown physically ordered by descending record ID: larger \`Txxx\`, \`Ixxx\`, \`Dxxx\`, \`Wxxx\`, \`Kxxx\`, \`Lxxx\`, and \`Cxxx\` entries must appear above smaller IDs, for example \`T036\` above \`T001\` and \`D036\` above \`D012\`. This is a writing rule; do not rely on UI sorting or parser reordering to fix record order.
- Preserve user wording in \`### 用户原话\`.
- Keep \`### Agent 理解\`, \`### 执行范围\`, and \`### 验收\` explicit in tasks.
- Keep agent logs explicit with \`### 需求理解\`, \`### 产出\`, \`### 关键步骤\`, \`### 验证\`, \`### 验收标准\`, \`### 已知风险\`, and \`### 后续事项\`.
- Agent logs should include \`log_short_id:: Lxxx\` and should include \`task_short_id:: Txxx\` for real task execution; general logs without a task relation use \`T000\`.
- Put acceptance criteria near the end of agent logs, after execution and verification details.
- Do not omit required agent-log sections just because the UI can display a fallback; write the sections into Markdown.
- When data structures, fields, or file names change, normalize the current Markdown data in place and fill missing fields with explicit values such as \`无\` or \`暂无\`. Do not add long-lived runtime compatibility branches or rely only on UI fallbacks.
- Treat questions as independent QID items in the current version's \`待确认事项.md\`. Use \`open\` for pending user decisions, \`decided\` for confirmed decisions awaiting implementation, \`resolved\` after implementation, and \`expired\` when no longer relevant.
- Only create a QID for a genuine decision, clarification, or blocker that requires the user. Put technical risk, unavailable verification, and follow-up work in the current version's \`风险与后续.md\`; never create inline \`### 未确认事项\` sections in tasks, thoughts, or logs.
- Task short IDs, thought short IDs, and work-log reference IDs such as \`L001\` are relation labels, not question IDs. Use \`question_refs:: Qxxx\` where a record implements or relates to a decision.
- Treat work logs as task execution byproducts. Use \`Lxxx\` only for reference, jump, and audit trails; do not treat logs as execution modules.
- Use \`Wxxx\` documents in project-local \`${DOCUMENTS_DIR}/\` for manuals, source material, specs, and other Markdown documents. Documents do not automatically become knowledge notes.
- Use knowledge notes in the global shared \`${path.join(path.dirname(path.dirname(dataRoot)), GLOBAL_KNOWLEDGE_DIR)}\` directory for stable knowledge, detailed answers, decisions refined from research notes, runbooks, and reusable context. Reference them as \`Kxxx\`. Knowledge is shared by all projects and is not stored under a single project data root. The Knowledge Base view shows only \`Kxxx\` notes; each knowledge note should include \`source_project:: <project name>\` so the card can show where it came from. The Documents view shows only project-local Markdown files under \`${DOCUMENTS_DIR}/\`, not tasks, thoughts, research, collaboration, or work logs. Research notes and documents do not automatically become knowledge notes; when the user asks to distill or summarize into knowledge, or asks the Agent to judge whether something should enter knowledge, collect the relevant \`Dxxx\`/\`Wxxx\`, compare them with existing global \`Kxxx\`, then create, update, merge, or refine knowledge. If there is a conflict or missing decision, create an open question linked to the relevant \`Dxxx\`/\`Wxxx\`/\`Kxxx\`.
- Use project constraints in \`${CONSTRAINTS_PATH}\` for project-wide rules, collaboration boundaries, long-lived preferences, and requirements that every Agent should obey. Reference them as \`Cxxx\` and record their source version. Constraints remain project-wide regardless of that version. New constraints are user-authored records; generated data specs, handoff notes, and this skill are read-only system constraints in the app view.
- Use the current version's \`研究.md\` for research summaries, standards, and links to detailed \`Wxxx\` documents. Reference them as \`Dxxx\`. Default research uses Tree-of-Thought: provide at least 3 paths with pros, cons, fit conditions, and a recommendation, unless the user provides a custom standard. Keep research entries brief; write detailed research results into project-local \`Wxxx\` documents and write the research action into the current monthly work log. If the user explicitly asks to save something, write a record; if you judge something is worth preserving, ask before saving it. Executable work still belongs in tasks, task execution still belongs in agent logs, and open questions still use QIDs.
- When a user asks an agent to answer, continue, verify, or execute a \`Dxxx\` research record, read that specific record from the matching version's \`研究.md\`, then read its related \`Wxxx\` document for the detailed research result. Treat \`### 验收标准\` as the completion criteria, and do not answer from the \`Dxxx\` summary alone.
- Research, documents, and knowledge notes are independently deletable records. Deletion does not cascade. \`related_documents\` and similar fields express references only; they do not imply automatic deletion or reference rewriting. Deleting a \`Kxxx\` knowledge note removes the global shared Markdown note and affects every project.
- If an input/thought raises a genuine user decision, create an independent QID in the current version's \`待确认事项.md\` and link the thought through \`relations:: Ixxx\`. Otherwise record the concern in the current version's \`风险与后续.md\`.
- When handling an input/thought in the current version's \`想法与问题.md\`, do not only change \`status\`; add \`### 回答\` with the conclusion, related task short ID, or reason for not acting.
- Follow the workflow: thought/input -> answered triage -> optional task -> task status -> agent log after task execution and verification.
- Do not create an agent log for thought triage alone. If a thought becomes a task, record the task short ID in \`### 回答\`; write an agent log only when that task is actually executed and verified.
- Record task execution, code/document/rule changes, and verification in the current version's monthly work log.
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
