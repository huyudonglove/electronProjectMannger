import { computed, type Ref } from 'vue'
import type { AnyRecord } from '../utils/record-formatters'

export function useCompanionViewModel(options: {
  dashboard: Readonly<Ref<AnyRecord | null>>
  selectedVersionId: Readonly<Ref<string>>
}) {
  const { dashboard, selectedVersionId } = options
  const currentVersion = computed(() => {
    const versions = dashboard.value?.versions || []
    const selectedVersion = selectedVersionId.value !== 'all'
      ? versions.find((version: AnyRecord) => version.shortId === selectedVersionId.value)
      : null
    const fallbackVersionId = dashboard.value?.currentVersion?.shortId
      || dashboard.value?.config?.currentVersionId
      || ''
    return selectedVersion
      || versions.find((version: AnyRecord) => version.shortId === fallbackVersionId)
      || dashboard.value?.currentVersion
      || null
  })
  const currentVersionId = computed(() => String(currentVersion.value?.shortId || ''))
  const versionTasks = computed(() => (dashboard.value?.tasks || []).filter(
    (task: AnyRecord) => task.version === currentVersionId.value,
  ))
  const progressTasks = computed(() => versionTasks.value.filter(
    (task: AnyRecord) => !['abandoned'].includes(task.status),
  ))
  const completedTaskCount = computed(() => progressTasks.value.filter(
    (task: AnyRecord) => task.status === 'done',
  ).length)
  const taskProgress = computed(() => progressTasks.value.length
    ? Math.round((completedTaskCount.value / progressTasks.value.length) * 100)
    : 0)
  const taskCounts = computed(() => ({
    doing: versionTasks.value.filter((task: AnyRecord) => task.status === 'doing').length,
    todo: versionTasks.value.filter((task: AnyRecord) => task.status === 'todo').length,
    backlog: versionTasks.value.filter((task: AnyRecord) => task.status === 'backlog').length,
    done: completedTaskCount.value,
    total: progressTasks.value.length,
  }))
  const sortedTasks = computed(() => versionTasks.value
    .slice()
    .sort((left: AnyRecord, right: AnyRecord) => taskRank(left.status) - taskRank(right.status)
      || displayTime(right.updated) - displayTime(left.updated)))
  const activeTasks = computed(() => sortedTasks.value
    .filter((task: AnyRecord) => ['doing', 'todo', 'backlog'].includes(task.status))
    .slice(0, 4))
  const versionThoughts = computed(() => currentVersionId.value
    ? (dashboard.value?.thoughts || [])
      .filter((thought: AnyRecord) => thought.version === currentVersionId.value)
      .slice()
      .sort((left: AnyRecord, right: AnyRecord) => displayTime(right.created) - displayTime(left.created)
        || recordSequence(right.shortId) - recordSequence(left.shortId))
    : [])
  const latestThoughts = computed(() => versionThoughts.value
    .filter((thought: AnyRecord) => thought.status !== 'handled')
    .slice(0, 3))
  const versionDialogues = computed(() => currentVersionId.value
    ? (dashboard.value?.dialogues || [])
      .filter((dialogue: AnyRecord) => dialogue.version === currentVersionId.value)
      .slice()
      .sort((left: AnyRecord, right: AnyRecord) => dialogueRank(left.status) - dialogueRank(right.status)
        || displayTime(right.updated || right.created) - displayTime(left.updated || left.created)
        || recordSequence(right.shortId) - recordSequence(left.shortId))
    : [])
  const activeDialogues = computed(() => versionDialogues.value
    .filter((dialogue: AnyRecord) => ['pending', 'doing'].includes(dialogue.status)))
  const latestDialogues = computed(() => activeDialogues.value.slice(0, 3))
  const allAttentionItems = computed(() => {
    const questions = (dashboard.value?.questions || [])
      .filter((item: AnyRecord) => ['open', 'decided'].includes(item.status))
      .filter((item: AnyRecord) => item.scope === 'project' || item.version === currentVersionId.value)
      .map((item: AnyRecord) => ({
        ...item,
        companionKind: item.status === 'decided' ? '待跟进' : '待确认',
        companionTargetKind: item.status === 'decided' ? 'decision' : 'question',
      }))
    const risks = (dashboard.value?.risks || [])
      .filter((item: AnyRecord) => item.status === 'open' && item.version === currentVersionId.value)
      .map((item: AnyRecord) => ({
        ...item,
        companionKind: ({
          risk: '风险',
          verification: '验证限制',
          'follow-up': '后续事项',
        } as Record<string, string>)[item.kind] || '风险',
        companionTargetKind: 'risk',
      }))
    return [...questions, ...risks]
      .sort((left, right) => displayTime(right.updated || right.created) - displayTime(left.updated || left.created))
  })
  const attentionItems = computed(() => allAttentionItems.value.slice(0, 3))
  const attentionCount = computed(() => allAttentionItems.value.length)
  const versionLogs = computed(() => (dashboard.value?.logs || [])
    .filter((log: AnyRecord) => log.version === currentVersionId.value)
    .slice()
    .sort((left: AnyRecord, right: AnyRecord) => displayTime(right.created) - displayTime(left.created)
      || recordSequence(right.shortId) - recordSequence(left.shortId)
      || String(right.shortId || '').localeCompare(String(left.shortId || ''))))
  const latestLogs = computed(() => versionLogs.value.slice(0, 3))

  return {
    currentVersion,
    currentVersionId,
    versionTasks: sortedTasks,
    taskCounts,
    taskProgress,
    activeTasks,
    versionThoughts,
    latestThoughts,
    versionDialogues,
    activeDialogues,
    latestDialogues,
    attentionItems,
    allAttentionItems,
    attentionCount,
    latestLogs,
    versionLogs,
  }
}

function taskRank(status: string) {
  return ({ doing: 0, todo: 1, backlog: 2, done: 3, abandoned: 4 } as Record<string, number>)[status] ?? 5
}

function dialogueRank(status: string) {
  return ({ doing: 0, pending: 1, done: 2, archived: 3 } as Record<string, number>)[status] ?? 4
}

function displayTime(value: string) {
  const timestamp = Date.parse(String(value || ''))
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function recordSequence(value: unknown) {
  const match = String(value || '').match(/\d+/g)
  return Number(match?.at(-1) || 0)
}
