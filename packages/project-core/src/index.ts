import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

import type {
  AgentBrief,
  Dashboard,
  ManagedProject,
  NewConstraintInput,
  NewDialogueInput,
  NewQuestionInput,
  NewTaskInput,
  NewVersionInput,
  OpenQuestionReplyInput,
  ProjectConfig,
  ProjectConstraint,
  ProjectDialogue,
  ProjectDocumentNote,
  ProjectKnowledgeNote,
  ProjectLog,
  ProjectLogLevel,
  ProjectOpenQuestion,
  ProjectQuestionMessage,
  ProjectRisk,
  ProjectTask,
  ProjectThought,
  ProjectVersion,
  ProjectGuidanceSyncResult,
  ResearchMode,
  ResearchStatus,
} from './types.js'
export type {
  AgentBrief,
  Dashboard,
  ManagedProject,
  NewConstraintInput,
  NewDialogueInput,
  NewQuestionInput,
  NewTaskInput,
  NewVersionInput,
  OpenQuestionReplyInput,
  ProjectConfig,
  ProjectConstraint,
  ProjectDialogue,
  ProjectDocumentNote,
  ProjectKnowledgeNote,
  ProjectLog,
  ProjectLogLevel,
  ProjectOpenQuestion,
  ProjectQuestionMessage,
  ProjectRisk,
  ProjectTask,
  ProjectThought,
  ProjectVersion,
  ProjectGuidanceSyncResult,
  ResearchMode,
  ResearchStatus,
} from './types.js'
import {
  COLLABORATION_ENTRY,
  DATA_DIR,
  DATA_SPEC_PATH,
  HANDOFF_PATH,
  CHANGE_INDEX_PATH,
  CONSTRAINTS_PATH,
  BASELINE_PATH,
  VERSIONS_PATH,
  DOCUMENTS_DIR,
  GLOBAL_KNOWLEDGE_DIR,
  SKILL_PATH,
  RECORD_COUNTERS_PATH,
  VERSION_TASKS_FILE,
  VERSION_THOUGHTS_FILE,
  VERSION_DIALOGUES_FILE,
  VERSION_QUESTIONS_FILE,
  VERSION_RISKS_FILE,
  VERSION_LOGS_DIR,
} from './paths.js'
import {
  agentLogTemplate,
  changeIndexTemplate,
  constraintsTemplate,
  dataSpecTemplate,
  dialoguesTemplate,
  handoffTemplate,
  questionsTemplate,
  risksTemplate,
  skillTemplate,
  taskRecordsTemplate,
  tasksTemplate,
  thoughtsTemplate,
  versionsTemplate,
} from './templates.js'
import { localTime, slug } from './utils.js'
import {
  constraintRecordTemplate,
  dialogueRecordTemplate,
  questionRecordTemplate,
  taskRecordTemplate,
  thoughtRecordTemplate,
  versionRecordTemplate,
} from './record-templates.js'
import {
  normalizeResearchMode,
  parseFields,
  parseUserConstraints,
  readListSection,
  readSection,
  recordInVersion,
  splitRefs,
  normalizeDialogueShortId,
  normalizeVersionId,
  parseDialogues,
  parseProjectLogs,
  parseProjectQuestions,
  parseProjectRisks,
  parseProjectTasks,
  parseProjectVersions,
  parseThoughts,
} from './parsers.js'
const fileMutationQueues = new Map<string, Promise<void>>()
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
  const config = await readProjectConfig(managerDataRoot, projectRoot)
  await writeProjectFile(dataRoot, DATA_SPEC_PATH, dataSpecTemplate())
  await writeProjectFile(dataRoot, HANDOFF_PATH, handoffTemplate(projectRoot))
  await writeProjectFile(dataRoot, SKILL_PATH, skillTemplate(projectRoot, dataRoot))
  await writeCollaborationEntry(projectRoot, dataRoot)
  await ensureCollaborationIgnored(projectRoot)
  await refreshAgentBrief(managerDataRoot, projectRoot)
  await upsertProjectIndex(managerDataRoot, config, false)
  return getDashboard(managerDataRoot, projectRoot)
}

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
  const activeRisks = risks.filter((risk) =>
    risk.status === 'open' && recordInVersion(risk.version, currentVersionId),
  )
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
    activeResearch,
    openQuestions,
    pendingDecisions,
    activeRisks,
    latestLogs,
    instructions: [
      `先读取 ${path.join(dataRoot, 'agent-brief.json')} 建立最新上下文。`,
      `然后读取 ${path.join(dataRoot, BASELINE_PATH)} 获取当前项目基线与版本范围。`,
      `然后读取 ${path.join(dataRoot, SKILL_PATH)}，按其中规则写任务和工作记录。`,
      '研究使用 mode:: breadth | depth；新研究先进入 pending，完成后再写入结果。',
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
    activeResearch,
    openQuestions,
    latestLogs,
    agentBrief,
  }
}

export async function listManagedProjects(managerDataRoot: string): Promise<ManagedProject[]> {
  return (await readProjectIndex(managerDataRoot))
    .slice()
    .sort((a, b) => projectOpenTime(b).localeCompare(projectOpenTime(a)))
}

export async function updateAllProjectGuidance(managerDataRoot: string): Promise<ProjectGuidanceSyncResult[]> {
  const projects = await listManagedProjects(managerDataRoot)
  const results: ProjectGuidanceSyncResult[] = []
  for (const project of projects) {
    try {
      await updateProjectGuidance(managerDataRoot, project.projectRoot)
      results.push({
        projectId: project.projectId,
        projectName: project.projectName,
        projectRoot: project.projectRoot,
        status: 'updated',
        error: '',
      })
    } catch (error) {
      results.push({
        projectId: project.projectId,
        projectName: project.projectName,
        projectRoot: project.projectRoot,
        status: 'failed',
        error: String(error),
      })
    }
  }
  return results
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
  const config = await readProjectConfig(managerDataRoot, projectRoot)
  const taskPath = versionRecordPath(config.currentVersionId, VERSION_TASKS_FILE)
  await mutateProjectFile(dataRoot, taskPath, async (current) => {
    const tasks = parseProjectTasks(current)
    const now = localTime()
    const task = taskRecordTemplate({
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
  const config = await readProjectConfig(managerDataRoot, projectRoot)
  const thoughtPath = versionRecordPath(config.currentVersionId, VERSION_THOUGHTS_FILE)
  await mutateProjectFile(dataRoot, thoughtPath, async (current) => {
    const thoughts = parseThoughts(current)
    const now = localTime()
    const entry = thoughtRecordTemplate({
      id: createId('thought', normalized.slice(0, 24)),
      shortId: await allocateShortId(dataRoot, 'I', thoughts.map((item) => item.shortId)),
      created: now,
      version: config.currentVersionId,
      content: normalized,
    })
    return { content: insertMarkdownEntry(current, entry), value: undefined }
  })
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function appendDialogue(managerDataRoot: string, projectRoot: string, input: NewDialogueInput) {
  if (!input) throw new Error('研究内容不能为空')
  const normalized = String(input.content || '').trim()
  if (!normalized) throw new Error('研究内容不能为空')

  const mode = normalizeResearchMode(input.mode, 'breadth')
  const acceptance = String(input.acceptance || '').trim() || researchModeReference(mode)
  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const config = await readProjectConfig(managerDataRoot, projectRoot)
  const dialoguePath = versionRecordPath(config.currentVersionId, VERSION_DIALOGUES_FILE)
  const dialogues = parseDialogues(await readVersionRecordFamily(dataRoot, VERSION_DIALOGUES_FILE))
  const now = localTime()
  const shortId = await allocateShortId(dataRoot, 'D', dialogues.map((item) => item.shortId))
  const entry = dialogueRecordTemplate({
    id: createId('dialogue', normalized.slice(0, 24)),
    shortId,
    created: now,
    version: config.currentVersionId,
    mode,
    content: normalized,
    acceptance,
  })
  await mutateProjectFile(dataRoot, dialoguePath, (current) => ({
    content: insertMarkdownEntry(current || dialoguesTemplate(), entry),
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
  const config = await readProjectConfig(managerDataRoot, projectRoot)
  await mutateProjectFile(dataRoot, CONSTRAINTS_PATH, async (current) => {
    const source = current || constraintsTemplate()
    const constraints = parseUserConstraints(source)
    const now = localTime()
    const entry = constraintRecordTemplate({
      title,
      id: createId('constraint', title),
      shortId: await allocateShortId(dataRoot, 'C', constraints.map((item) => item.shortId)),
      status: normalizeConstraintStatus(input.status || 'active'),
      scope: String(input.scope || '').trim() || 'project',
      created: now,
      version: config.currentVersionId,
      content,
    })
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
  const documents = await listProjectDocuments(dataRoot)
  const shortId = normalizeDocumentShortId(target)
  const note = documents.find((item) =>
    item.path === target || (shortId && item.shortId === shortId),
  )
  if (!note) throw new Error('未找到文档')

  await removeProjectMarkdownFile(dataRoot, note.path, DOCUMENTS_DIR)
  await refreshAgentBrief(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function deleteKnowledge(managerDataRoot: string, projectRoot: string, knowledgeTarget: string) {
  const target = String(knowledgeTarget || '').trim()
  if (!target) throw new Error('知识 ID 不能为空')

  const notes = parseKnowledgeNotes(await listGlobalKnowledgeDocuments(managerDataRoot))
  const shortId = normalizeKnowledgeShortId(target)
  const note = notes.find((item) =>
    item.path === target || item.id === target || (shortId && item.shortId === shortId),
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
  const config = await readProjectConfig(managerDataRoot, projectRoot)
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
    const entry = versionRecordTemplate({
      title,
      id: createId('version', `${label}-${title}`),
      shortId: nextVersionId,
      label,
      created: now,
      goal,
      summary: String(input.summary || '').trim() || '当前版本进行中。',
    })
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
  const config = await readProjectConfig(managerDataRoot, projectRoot)
  const questionPath = versionRecordPath(config.currentVersionId, VERSION_QUESTIONS_FILE)
  await mutateProjectFile(dataRoot, questionPath, async (current) => {
    const questions = parseProjectQuestions(current)
    const now = localTime()
    const shortId = await allocateShortId(dataRoot, 'Q', questions.map((item) => item.shortId))
    const origin = input.origin === 'user' ? 'user' : 'agent'
    const status = origin === 'user' ? 'decided' : 'open'
    const role = origin === 'user' ? '用户' : 'Agent'
    const entry = questionRecordTemplate({
      title,
      id: createId('question', title),
      shortId,
      status,
      kind: normalizeQuestionKind(input.kind),
      scope: input.scope === 'project' ? 'project' : 'version',
      version: config.currentVersionId,
      blocking: input.blocking ? 'yes' : 'no',
      created: now,
      relations: (input.relations || []).join(', ') || '无',
      origin,
      role,
      question,
      background: String(input.background || '').trim() || '无。',
      recommendation: String(input.recommendation || '').trim() || '无。',
    })
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
    appendQuestionMessage(
      replaceSection(
      block
        .replace(/^status::\s*.+$/m, 'status:: decided')
        .replace(/^updated::\s*.+$/m, `updated:: ${localTime()}`),
      ['结论'],
      '结论',
      answer,
      ),
      'user',
      localTime(),
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
  await upsertProjectIndex(managerDataRoot, dashboard.config, false)
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
  return readFile(path.join(dataRoot, relativePath), 'utf8')
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

async function readConstraintsRecordsFile(dataRoot: string) {
  const current = await readExistingProjectFile(dataRoot, CONSTRAINTS_PATH)
  return current || constraintsTemplate()
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

function normalizeKnowledgeShortId(value: string | undefined) {
  const match = String(value || '').trim().match(/^K(\d{1,4})$/i)
  return match ? `K${match[1].padStart(3, '0')}` : ''
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


function replaceSection(content: string, titles: string[], title: string, value: string) {
  const escaped = titles.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const pattern = new RegExp(`###\\s+(?:${escaped})\\s+[\\s\\S]*?(?=\\n### |$)`)
  const replacement = `### ${title}\n\n${value.trim()}`
  return pattern.test(content) ? content.replace(pattern, replacement) : `${content.trimEnd()}\n\n${replacement}`
}

function researchModeReference(mode: ResearchMode) {
  return mode === 'depth' ? '按深度研究默认标准执行。' : '按广度研究默认标准执行。'
}

async function updateQuestionRecord(dataRoot: string, questionId: string, update: (block: string) => string) {
  const questionPath = await findVersionRecordPath(dataRoot, VERSION_QUESTIONS_FILE, questionId, normalizeQuestionShortId)
  if (!questionPath) throw new Error('未找到待确认事项')
  await mutateProjectFile(dataRoot, questionPath, (current) => {
    let handled = false
    const next = updateMarkdownBlocks(current, (block) => {
      const fields = parseFields(block)
      if (fields.id !== questionId && normalizeQuestionShortId(fields.short_id) !== normalizeQuestionShortId(questionId)) return block
      handled = true
      return update(block)
    })
    if (!handled) throw new Error('未找到待确认事项')
    return { content: next, value: undefined }
  })
}

function appendQuestionMessage(block: string, role: ProjectQuestionMessage['role'], created: string, content: string) {
  const label = role === 'user' ? '用户' : role === 'agent' ? 'Agent' : '历史记录'
  const existing = readSection(block, ['对话记录'])
  const message = '#### ' + label + ' · ' + created + '\n\n' + String(content || '').trim()
  return replaceSection(block, ['对话记录'], '对话记录', [existing, message].filter(Boolean).join('\n\n'))
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

async function upsertProjectIndex(managerDataRoot: string, config: ProjectConfig, recordOpen = true) {
  const indexPath = path.join(managerDataRoot, 'projects.json')
  await withFileMutation(indexPath, async () => {
    const projects = await readProjectIndex(managerDataRoot)
    const existing = projects.find((project) => project.projectId === config.projectId)
    const now = recordOpen ? new Date().toISOString() : existing?.lastOpenedAt || config.createdAt
    const next: ManagedProject = {
      projectId: config.projectId,
      projectName: config.name,
      projectRoot: config.projectRoot,
      dataRoot: config.dataRoot,
      createdAt: existing?.createdAt || config.createdAt,
      lastOpenedAt: now,
    }
    const merged = recordOpen
      ? [next, ...projects.filter((project) => project.projectId !== config.projectId)]
      : projects.map((project) => project.projectId === config.projectId ? next : project)
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
