import {
  CONSTRAINTS_PATH,
  DOCUMENTS_DIR,
  GLOBAL_KNOWLEDGE_DIR,
  VERSION_DIALOGUES_FILE,
  VERSION_TASKS_FILE,
  VERSION_THOUGHTS_FILE,
} from './paths.js'
import {
  normalizeConstraintStatus,
  normalizeDepthReason,
  normalizeDialogueShortId,
  normalizeResearchMode,
  normalizeThoughtShortId,
  normalizeWorkLevel,
  parseDialogues,
  parseFields,
  parseProjectTasks,
  parseThoughts,
  parseUserConstraints,
  splitMarkdownBlocks,
} from './parsers.js'
import {
  constraintRecordTemplate,
  dialogueRecordTemplate,
  taskRecordTemplate,
  thoughtRecordTemplate,
} from './record-templates.js'
import { constraintsTemplate, dialoguesTemplate } from './templates.js'
import type {
  NewConstraintInput,
  NewDialogueInput,
  NewTaskInput,
  NewThoughtInput,
} from './types.js'
import { localTime } from './utils.js'
import { getDashboard, refreshRecordSummary } from './dashboard.js'
import {
  createId,
  insertMarkdownEntry,
  normalizeStatus,
  normalizeTitle,
  researchModeReference,
  replaceSection,
} from './internal/markdown.js'
import {
  listGlobalKnowledgeDocuments,
  listProjectDocuments,
  normalizeDocumentShortId,
  normalizeKnowledgeShortId,
  parseKnowledgeNotes,
} from './internal/notes.js'
import { readProjectConfig, resolveExistingDataRoot } from './internal/project-context.js'
import {
  allocateShortId,
  mutateProjectFile,
  removeProjectMarkdownFile,
} from './internal/storage.js'
import {
  findVersionRecordPath,
  readVersionRecordFamily,
  resolveWritableVersionId,
  versionRecordPath,
} from './internal/version-files.js'

export async function appendTask(managerDataRoot: string, projectRoot: string, input: NewTaskInput) {
  if (!input) throw new Error('任务内容不能为空')
  const title = normalizeTitle(input.title || '')
  if (!title) throw new Error('任务标题不能为空')
  const workLevel = normalizeWorkLevel(input.workLevel, 'light')
  const depthReason = normalizeDepthReason(input.depthReason)
  if (workLevel === 'deep' && !depthReason) throw new Error('深度任务必须说明深度原因')
  if (workLevel === 'deep' && !String(input.constraints || '').trim()) throw new Error('深度任务必须填写关键约束')
  if (workLevel === 'deep' && !String(input.planRollback || '').trim()) throw new Error('深度任务必须填写方案与回退')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const config = await readProjectConfig(managerDataRoot, projectRoot)
  const versionId = await resolveWritableVersionId(dataRoot, input.versionId, config.currentVersionId)
  const taskPath = versionRecordPath(versionId, VERSION_TASKS_FILE)
  await mutateProjectFile(dataRoot, taskPath, async (current) => {
    const tasks = parseProjectTasks(current)
    const now = localTime()
    const task = taskRecordTemplate({
      id: createId('task', title),
      shortId: await allocateShortId(dataRoot, 'T', tasks.map((item) => item.shortId)),
      title,
      status: normalizeStatus(input.status || 'todo'),
      priority: input.priority || 'medium',
      workLevel,
      depthReason,
      area: input.area || 'tool',
      updated: now,
      version: versionId,
      userOriginal: input.userOriginal || title,
      detail: input.executionDefinition || '待补充。',
      acceptance: input.acceptance || '待补充。',
      constraints: input.constraints || '待补充。',
      planRollback: input.planRollback || '待补充。',
    }, {
      created: now,
      userOriginal: input.userOriginal || title,
    })
    return { content: insertMarkdownEntry(current, task), value: undefined }
  })
  await refreshRecordSummary(managerDataRoot, projectRoot)
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
  await refreshRecordSummary(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function deleteTask(managerDataRoot: string, projectRoot: string, taskId: string) {
  return deleteVersionRecord(managerDataRoot, projectRoot, taskId, VERSION_TASKS_FILE, '任务 ID 不能为空', '未找到任务记录')
}

export async function appendThought(
  managerDataRoot: string,
  projectRoot: string,
  input: string | NewThoughtInput,
) {
  const normalized = String(typeof input === 'string' ? input : input?.content || '').trim()
  if (!normalized) throw new Error('输入内容不能为空')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const config = await readProjectConfig(managerDataRoot, projectRoot)
  const versionId = await resolveWritableVersionId(
    dataRoot,
    typeof input === 'string' ? undefined : input.versionId,
    config.currentVersionId,
  )
  const thoughtPath = versionRecordPath(versionId, VERSION_THOUGHTS_FILE)
  await mutateProjectFile(dataRoot, thoughtPath, async (current) => {
    const thoughts = parseThoughts(current)
    const now = localTime()
    const entry = thoughtRecordTemplate({
      id: createId('thought', normalized.slice(0, 24)),
      shortId: await allocateShortId(dataRoot, 'I', thoughts.map((item) => item.shortId)),
      created: now,
      version: versionId,
      content: normalized,
    })
    return { content: insertMarkdownEntry(current, entry), value: undefined }
  })
  await refreshRecordSummary(managerDataRoot, projectRoot)
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
  const versionId = await resolveWritableVersionId(dataRoot, input.versionId, config.currentVersionId)
  const dialoguePath = versionRecordPath(versionId, VERSION_DIALOGUES_FILE)
  const dialogues = parseDialogues(await readVersionRecordFamily(dataRoot, VERSION_DIALOGUES_FILE))
  const now = localTime()
  const shortId = await allocateShortId(dataRoot, 'D', dialogues.map((item) => item.shortId))
  const entry = dialogueRecordTemplate({
    id: createId('dialogue', normalized.slice(0, 24)),
    shortId,
    created: now,
    version: versionId,
    mode,
    content: normalized,
    acceptance,
  })
  await mutateProjectFile(dataRoot, dialoguePath, (current) => ({
    content: insertMarkdownEntry(current || dialoguesTemplate(), entry),
    value: undefined,
  }))
  await refreshRecordSummary(managerDataRoot, projectRoot)
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
  const versionId = await resolveWritableVersionId(dataRoot, input.versionId, config.currentVersionId)
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
      version: versionId,
      content,
    })
    return { content: insertMarkdownEntry(source, entry), value: undefined }
  })
  await refreshRecordSummary(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function deleteConstraint(managerDataRoot: string, projectRoot: string, constraintId: string) {
  return deleteRecordFromPath(managerDataRoot, projectRoot, constraintId, CONSTRAINTS_PATH, '约束 ID 不能为空', '未找到约束记录')
}

export async function deleteThought(managerDataRoot: string, projectRoot: string, thoughtId: string) {
  return deleteVersionRecord(managerDataRoot, projectRoot, thoughtId, VERSION_THOUGHTS_FILE, '输入 ID 不能为空', '未找到输入记录')
}

export async function updateThoughtStatus(
  managerDataRoot: string,
  projectRoot: string,
  thoughtId: string,
  status: string,
  answer?: string,
) {
  const target = String(thoughtId || '').trim()
  const nextStatus = String(status || '').trim().toLowerCase()
  if (!target) throw new Error('想法 ID 不能为空')
  if (nextStatus !== 'inbox' && nextStatus !== 'handled') throw new Error('想法状态不合法')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const thoughtPath = await findVersionRecordPath(dataRoot, VERSION_THOUGHTS_FILE, target, normalizeThoughtShortId)
  if (!thoughtPath) throw new Error('未找到想法记录')
  await mutateProjectFile(dataRoot, thoughtPath, (current) => {
    let updated = false
    const next = splitMarkdownBlocks(current)
      .map((block, index) => {
        if (index === 0 && !block.trim().startsWith('## ')) return block
        const fields = parseFields(block)
        const matches = fields.id === target
          || (normalizeThoughtShortId(target) !== ''
            && normalizeThoughtShortId(fields.short_id) === normalizeThoughtShortId(target))
        if (!matches) return block

        const currentAnswer = readThoughtAnswer(block)
        const suppliedAnswer = answer === undefined ? undefined : String(answer).trim()
        const effectiveAnswer = suppliedAnswer === undefined ? currentAnswer : suppliedAnswer
        if (nextStatus === 'handled' && !isMeaningfulThoughtAnswer(effectiveAnswer)) {
          throw new Error('处理想法前必须填写有效回答')
        }
        updated = true
        let updatedBlock = replaceRecordField(block, 'status', nextStatus)
        if (suppliedAnswer !== undefined) {
          updatedBlock = replaceSection(updatedBlock, ['回答'], '回答', suppliedAnswer)
        }
        return updatedBlock
      })
      .join('\n')
    if (!updated) throw new Error('未找到想法记录')
    return { content: next.endsWith('\n') ? next : `${next}\n`, value: undefined }
  })
  await refreshRecordSummary(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function updateDialogueStatus(
  managerDataRoot: string,
  projectRoot: string,
  dialogueId: string,
  status: string,
) {
  const target = String(dialogueId || '').trim()
  const nextStatus = String(status || '').trim().toLowerCase()
  if (!target) throw new Error('研究 ID 不能为空')
  if (!['pending', 'doing', 'done', 'archived'].includes(nextStatus)) throw new Error('研究状态不合法')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const dialoguePath = await findVersionRecordPath(dataRoot, VERSION_DIALOGUES_FILE, target, normalizeDialogueShortId)
  if (!dialoguePath) throw new Error('未找到研究记录')
  await mutateProjectFile(dataRoot, dialoguePath, (current) => {
    let updated = false
    const next = splitMarkdownBlocks(current)
      .map((block, index) => {
        if (index === 0 && !block.trim().startsWith('## ')) return block
        const fields = parseFields(block)
        const matches = fields.id === target
          || (normalizeDialogueShortId(target) !== ''
            && normalizeDialogueShortId(fields.short_id) === normalizeDialogueShortId(target))
        if (!matches) return block
        updated = true
        return replaceRecordField(
          replaceRecordField(block, 'status', nextStatus),
          'updated',
          localTime(),
        )
      })
      .join('\n')
    if (!updated) throw new Error('未找到研究记录')
    return { content: next.endsWith('\n') ? next : `${next}\n`, value: undefined }
  })
  await refreshRecordSummary(managerDataRoot, projectRoot)
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
  await refreshRecordSummary(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function deleteDocument(managerDataRoot: string, projectRoot: string, documentTarget: string) {
  const target = String(documentTarget || '').trim()
  if (!target) throw new Error('文档 ID 不能为空')
  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const documents = await listProjectDocuments(dataRoot)
  const shortId = normalizeDocumentShortId(target)
  const note = documents.find((item) => item.path === target || (shortId && item.shortId === shortId))
  if (!note) throw new Error('未找到文档')
  await removeProjectMarkdownFile(dataRoot, note.path, DOCUMENTS_DIR)
  await refreshRecordSummary(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function deleteKnowledge(managerDataRoot: string, projectRoot: string, knowledgeTarget: string) {
  const target = String(knowledgeTarget || '').trim()
  if (!target) throw new Error('知识 ID 不能为空')
  const notes = parseKnowledgeNotes(await listGlobalKnowledgeDocuments(managerDataRoot))
  const shortId = normalizeKnowledgeShortId(target)
  const note = notes.find((item) => item.path === target || item.id === target || (shortId && item.shortId === shortId))
  if (!note) throw new Error('未找到知识条目')
  await removeProjectMarkdownFile(managerDataRoot, note.path, GLOBAL_KNOWLEDGE_DIR)
  await refreshRecordSummary(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

async function deleteVersionRecord(
  managerDataRoot: string,
  projectRoot: string,
  target: string,
  fileName: string,
  emptyMessage: string,
  missingMessage: string,
) {
  const id = String(target || '').trim()
  if (!id) throw new Error(emptyMessage)
  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const recordPath = await findVersionRecordPath(dataRoot, fileName, id)
  if (!recordPath) throw new Error(missingMessage)
  return deleteRecordFromPath(managerDataRoot, projectRoot, id, recordPath, emptyMessage, missingMessage, dataRoot)
}

function readThoughtAnswer(block: string) {
  const match = block.match(/###\s+回答\s+([\s\S]*?)(?=\n### |$)/)
  return match?.[1]?.trim() || ''
}

function isMeaningfulThoughtAnswer(answer: string) {
  const normalized = String(answer || '')
    .trim()
    .toLowerCase()
    .replace(/[。.!！?？\s]+$/g, '')
  return Boolean(normalized) && ![
    '无',
    '暂无',
    '暂无回答',
    '待回答',
    '待处理',
    '待补充',
    'none',
    'n/a',
  ].includes(normalized)
}

function replaceRecordField(block: string, field: string, value: string) {
  const pattern = new RegExp(`^${field}::\\s*.*$`, 'm')
  if (pattern.test(block)) return block.replace(pattern, `${field}:: ${value}`)
  const headingEnd = block.indexOf('\n')
  if (headingEnd < 0) return `${block}\n\n${field}:: ${value}`
  return `${block.slice(0, headingEnd + 1)}\n${field}:: ${value}${block.slice(headingEnd + 1)}`
}

async function deleteRecordFromPath(
  managerDataRoot: string,
  projectRoot: string,
  target: string,
  relativePath: string,
  emptyMessage: string,
  missingMessage: string,
  knownDataRoot?: string,
) {
  const id = String(target || '').trim()
  if (!id) throw new Error(emptyMessage)
  const dataRoot = knownDataRoot || await resolveExistingDataRoot(managerDataRoot, projectRoot)
  await mutateProjectFile(dataRoot, relativePath, (current) => {
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
    if (!deleted) throw new Error(missingMessage)
    return { content: `${next}\n`, value: undefined }
  })
  await refreshRecordSummary(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}
