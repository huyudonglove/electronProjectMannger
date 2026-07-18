import { createHash } from 'node:crypto'
import {
  CONSTRAINTS_PATH,
} from './paths.js'
import type {
  ProjectConstraint,
  ProjectDialogue,
  ProjectLog,
  ProjectLogLevel,
  ProjectOpenQuestion,
  ProjectQuestionMessage,
  ProjectRisk,
  ProjectTask,
  ProjectThought,
  ProjectVersion,
  ResearchMode,
  ResearchStatus,
} from './types.js'

export function normalizeResearchMode(value?: string, fallback: ResearchMode = 'legacy'): ResearchMode {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'breadth' || normalized === 'depth') return normalized
  return fallback
}

export function normalizeResearchStatus(value?: string): ResearchStatus {
  return ['pending', 'doing', 'done', 'archived'].includes(String(value))
    ? value as ResearchStatus
    : 'pending'
}

export function normalizeQuestionShortId(value: string | undefined) {
  const match = String(value || '').trim().match(/^Q(\d{1,4})$/i)
  return match ? `Q${match[1].padStart(3, '0')}` : ''
}

export function normalizeQuestionStatus(value: string | undefined): ProjectOpenQuestion['status'] {
  return ['open', 'decided', 'resolved', 'expired'].includes(String(value))
    ? value as ProjectOpenQuestion['status']
    : 'open'
}

export function normalizeQuestionKind(value: string | undefined): ProjectOpenQuestion['kind'] {
  return ['decision', 'clarification', 'blocker'].includes(String(value))
    ? value as ProjectOpenQuestion['kind']
    : 'decision'
}

export function normalizeRiskShortId(value: string | undefined) {
  const match = String(value || '').trim().match(/^R(\d{1,4})$/i)
  return match ? `R${match[1].padStart(3, '0')}` : ''
}

export function normalizeRiskKind(value: string | undefined): ProjectRisk['kind'] {
  return ['risk', 'verification', 'follow-up'].includes(String(value))
    ? value as ProjectRisk['kind']
    : 'risk'
}

export function normalizeConstraintStatus(value: string) {
  return ['active', 'draft', 'archived', 'readonly'].includes(value) ? value : 'active'
}

export function parseDisplayTimeKey(value: string) {
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

export function compareShortIdDesc(a: string | undefined, b: string | undefined, prefix: string) {
  const left = shortIdNumber(a, prefix)
  const right = shortIdNumber(b, prefix)
  if (left !== right) return right - left
  return String(b || '').localeCompare(String(a || ''))
}

export function shortIdNumber(value: string | undefined, prefix: string) {
  const match = String(value || '').trim().match(new RegExp(`^${prefix}(\\d+)$`, 'i'))
  return match ? Number(match[1]) : 0
}

export function firstContentSummary(content: string) {
  const text = stripFencedCode(content)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^#+\s+/.test(line) && !/^[A-Za-z0-9_-]+::\s*/.test(line) && !/^>/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, 120)
}

export function stripFencedCode(content: string) {
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

export function questionMessageMarkdown(role: ProjectQuestionMessage['role'], created: string, content: string) {
  const label = role === 'user' ? '用户' : role === 'agent' ? 'Agent' : '历史记录'
  const normalized = String(content || '').trim().replace(/^####\s+/gm, '##### ')
  return `#### ${label} · ${created}\n\n${normalized}`
}

export function isQuestionConclusionMessage(value: string) {
  const normalized = String(value || '').trim()
  return Boolean(normalized)
    && !['待确认。', '待确认', '待用户回复。', '待用户回复', '待 Agent 跟进。', '待 Agent 跟进'].includes(normalized)
}

export function parseQuestionMessages(content: string): ProjectQuestionMessage[] {
  const section = readSection(content, ['对话记录'])
  const pattern = /^####\s+(用户|Agent|历史记录)\s+·\s+(.+)\n+([\s\S]*?)(?=^####\s+|$)/gm
  const messages: ProjectQuestionMessage[] = []
  let match: RegExpExecArray | null

  while ((match = pattern.exec(section))) {
    const role = match[1] === '用户' ? 'user' : match[1] === 'Agent' ? 'agent' : 'system'
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
        origin: fields.origin === 'user' ? 'user' as const : 'agent' as const,
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

export function parseProjectTasks(content: string): ProjectTask[] {
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
      }
    })
}

export function parseThoughts(content: string): ProjectThought[] {
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
      }
    })
}

export function parseUserConstraints(content: string): ProjectConstraint[] {
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

export function parseDialogues(content: string): ProjectDialogue[] {
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
        updated: fields.updated || fields.created || '',
        version: normalizeVersionId(fields.version),
        status: normalizeResearchStatus(fields.status),
        mode: normalizeResearchMode(fields.mode),
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

export function dialogueSortKey(dialogue: Pick<ProjectDialogue, 'created' | 'title' | 'shortId'>) {
  return [
    parseDisplayTimeKey(dialogue.created || dialogue.title),
    dialogue.shortId,
  ].join('\u0000')
}

export function parseProjectLogs(content: string, tasks: ProjectTask[] = []): ProjectLog[] {
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
        recordLevel: normalizeLogLevel(fields.record_level),
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
        acceptanceResult: readSection(block, ['验收结果']),
        risks: readListSection(block, ['已知风险']),
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

export function logTaskRefs(_block: string, fields: Record<string, string>) {
  const explicitRefs = [
    fields.task_short_id,
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/[,，\s]+/))
  const refs = [...new Set(explicitRefs.map(normalizeTaskShortId).filter(Boolean))]
  return refs.length ? refs : ['T000']
}

export function normalizeTaskShortId(value: string) {
  const match = String(value || '').trim().match(/^T(\d{1,4})$/i)
  return match ? `T${match[1].padStart(3, '0')}` : ''
}

export function normalizeLogShortId(value: string) {
  const match = String(value || '').trim().match(/^L(\d{1,4})$/i)
  return match ? `L${match[1].padStart(3, '0')}` : ''
}

export function normalizeLogLevel(value: string | undefined): ProjectLogLevel {
  return ['light', 'standard', 'deep'].includes(String(value || '').trim().toLowerCase())
    ? String(value).trim().toLowerCase() as ProjectLogLevel
    : 'standard'
}

export function normalizeDialogueShortId(value: string) {
  const match = String(value || '').trim().match(/^D(\d{1,4})$/i)
  return match ? `D${match[1].padStart(3, '0')}` : ''
}

export function normalizeConstraintShortId(value: string) {
  const match = String(value || '').trim().match(/^C(\d{1,4})$/i)
  return match ? `C${match[1].padStart(3, '0')}` : ''
}

export function normalizeVersionId(value: string | undefined) {
  const match = String(value || '').trim().match(/^V(\d{1,4})$/i)
  return match ? `V${match[1].padStart(3, '0')}` : ''
}

export function recordInVersion(recordVersion: string | undefined, versionId: string) {
  return normalizeVersionId(recordVersion) === normalizeVersionId(versionId)
}

export function splitRefs(value: string) {
  return String(value || '')
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter((item) => item && !/^(?:无|暂无|没有|none|n\/a)[。.!！]?$/i.test(item))
}

export function projectLogSortKey(block: string, created: string, order: number) {
  const title = block.match(/^##\s+(.+)$/m)?.[1] || ''
  const titleTime = title.match(/(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/)
  const date = titleTime?.[1] || created.slice(0, 10) || '0000-00-00'
  const time = titleTime?.[2] || created.match(/\d{2}:\d{2}/)?.[0] || '00:00'
  const reverseOrder = 999999 - order
  return `${date} ${time} ${String(reverseOrder).padStart(6, '0')}`
}

export function parseFields(block: string) {
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

export function readSection(content: string, titles: string[]) {
  const escaped = titles.map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const match = content.match(new RegExp(`###\\s+(?:${escaped})\\s+([\\s\\S]*?)(?=\\n### |$)`))
  return (match?.[1] || '').trim()
}

export function readListSection(content: string, titles: string[]) {
  return listSectionItems(readSection(content, titles))
}

export function listSectionItems(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim().replace(/^[-*]\s+/, ''))
    .filter((line) => line && !/^(?:无|暂无|没有|none|n\/a)[。.!！]?$/i.test(line))
}

export function splitMarkdownBlocks(content: string) {
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

export function isRecordHeading(lines: string[], headingIndex: number) {
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
