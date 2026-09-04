import type {
  ProjectDepthReason,
  ProjectLogLevel,
  ProjectOpenQuestion,
  ProjectRisk,
  ProjectThoughtStatus,
  ProjectWorkLevel,
  ResearchMode,
  ResearchStatus,
  TaskStatus,
} from '../types.js'

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

export function normalizeThoughtStatus(value?: string): ProjectThoughtStatus {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'done' || normalized === 'handled') return 'handled'
  return 'inbox'
}

export function normalizeTaskStatus(value?: string): TaskStatus {
  const normalized = String(value || '').trim().toLowerCase()
  return ['backlog', 'todo', 'doing', 'done', 'abandoned'].includes(normalized)
    ? normalized as TaskStatus
    : 'todo'
}

export function normalizeWorkLevel(value: string | undefined, fallback: ProjectWorkLevel = 'standard'): ProjectWorkLevel {
  const normalized = String(value || '').trim().toLowerCase()
  return ['light', 'standard', 'deep'].includes(normalized)
    ? normalized as ProjectWorkLevel
    : fallback
}

export function normalizeDepthReason(value: string | undefined): ProjectDepthReason | '' {
  const normalized = String(value || '').trim().toLowerCase()
  return ['architecture', 'migration', 'cross_system', 'security', 'irreversible', 'decision'].includes(normalized)
    ? normalized as ProjectDepthReason
    : ''
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

export function normalizeTaskShortId(value: string) {
  const match = String(value || '').trim().match(/^T(\d{1,4})$/i)
  return match ? `T${match[1].padStart(3, '0')}` : ''
}

export function normalizeThoughtShortId(value: string) {
  const match = String(value || '').trim().match(/^I(\d{1,4})$/i)
  return match ? `I${match[1].padStart(3, '0')}` : ''
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
