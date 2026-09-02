import {
  VERSION_QUESTIONS_FILE,
  VERSION_RISKS_FILE,
} from './paths.js'
import {
  normalizeQuestionKind,
  normalizeQuestionShortId,
  normalizeQuestionStatus,
  normalizeRiskShortId,
  parseFields,
  parseProjectQuestions,
  readSection,
} from './parsers.js'
import { questionRecordTemplate } from './record-templates.js'
import type {
  NewQuestionInput,
  OpenQuestionReplyInput,
  ProjectOpenQuestion,
  ProjectQuestionMessage,
  ProjectRisk,
} from './types.js'
import { localTime } from './utils.js'
import { getDashboard, refreshRecordSummary } from './dashboard.js'
import {
  createId,
  insertMarkdownEntry,
  normalizeTitle,
  replaceSection,
  updateMarkdownBlocks,
} from './internal/markdown.js'
import { readProjectConfig, resolveExistingDataRoot } from './internal/project-context.js'
import { allocateShortId, mutateProjectFile } from './internal/storage.js'
import {
  findVersionRecordPath,
  resolveWritableVersionId,
  versionRecordPath,
} from './internal/version-files.js'

export async function appendProjectQuestion(managerDataRoot: string, projectRoot: string, input: NewQuestionInput) {
  const title = normalizeTitle(input?.title || '')
  const question = String(input?.question || '').trim()
  if (!title) throw new Error('问题标题不能为空')
  if (!question) throw new Error('问题内容不能为空')

  const dataRoot = await resolveExistingDataRoot(managerDataRoot, projectRoot)
  const config = await readProjectConfig(managerDataRoot, projectRoot)
  const versionId = await resolveWritableVersionId(dataRoot, input.versionId, config.currentVersionId)
  const questionPath = versionRecordPath(versionId, VERSION_QUESTIONS_FILE)
  await mutateProjectFile(dataRoot, questionPath, async (current) => {
    const questions = parseProjectQuestions(current)
    const now = localTime()
    const shortId = await allocateShortId(dataRoot, 'Q', questions.map((item) => item.shortId))
    const origin = input.origin === 'user' ? 'user' : 'system'
    const status = origin === 'user' ? 'decided' : 'open'
    const role = origin === 'user' ? '用户' : '记录'
    const entry = questionRecordTemplate({
      title,
      id: createId('question', title),
      shortId,
      status,
      kind: normalizeQuestionKind(input.kind),
      scope: input.scope === 'project' ? 'project' : 'version',
      version: versionId,
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
  await refreshRecordSummary(managerDataRoot, projectRoot)
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
  await refreshRecordSummary(managerDataRoot, projectRoot)
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
  await refreshRecordSummary(managerDataRoot, projectRoot)
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
  await refreshRecordSummary(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
}

export async function updateRiskStatus(
  managerDataRoot: string,
  projectRoot: string,
  riskId: string,
  status: ProjectRisk['status'],
) {
  const id = String(riskId || '').trim()
  const nextStatus = ['open', 'resolved', 'expired'].includes(String(status)) ? status : 'open'
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
  await refreshRecordSummary(managerDataRoot, projectRoot)
  return getDashboard(managerDataRoot, projectRoot)
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
  const label = role === 'user' ? '用户' : '记录'
  const existing = readSection(block, ['对话记录'])
  const message = '#### ' + label + ' · ' + created + '\n\n' + String(content || '').trim()
  return replaceSection(block, ['对话记录'], '对话记录', [existing, message].filter(Boolean).join('\n\n'))
}
