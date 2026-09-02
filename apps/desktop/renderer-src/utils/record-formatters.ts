export type AnyRecord = Record<string, any>

export function dialogueDisplayTitle(dialogue: AnyRecord) {
  return firstMeaningfulLine(dialogue.recordContent || dialogue.answer || dialogue.title || '') || dialogueTitle(dialogue)
}

export function dialogueTitle(dialogue: AnyRecord) {
  return String(dialogue.title || '').replace(/^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2})?\s*/, '').trim() || '研究'
}

export function knowledgeDisplayTitle(note: AnyRecord) {
  return knowledgeFocusHeading(note.content) || knowledgeSummaryHeadline(note.summary, note.title) || note.title
}

export function knowledgeFocusHeading(content: string) {
  const genericHeadings = new Set(['项目', '概览', '总览', '背景', '目标', '目录', '说明', '正文', '知识结构'])
  const headings = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^#{2,3}\s+(.+)$/)?.[1]?.trim())
    .filter(Boolean) as string[]
  return headings.find((heading) => !genericHeadings.has(heading)) || ''
}

export function knowledgeSummaryHeadline(summary: string, fallbackTitle: string) {
  const text = String(summary || '').trim()
  if (!text || text === fallbackTitle || /^[-*]\s+/.test(text)) return ''
  return text.split(/[。.!！\n]/).map((item) => item.trim()).find(Boolean) || ''
}

export function knowledgeDisplaySummary(note: AnyRecord, displayTitle: string) {
  const summary = String(note.summary || '').trim()
  if (isUsefulKnowledgeSummary(summary, note.title)) return summary
  return knowledgeSectionSummary(note.content, displayTitle) || summary || '暂无摘要。'
}

export function isUsefulKnowledgeSummary(summary: string, title: string) {
  if (!summary || summary === title) return false
  if (/^- 名称[:：]/.test(summary)) return false
  if (/数据层[:：]/.test(summary) && summary.length < 80) return false
  return true
}

export function knowledgeSectionSummary(content: string, heading: string) {
  if (!heading) return ''
  const lines = String(content || '').split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === `## ${heading}` || line.trim() === `### ${heading}`)
  if (start < 0) return ''
  const sectionLines = []
  for (const line of lines.slice(start + 1)) {
    if (/^#{2,3}\s+/.test(line.trim())) break
    const normalized = line.trim().replace(/^[-*]\s+/, '')
    if (normalized) sectionLines.push(normalized)
    if (sectionLines.length >= 3) break
  }
  return sectionLines.join(' ')
}

export function documentDisplayTitle(note: AnyRecord) {
  return note.title || note.path?.split(/[\\/]/).pop()?.replace(/\.md$/, '') || '未命名文档'
}

export function noteCardSummary(note: AnyRecord, kind: 'knowledge' | 'document') {
  const title = kind === 'knowledge' ? knowledgeDisplayTitle(note) : documentDisplayTitle(note)
  const summary = kind === 'knowledge'
    ? knowledgeDisplaySummary(note, title)
    : String(note.summary || firstMeaningfulLine(note.content || '') || '').trim()
  const text = summary || firstMeaningfulLine(note.content || '') || '暂无摘要。'
  return text.length > 96 ? `${text.slice(0, 96).trimEnd()}...` : text
}

export function noteOriginProject(
  note: AnyRecord,
  kind: 'knowledge' | 'document',
  currentProjectName = '',
  projectRoot = '',
) {
  if (kind === 'document') return currentProjectName || projectDisplayName(projectRoot) || '当前项目'
  const fields = noteFields(note)
  const project = note.sourceProject || fields.source_project || fields.sourceProject || fields.project || fields.project_name || fields.projectName
  return validRefs([project])[0] || '未标注项目'
}

export function noteFields(note: AnyRecord) {
  const fields: Record<string, string> = {}
  String(note.content || '').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^([A-Za-z0-9_-]+)::\s*(.+)$/)
    if (match) fields[match[1]] = match[2].trim()
  })
  return fields
}

export function validRefs(refs = [] as any[]) {
  const seen = new Set()
  return refs
    .map((ref) => String(ref || '').trim())
    .filter((ref) => ref && !/^(?:无|暂无|没有|none|n\/a)[。.!！]?$/i.test(ref))
    .filter((ref) => {
      const key = ref.toUpperCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export function firstMeaningfulLine(value: string) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/^```/.test(line) && !/^#{1,6}\s+/.test(line) && !/^[-*]\s+/.test(line) && !/^[A-Za-z0-9_-]+::\s*/.test(line))
    || ''
}

export function noteCategory(filePath: string) {
  if (filePath.startsWith('tasks/')) return '任务'
  if (filePath.startsWith('thoughts/')) return '想法'
  if (filePath.startsWith('research/')) return '研究'
  if (filePath.startsWith('collaboration/')) return '协作'
  if (filePath.startsWith('work-logs/')) return '工作记录'
  if (filePath.startsWith('documents/')) return '文档'
  if (filePath.startsWith('constraints/')) return '约束'
  if (filePath.startsWith('knowledge/')) return '知识库'
  return '文档'
}

export function constraintStatusText(status: string) {
  return ({
    active: '生效中',
    draft: '草稿',
    archived: '已归档',
    readonly: '只读',
  } as Record<string, string>)[status] || status || '生效中'
}

export function constraintSummary(constraint: AnyRecord) {
  const text = String(constraint.summary || firstMeaningfulLine(constraint.content || '') || '').replace(/\s+/g, ' ').trim()
  return text.length > 120 ? `${text.slice(0, 120).trimEnd()}...` : text || '暂无摘要。'
}

export function sortRecentProjects(projects = [] as AnyRecord[]) {
  return projects.slice().sort((a, b) => String(b.lastOpenedAt || b.createdAt || '').localeCompare(String(a.lastOpenedAt || a.createdAt || '')))
}

export function projectDisplayName(projectRoot: string) {
  return String(projectRoot || '').split(/[\\/]/).filter(Boolean).at(-1) || projectRoot
}

export function formatTime(value: string) {
  if (!value) return '未知时间'
  const date = parseDisplayDate(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function parseDisplayDate(value: any) {
  if (value instanceof Date) return value
  const text = String(value || '').trim()
  const localMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/)
  if (localMatch && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
    return new Date(Number(localMatch[1]), Number(localMatch[2]) - 1, Number(localMatch[3]), Number(localMatch[4] || 0), Number(localMatch[5] || 0))
  }
  return new Date(text)
}

export function clampLogIndex(index: number, items = [] as AnyRecord[]) {
  if (!items.length) return 0
  if (!Number.isFinite(index)) return 0
  return Math.min(Math.max(index, 0), items.length - 1)
}
