import {
  CONSTRAINTS_PATH,
  VERSIONS_PATH,
  VERSION_DIALOGUES_FILE,
  VERSION_QUESTIONS_FILE,
  VERSION_TASKS_FILE,
  VERSION_THOUGHTS_FILE,
} from './paths.js'
import {
  normalizeConstraintShortId,
  normalizeDialogueShortId,
  normalizeQuestionShortId,
  normalizeResearchMode,
  normalizeTaskShortId,
  normalizeThoughtShortId,
  normalizeThoughtStatus,
  normalizeVersionId,
  parseFields,
  parseProjectVersions,
  readSection,
} from './parsers.js'
import type {
  ProjectRecordKind,
  UpdateConstraintRecordPatch,
  UpdateProjectRecordPatchMap,
  UpdateQuestionRecordPatch,
  UpdateResearchRecordPatch,
  UpdateTaskRecordPatch,
  UpdateThoughtRecordPatch,
  UpdateVersionRecordPatch,
} from './types.js'
import { localTime } from './utils.js'
import { getDashboard, refreshRecordSummary } from './dashboard.js'
import {
  normalizeTitle,
  researchModeReference,
  replaceSection,
  updateMarkdownBlocks,
} from './internal/markdown.js'
import { resolveExistingDataRoot } from './internal/project-context.js'
import { mutateProjectFile, readProjectFile } from './internal/storage.js'
import { findVersionRecordPath } from './internal/version-files.js'
import { isMeaningfulThoughtAnswer } from './internal/record-validation.js'

type ShortIdNormalizer = (value: string) => string

const EDITABLE_FIELDS: Record<ProjectRecordKind, readonly string[]> = {
  task: ['title', 'priority', 'workLevel', 'depthReason', 'area', 'userOriginal', 'executionDefinition', 'acceptance', 'constraints', 'planRollback'],
  thought: ['content', 'answer'],
  research: ['content', 'answer', 'acceptance', 'mode', 'tags', 'relatedTasks', 'relatedThoughts', 'relatedDocuments'],
  constraint: ['title', 'content', 'status', 'scope'],
  version: ['label', 'title', 'goal', 'summary', 'outcomes', 'followUps'],
  question: ['title', 'question', 'background', 'recommendation', 'kind', 'scope', 'blocking', 'relations'],
}

export async function updateProjectRecord<K extends ProjectRecordKind>(
  managerDataRoot: string,
  projectRoot: string,
  kind: K,
  target: string,
  patch: UpdateProjectRecordPatchMap[K],
) {
  const normalizedTarget = String(target || '').trim()
  if (!normalizedTarget) throw new Error('记录 ID 不能为空')
  assertPatch(kind, patch)

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  switch (kind) {
    case 'task':
      await updateVersionRecord(dataRoot, VERSION_TASKS_FILE, normalizedTarget, normalizeTaskShortId, '任务', (block) =>
        updateTaskBlock(block, patch as UpdateTaskRecordPatch))
      break
    case 'thought':
      await updateVersionRecord(dataRoot, VERSION_THOUGHTS_FILE, normalizedTarget, normalizeThoughtShortId, '想法', (block) =>
        updateThoughtBlock(block, patch as UpdateThoughtRecordPatch))
      break
    case 'research':
      await updateVersionRecord(dataRoot, VERSION_DIALOGUES_FILE, normalizedTarget, normalizeDialogueShortId, '研究', (block) =>
        updateResearchBlock(block, patch as UpdateResearchRecordPatch))
      break
    case 'constraint':
      await updateConstraintRecord(dataRoot, normalizedTarget, patch as UpdateConstraintRecordPatch)
      break
    case 'version':
      await updateVersionMetadata(dataRoot, normalizedTarget, patch as UpdateVersionRecordPatch)
      break
    case 'question':
      await updateVersionRecord(dataRoot, VERSION_QUESTIONS_FILE, normalizedTarget, normalizeQuestionShortId, '问题', (block) =>
        updateQuestionBlock(block, patch as UpdateQuestionRecordPatch))
      break
    default:
      throw new Error(`不支持的记录类型：${String(kind)}`)
  }

  await refreshRecordSummary(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

async function updateVersionRecord(
  dataRoot: string,
  fileName: string,
  target: string,
  normalizeShortId: ShortIdNormalizer,
  label: string,
  update: (block: string) => string,
) {
  const recordPath = await findVersionRecordPath(dataRoot, fileName, target, normalizeShortId)
  if (!recordPath) throw new Error(`未找到${label}记录`)
  await assertWritableRecordPath(dataRoot, recordPath)
  await mutateRecordBlock(dataRoot, recordPath, target, normalizeShortId, label, update)
}

async function updateConstraintRecord(dataRoot: string, target: string, patch: UpdateConstraintRecordPatch) {
  if (target.toLowerCase() === 'system-data-spec' || /^SYS-/i.test(target)) throw new Error('系统约束为只读，不能编辑')

  const current = await readProjectFile(dataRoot, CONSTRAINTS_PATH)
  const block = findRecordBlock(current, target, normalizeConstraintShortId)
  if (!block) throw new Error('未找到约束记录')
  const fields = parseFields(block)
  if (fields.scope === 'system' || fields.status === 'readonly') throw new Error('系统约束为只读，不能编辑')
  await mutateRecordBlock(dataRoot, CONSTRAINTS_PATH, target, normalizeConstraintShortId, '约束', (record) =>
    updateConstraintBlock(record, patch))
}

async function updateVersionMetadata(dataRoot: string, target: string, patch: UpdateVersionRecordPatch) {
  const current = await readProjectFile(dataRoot, VERSIONS_PATH)
  const block = findRecordBlock(current, target, normalizeVersionId)
  if (!block) throw new Error('未找到版本记录')
  await mutateRecordBlock(dataRoot, VERSIONS_PATH, target, normalizeVersionId, '版本', (record) =>
    updateVersionBlock(record, patch))
}

async function mutateRecordBlock(
  dataRoot: string,
  relativePath: string,
  target: string,
  normalizeShortId: ShortIdNormalizer,
  label: string,
  update: (block: string) => string,
) {
  await mutateProjectFile(dataRoot, relativePath, (current) => {
    let handled = false
    const content = updateMarkdownBlocks(current, (block) => {
      if (!matchesRecord(block, target, normalizeShortId)) return block
      handled = true
      return update(block)
    })
    if (!handled) throw new Error(`未找到${label}记录`)
    return { content, value: undefined }
  })
}

async function assertWritableRecordPath(dataRoot: string, relativePath: string) {
  const versionId = relativePath.replaceAll('\\', '/').match(/^versions\/(V\d+)\//)?.[1] || ''
  await assertWritableVersion(dataRoot, versionId)
}

async function assertWritableVersion(dataRoot: string, versionTarget: string) {
  const versionId = normalizeVersionId(versionTarget)
  if (!versionId) throw new Error('记录缺少有效版本，不能编辑')
  const versions = parseProjectVersions(await readProjectFile(dataRoot, VERSIONS_PATH))
  const version = versions.find((item) => item.shortId === versionId)
  if (!version) throw new Error(`未找到版本：${versionId}`)
  if (version.status === 'completed') throw new Error(`版本 ${versionId} 已完成，默认禁止编辑记录`)
}

function updateTaskBlock(block: string, patch: UpdateTaskRecordPatch) {
  let next = block
  if (patch.title !== undefined) next = replaceHeading(next, requiredTitle(patch.title, '任务标题'))
  if (patch.priority !== undefined) next = replaceField(next, 'priority', requiredText(patch.priority, '任务优先级'))
  if (patch.workLevel !== undefined) {
    if (!['light', 'standard', 'deep'].includes(patch.workLevel)) throw new Error('任务工作级别不合法')
    next = replaceField(next, 'work_level', patch.workLevel)
  }
  if (patch.depthReason !== undefined) {
    if (patch.depthReason && !['architecture', 'migration', 'cross_system', 'security', 'irreversible', 'decision'].includes(patch.depthReason)) {
      throw new Error('深度任务原因不合法')
    }
    next = patch.depthReason
      ? replaceField(next, 'depth_reason', patch.depthReason)
      : removeField(next, 'depth_reason')
  }
  if (patch.area !== undefined) next = replaceField(next, 'area', requiredText(patch.area, '任务领域'))
  if (patch.userOriginal !== undefined) next = replaceSection(next, ['用户原话'], '用户原话', requiredText(patch.userOriginal, '用户原话'))
  if (patch.executionDefinition !== undefined) next = replaceSection(next, ['执行定义'], '执行定义', requiredText(patch.executionDefinition, '执行定义'))
  if (patch.acceptance !== undefined) next = replaceSection(next, ['验收'], '验收', requiredText(patch.acceptance, '验收标准'))
  if (patch.constraints !== undefined) next = replaceSection(next, ['关键约束'], '关键约束', String(patch.constraints).trim())
  if (patch.planRollback !== undefined) next = replaceSection(next, ['方案与回退'], '方案与回退', String(patch.planRollback).trim())

  const fields = parseFields(next)
  if (fields.work_level === 'deep') {
    if (!fields.depth_reason) throw new Error('深度任务必须说明深度原因')
    if (!readSection(next, ['关键约束']).trim()) throw new Error('深度任务必须填写关键约束')
    if (!readSection(next, ['方案与回退']).trim()) throw new Error('深度任务必须填写方案与回退')
  }
  return touchUpdated(next)
}

function updateThoughtBlock(block: string, patch: UpdateThoughtRecordPatch) {
  let next = block
  if (patch.content !== undefined) next = replaceSection(next, ['内容'], '内容', requiredText(patch.content, '想法内容'))
  if (patch.answer !== undefined) next = replaceSection(next, ['回答'], '回答', String(patch.answer).trim())
  if (normalizeThoughtStatus(parseFields(next).status) === 'handled' && !isMeaningfulThoughtAnswer(readSection(next, ['回答']))) {
    throw new Error('已处理想法必须保留有效回答')
  }
  return next
}

function updateResearchBlock(block: string, patch: UpdateResearchRecordPatch) {
  let next = block
  if (patch.content !== undefined) next = replaceSection(next, ['内容'], '内容', requiredText(patch.content, '研究内容'))
  if (patch.answer !== undefined) next = replaceSection(next, ['回答'], '回答', String(patch.answer).trim())
  if (patch.mode !== undefined) {
    if (!['breadth', 'depth'].includes(patch.mode)) throw new Error('研究模式不合法')
    next = replaceField(next, 'mode', patch.mode)
  }
  if (patch.acceptance !== undefined) {
    const acceptance = String(patch.acceptance).trim()
      || researchModeReference(normalizeResearchMode(parseFields(next).mode, 'breadth'))
    next = replaceSection(next, ['验收标准'], '验收标准', acceptance)
  }
  if (patch.tags !== undefined) next = replaceField(next, 'tags', refsValue(patch.tags, '研究标签'))
  if (patch.relatedTasks !== undefined) next = replaceField(next, 'related_tasks', refsValue(patch.relatedTasks, '关联任务'))
  if (patch.relatedThoughts !== undefined) next = replaceField(next, 'related_thoughts', refsValue(patch.relatedThoughts, '关联想法'))
  if (patch.relatedDocuments !== undefined) next = replaceField(next, 'related_documents', refsValue(patch.relatedDocuments, '关联文档'))
  return touchUpdated(next)
}

function updateConstraintBlock(block: string, patch: UpdateConstraintRecordPatch) {
  let next = block
  if (patch.title !== undefined) next = replaceHeading(next, requiredTitle(patch.title, '约束标题'))
  if (patch.content !== undefined) next = replaceSection(next, ['内容'], '内容', requiredText(patch.content, '约束内容'))
  if (patch.status !== undefined) {
    if (!['active', 'draft', 'archived'].includes(patch.status)) throw new Error('约束状态不合法')
    next = replaceField(next, 'status', patch.status)
  }
  if (patch.scope !== undefined) {
    if (!['project', 'version'].includes(patch.scope)) throw new Error('约束范围不合法')
    next = replaceField(next, 'scope', patch.scope)
  }
  return touchUpdated(next)
}

function updateVersionBlock(block: string, patch: UpdateVersionRecordPatch) {
  let next = block
  if (patch.label !== undefined) next = replaceField(next, 'label', requiredText(patch.label, '版本名称'))
  if (patch.title !== undefined) next = replaceHeading(next, requiredTitle(patch.title, '版本标题'))
  if (patch.goal !== undefined) next = replaceSection(next, ['版本目标'], '版本目标', requiredText(patch.goal, '版本目标'))
  if (patch.summary !== undefined) next = replaceSection(next, ['内容描述', '版本总结'], '内容描述', String(patch.summary).trim())
  if (patch.outcomes !== undefined) next = replaceSection(next, ['主要成果'], '主要成果', listValue(patch.outcomes, '主要成果'))
  if (patch.followUps !== undefined) next = replaceSection(next, ['遗留事项'], '遗留事项', listValue(patch.followUps, '遗留事项'))
  return next
}

function updateQuestionBlock(block: string, patch: UpdateQuestionRecordPatch) {
  let next = block
  if (patch.title !== undefined) next = replaceHeading(next, requiredTitle(patch.title, '问题标题'))
  if (patch.question !== undefined) {
    const previousQuestion = readSection(next, ['问题'])
    const correctedQuestion = requiredText(patch.question, '问题内容')
    next = replaceSection(next, ['问题'], '问题', correctedQuestion)
    next = updateInitialQuestionMirror(next, previousQuestion, correctedQuestion)
  }
  if (patch.background !== undefined) next = replaceSection(next, ['背景'], '背景', String(patch.background).trim())
  if (patch.recommendation !== undefined) next = replaceSection(next, ['建议'], '建议', String(patch.recommendation).trim())
  if (patch.kind !== undefined) {
    if (!['decision', 'clarification', 'blocker'].includes(patch.kind)) throw new Error('问题类型不合法')
    next = replaceField(next, 'kind', patch.kind)
  }
  if (patch.scope !== undefined) {
    if (!['version', 'project'].includes(patch.scope)) throw new Error('问题范围不合法')
    next = replaceField(next, 'scope', patch.scope)
  }
  if (patch.blocking !== undefined) next = replaceField(next, 'blocking', patch.blocking ? 'yes' : 'no')
  if (patch.relations !== undefined) next = replaceField(next, 'source_refs', refsValue(patch.relations, '问题关联记录'))
  return touchUpdated(next)
}

function updateInitialQuestionMirror(block: string, previousQuestion: string, correctedQuestion: string) {
  const history = readSection(block, ['对话记录'])
  const firstMessagePattern = /^(####\s+[^\n]+\n+)([\s\S]*?)(?=\n+####\s+|$)/
  const firstMessage = history.match(firstMessagePattern)
  if (!firstMessage || firstMessage[2].trim() !== previousQuestion.trim()) return block
  const updatedHistory = history.replace(firstMessagePattern, (_match, heading: string) => `${heading}${correctedQuestion}`)
  return replaceSection(block, ['对话记录'], '对话记录', updatedHistory)
}

function findRecordBlock(content: string, target: string, normalizeShortId: ShortIdNormalizer) {
  let found = ''
  updateMarkdownBlocks(content, (block) => {
    if (!found && matchesRecord(block, target, normalizeShortId)) found = block
    return block
  })
  return found
}

function matchesRecord(block: string, target: string, normalizeShortId: ShortIdNormalizer) {
  const fields = parseFields(block)
  if (fields.id === target) return true
  const normalizedTarget = normalizeShortId(target)
  return Boolean(normalizedTarget) && normalizeShortId(fields.short_id) === normalizedTarget
}

function assertPatch(kind: ProjectRecordKind, patch: unknown): asserts patch is Record<string, unknown> {
  const editableFields = EDITABLE_FIELDS[kind]
  if (!editableFields) throw new Error(`不支持的记录类型：${String(kind)}`)
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('编辑内容不能为空')
  const keys = Object.keys(patch)
  if (keys.length === 0) throw new Error('至少需要修改一个字段')
  const unsupported = keys.filter((key) => !editableFields.includes(key))
  if (unsupported.length) throw new Error(`${kind} 不支持编辑字段：${unsupported.join(', ')}`)
}

function replaceHeading(block: string, title: string) {
  return block.replace(/^##\s+.+$/m, `## ${title}`)
}

function replaceField(block: string, field: string, value: string) {
  const pattern = new RegExp(`^${field}::\\s*.*$`, 'm')
  if (pattern.test(block)) return block.replace(pattern, `${field}:: ${value}`)
  const headingEnd = block.indexOf('\n')
  if (headingEnd < 0) return `${block}\n\n${field}:: ${value}`
  return `${block.slice(0, headingEnd + 1)}\n${field}:: ${value}${block.slice(headingEnd + 1)}`
}

function removeField(block: string, field: string) {
  return block.replace(new RegExp(`^${field}::\\s*.*\\n?`, 'm'), '')
}

function touchUpdated(block: string) {
  return /^updated::\s*.*$/m.test(block)
    ? block.replace(/^updated::\s*.*$/m, `updated:: ${localTime()}`)
    : block
}

function requiredTitle(value: string, label: string) {
  const normalized = normalizeTitle(String(value || ''))
  if (!normalized) throw new Error(`${label}不能为空`)
  return normalized
}

function requiredText(value: string, label: string) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(`${label}不能为空`)
  return normalized
}

function refsValue(values: string[], label: string) {
  if (!Array.isArray(values)) throw new Error(`${label}必须是列表`)
  const normalized = [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))]
  return normalized.join(', ') || '无'
}

function listValue(values: string[], label: string) {
  if (!Array.isArray(values)) throw new Error(`${label}必须是列表`)
  const normalized = values.map((item) => String(item || '').trim()).filter(Boolean)
  return normalized.length ? normalized.map((item) => `- ${item}`).join('\n') : '- 无。'
}
