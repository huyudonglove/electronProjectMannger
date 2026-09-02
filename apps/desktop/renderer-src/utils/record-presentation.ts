import type {
  ProjectDepthReason,
  ProjectLogLevel,
  ProjectWorkLevel,
} from '@telance-records/project-core'

export { formatTime, parseDisplayDate } from './record-formatters'

export type UiTone = 'neutral' | 'complete' | 'warning' | 'danger'

export type RecordPresentationIcon =
  | 'alertTriangle'
  | 'circleCheck'
  | 'circleDot'
  | 'circleX'
  | 'clock'
  | 'layers'
  | 'search'

export type StatusLabelDomain = 'record' | 'research'
export type TaskPriority = 'low' | 'medium' | 'high'

export type StatusPresentation = Readonly<{
  label: string
  tone: UiTone
  icon: RecordPresentationIcon
}>

export type LabelIconPresentation = Readonly<{
  label: string
  icon: RecordPresentationIcon
}>

export type StatusPresentationOptions = Readonly<{
  domain?: StatusLabelDomain
  labelOverride?: string
}>

const recordStatusLabels: Readonly<Record<string, string>> = {
  backlog: '待规划',
  todo: 'Todo',
  doing: 'Doing',
  done: 'Done',
  abandoned: '已放弃',
  inbox: 'Inbox',
  handled: 'Done',
  pending: '待研究',
  archived: '已归档',
}

const researchStatusLabels: Readonly<Record<string, string>> = {
  pending: '待研究',
  doing: '进行中',
  done: '已完成',
  archived: '已归档',
}

const priorityLabels: Readonly<Record<TaskPriority, string>> = {
  high: '高优先级',
  medium: '普通',
  low: '低优先级',
}

const workLevelLabels: Readonly<Record<ProjectWorkLevel, string>> = {
  light: '轻量',
  standard: '标准',
  deep: '深度',
}

const depthReasonLabels: Readonly<Record<ProjectDepthReason, string>> = {
  architecture: '架构',
  migration: '迁移',
  cross_system: '跨系统',
  security: '权限安全',
  irreversible: '不可逆',
  decision: '方案取舍',
}

export function statusLabel(
  status: string | null | undefined,
  domain: StatusLabelDomain = 'record',
  labelOverride?: string,
) {
  if (labelOverride !== undefined) return labelOverride
  const value = normalizeValue(status)
  if (domain === 'research') return researchStatusLabels[value] || '待研究'
  return recordStatusLabels[value] || value || 'Todo'
}

export function statusTone(status: string | null | undefined): UiTone {
  const value = normalizeValue(status)
  if (['done', 'handled', 'resolved'].includes(value)) return 'complete'
  if (['doing', 'pending'].includes(value)) return 'warning'
  if (['abandoned', 'failed', 'blocked'].includes(value)) return 'danger'
  return 'neutral'
}

export function statusIcon(status: string | null | undefined): RecordPresentationIcon {
  const tone = statusTone(status)
  if (tone === 'complete') return 'circleCheck'
  if (tone === 'warning') return 'clock'
  if (tone === 'danger') return 'circleX'
  return 'circleDot'
}

export function statusPresentation(
  status: string | null | undefined,
  options: StatusPresentationOptions = {},
): StatusPresentation {
  return {
    label: statusLabel(status, options.domain, options.labelOverride),
    tone: statusTone(status),
    icon: statusIcon(status),
  }
}

export function priorityLabel(priority: string | null | undefined, labelOverride?: string) {
  if (labelOverride !== undefined) return labelOverride
  const value = normalizeValue(priority) as TaskPriority
  return priorityLabels[value] || priorityLabels.medium
}

export function priorityTone(priority: string | null | undefined): UiTone {
  const value = normalizeValue(priority)
  if (value === 'high') return 'danger'
  if (value === 'medium') return 'warning'
  return 'neutral'
}

export function priorityIcon(priority: string | null | undefined): RecordPresentationIcon {
  return normalizeValue(priority) === 'high' ? 'alertTriangle' : 'circleDot'
}

export function priorityPresentation(
  priority: string | null | undefined,
  labelOverride?: string,
): StatusPresentation {
  return {
    label: priorityLabel(priority, labelOverride),
    tone: priorityTone(priority),
    icon: priorityIcon(priority),
  }
}

export function depthReasonLabel(reason: ProjectDepthReason | string | null | undefined) {
  return depthReasonLabels[normalizeValue(reason) as ProjectDepthReason] || '未说明'
}

export function workLevelLabel(level: ProjectWorkLevel | string | null | undefined) {
  return workLevelLabels[normalizeValue(level) as ProjectWorkLevel] || workLevelLabels.standard
}

export function workLevelLabelWithReason(
  level: ProjectWorkLevel | string | null | undefined,
  depthReason: ProjectDepthReason | string | null | undefined,
) {
  return normalizeValue(level) === 'deep'
    ? `${workLevelLabels.deep} · ${depthReasonLabel(depthReason)}`
    : workLevelLabel(level)
}

export function workLevelIcon(level: ProjectWorkLevel | string | null | undefined): RecordPresentationIcon {
  const value = normalizeValue(level)
  if (value === 'deep') return 'search'
  if (value === 'standard') return 'layers'
  return 'circleDot'
}

export function workLevelPresentation(
  level: ProjectWorkLevel | string | null | undefined,
): LabelIconPresentation {
  return { label: workLevelLabel(level), icon: workLevelIcon(level) }
}

export function workLevelPresentationWithReason(
  level: ProjectWorkLevel | string | null | undefined,
  depthReason: ProjectDepthReason | string | null | undefined,
): LabelIconPresentation {
  return { label: workLevelLabelWithReason(level, depthReason), icon: workLevelIcon(level) }
}

export function logLevelLabel(level: ProjectLogLevel | string | null | undefined) {
  return workLevelLabel(level)
}

export function logLevelIcon(level: ProjectLogLevel | string | null | undefined): RecordPresentationIcon {
  return workLevelIcon(level)
}

export function logLevelPresentation(
  level: ProjectLogLevel | string | null | undefined,
): LabelIconPresentation {
  return { label: logLevelLabel(level), icon: logLevelIcon(level) }
}

function normalizeValue(value: string | null | undefined) {
  return String(value || '').trim()
}
