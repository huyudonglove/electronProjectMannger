export type AgentTimelineEvent = {
  sequence: number
  at?: string
  type?: string
  phase?: string
  summary: string
  payload?: Record<string, unknown>
}

export type AgentTimelineGroup = {
  key: string
  count: number
  event: AgentTimelineEvent
}

export type AgentTimeline = {
  activity: AgentTimelineGroup[]
  issues: AgentTimelineGroup[]
  verifications: AgentTimelineGroup[]
  changedFiles: string[]
  terminal?: AgentTimelineEvent
}

const TERMINAL_TYPES = new Set(['run.completed', 'run.blocked', 'run.failed', 'run.cancelled'])
const MODEL_NOISE_TYPES = new Set(['model.started', 'model.completed'])

export function buildAgentTimeline(events: AgentTimelineEvent[], runChangedFiles: string[] = []): AgentTimeline {
  const completedRequestIds = new Set(events
    .filter((event) => event.type === 'tool.completed')
    .map((event) => stringPayload(event, 'requestId'))
    .filter(Boolean))
  const changedFiles = new Set(runChangedFiles.filter(Boolean))
  const activity: AgentTimelineEvent[] = []
  const issues: AgentTimelineEvent[] = []
  const verifications: AgentTimelineEvent[] = []
  let terminal: AgentTimelineEvent | undefined

  for (const event of events) {
    if (event.type === 'files.changed') {
      for (const path of stringArrayPayload(event, 'paths')) changedFiles.add(path)
      continue
    }
    if (TERMINAL_TYPES.has(event.type || '')) {
      terminal = event
      continue
    }
    if (isIssue(event)) {
      issues.push(event)
      continue
    }
    if (event.type === 'verification.completed') {
      verifications.push(event)
      continue
    }
    if (MODEL_NOISE_TYPES.has(event.type || '')) continue
    if (event.type === 'tool.requested' && completedRequestIds.has(stringPayload(event, 'requestId'))) continue
    activity.push(event)
  }

  return {
    activity: groupEvents(activity, activityGroupKey),
    issues: groupEvents(issues, issueGroupKey),
    verifications: groupEvents(verifications, verificationGroupKey),
    changedFiles: [...changedFiles].sort(),
    ...(terminal ? { terminal } : {}),
  }
}

export function humanizeAgentSummary(summary: string) {
  if (summary === 'Run duration limit reached') return '运行时间已达到上限'
  const failedCommand = summary.match(/^Ran (.+) failed with exit code (.+)$/)
  if (failedCommand) return `${failedCommand[1]} 执行失败（退出码 ${failedCommand[2]}）`
  return summary
}

function isIssue(event: AgentTimelineEvent) {
  if (event.type === 'model.rejected') return true
  if (event.type === 'model.attempted' && stringPayload(event, 'outcome') === 'failed') return true
  if (event.type === 'tool.completed' && event.payload?.ok === false) return true
  if (event.type === 'verification.completed' && event.payload?.passed === false) return true
  return false
}

function activityGroupKey(event: AgentTimelineEvent) {
  if (event.type === 'tool.completed' || event.type === 'tool.requested') {
    return `${event.type}:${stringPayload(event, 'tool') || event.summary}`
  }
  if (event.type === 'phase.changed') return `${event.type}:${stringPayload(event, 'phase') || event.phase || ''}`
  if (event.type === 'model.attempted') return `${event.type}:${stringPayload(event, 'outcome') || ''}`
  return event.type || event.summary
}

function issueGroupKey(event: AgentTimelineEvent) {
  return event.summary
}

function verificationGroupKey(event: AgentTimelineEvent) {
  return `${stringPayload(event, 'checkId') || event.summary}:${String(event.payload?.passed)}`
}

function groupEvents(events: AgentTimelineEvent[], keyFor: (event: AgentTimelineEvent) => string) {
  const groups = new Map<string, AgentTimelineGroup>()
  for (const event of events) {
    const key = keyFor(event)
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      existing.event = event
    } else {
      groups.set(key, { key: `${key}:${event.sequence}`, count: 1, event })
    }
  }
  return [...groups.values()].sort((left, right) => left.event.sequence - right.event.sequence)
}

function stringPayload(event: AgentTimelineEvent, key: string) {
  const value = event.payload?.[key]
  return typeof value === 'string' ? value : ''
}

function stringArrayPayload(event: AgentTimelineEvent, key: string) {
  const value = event.payload?.[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
