import { createHash } from 'node:crypto'
import type {
  ProjectOpenQuestion,
  ProjectQuestionMessage,
  ProjectRisk,
  ProjectVersion,
} from '../types.js'
import {
  parseFields,
  readListSection,
  readSection,
  splitMarkdownBlocks,
} from './markdown.js'
import {
  compareShortIdDesc,
  normalizeQuestionKind,
  normalizeQuestionShortId,
  normalizeQuestionStatus,
  normalizeRiskKind,
  normalizeRiskShortId,
  normalizeVersionId,
  splitRefs,
} from './normalizers.js'

export function questionMessageMarkdown(role: ProjectQuestionMessage['role'], created: string, content: string) {
  const label = role === 'user' ? '用户' : '记录'
  const normalized = String(content || '').trim().replace(/^####\s+/gm, '##### ')
  return `#### ${label} · ${created}\n\n${normalized}`
}

export function isQuestionConclusionMessage(value: string) {
  const normalized = String(value || '').trim()
  return Boolean(normalized)
    && !['待确认。', '待确认', '待用户回复。', '待用户回复', '待跟进。', '待跟进'].includes(normalized)
}

export function parseQuestionMessages(content: string): ProjectQuestionMessage[] {
  const section = readSection(content, ['对话记录'])
  const pattern = /^####\s+(用户|记录|Agent|历史记录)\s+·\s+(.+)\n+([\s\S]*?)(?=^####\s+|$)/gm
  const messages: ProjectQuestionMessage[] = []
  let match: RegExpExecArray | null

  while ((match = pattern.exec(section))) {
    const role = match[1] === '用户' ? 'user' : 'system'
    const created = match[2].trim()
    const messageContent = match[3].trim()
    if (!messageContent) continue
    messages.push({
      id: `${role}-${created}-${messages.length + 1}`,
      role,
      created,
      content: messageContent,
    })
  }

  return messages
}

export function parseProjectVersions(content: string): ProjectVersion[] {
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
        status: normalizeProjectVersionStatus(fields.status),
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

function normalizeProjectVersionStatus(value: string | undefined): ProjectVersion['status'] {
  return ['planned', 'active', 'paused', 'completed'].includes(String(value))
    ? value as ProjectVersion['status']
    : 'active'
}

export function parseProjectQuestions(content: string): ProjectOpenQuestion[] {
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
        origin: fields.origin === 'user' ? 'user' as const : 'system' as const,
        messages: parseQuestionMessages(block),
      }
    })
    .sort((a, b) => compareShortIdDesc(a.shortId, b.shortId, 'Q'))
}

export function parseProjectRisks(content: string): ProjectRisk[] {
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
