import { computed, type Ref } from 'vue'
import type { AnyRecord } from '../utils/record-formatters'

type ResearchTab = 'active' | 'done'
type CollaborationTab = 'open' | 'decided' | 'risks' | 'history'

export function useRecordCollections(options: {
  dashboard: Readonly<Ref<AnyRecord | null>>
  selectedVersionId: Readonly<Ref<string>>
  researchTab: Readonly<Ref<ResearchTab>>
  collaborationTab: Readonly<Ref<CollaborationTab>>
  logQuery: Readonly<Ref<string>>
}) {
  const { dashboard, selectedVersionId, researchTab, collaborationTab, logQuery } = options

  function recordMatchesSelectedVersion(item: AnyRecord) {
    if (selectedVersionId.value === 'all') return true
    return String(item?.version || '') === selectedVersionId.value
  }

  function questionMatchesSelectedVersion(item: AnyRecord) {
    if (selectedVersionId.value === 'all') return true
    return item?.scope === 'project' || String(item?.version || '') === selectedVersionId.value
  }

  const allTasks = computed(() => dashboard.value?.tasks || [])
  const allThoughts = computed(() => dashboard.value?.thoughts || [])
  const allDialogues = computed(() => dashboard.value?.dialogues || [])
  const allDocuments = computed(() => dashboard.value?.documents || [])
  const allLogs = computed(() => dashboard.value?.logs || [])
  const allConstraints = computed(() => dashboard.value?.constraints || [])
  const knowledge = computed(() => dashboard.value?.knowledge || [])
  const questions = computed(() => dashboard.value?.questions || [])
  const risks = computed(() => dashboard.value?.risks || [])

  const tasks = computed(() => allTasks.value.filter(recordMatchesSelectedVersion))
  const thoughts = computed(() => allThoughts.value.filter(recordMatchesSelectedVersion))
  const dialogues = computed(() => allDialogues.value.filter(recordMatchesSelectedVersion))
  const documents = computed(() => allDocuments.value.filter(recordMatchesSelectedVersion))
  const userConstraints = computed(() => allConstraints.value.filter(
    (item: AnyRecord) => item.source !== 'system',
  ))
  const systemConstraints = computed(() => allConstraints.value.filter((item: AnyRecord) => item.source === 'system'))
  const constraints = computed(() => [...userConstraints.value, ...systemConstraints.value])

  const activeDialogues = computed(() => dialogues.value.filter(
    (dialogue: AnyRecord) => ['pending', 'doing'].includes(dialogue.status),
  ))
  const completedDialogues = computed(() => dialogues.value.filter(
    (dialogue: AnyRecord) => ['done', 'archived'].includes(dialogue.status),
  ))
  const visibleDialogues = computed(() => researchTab.value === 'active' ? activeDialogues.value : completedDialogues.value)

  const logs = computed(() => {
    const query = logQuery.value.trim().toLocaleLowerCase()
    return allLogs.value
      .filter(recordMatchesSelectedVersion)
      .filter((log: AnyRecord) => !query || [
        log.shortId,
        log.title,
        log.userGoal,
        log.result,
        ...(log.decisions || []),
        ...(log.relatedTasks || []).flatMap((task: AnyRecord) => [task.shortId, task.title]),
      ].some((value) => String(value || '').toLocaleLowerCase().includes(query)))
  })

  const visibleQuestions = computed(() => questions.value.filter(questionMatchesSelectedVersion))
  const openQuestions = computed(() => visibleQuestions.value.filter((item: AnyRecord) => item.status === 'open'))
  const pendingDecisions = computed(() => visibleQuestions.value.filter((item: AnyRecord) => item.status === 'decided'))
  const activeRisks = computed(() => risks.value.filter(
    (item: AnyRecord) => item.status === 'open' && recordMatchesSelectedVersion(item),
  ))
  const activeCollabItems = computed(() => {
    if (collaborationTab.value === 'open') return openQuestions.value
    if (collaborationTab.value === 'decided') return pendingDecisions.value
    if (collaborationTab.value === 'risks') return activeRisks.value
    return []
  })
  const collabAttentionCount = computed(() => openQuestions.value.length + pendingDecisions.value.length)

  return {
    recordMatchesSelectedVersion,
    questionMatchesSelectedVersion,
    allTasks,
    allThoughts,
    allDialogues,
    allDocuments,
    allLogs,
    allConstraints,
    knowledge,
    questions,
    risks,
    tasks,
    thoughts,
    dialogues,
    documents,
    userConstraints,
    systemConstraints,
    constraints,
    activeDialogues,
    completedDialogues,
    visibleDialogues,
    logs,
    visibleQuestions,
    openQuestions,
    pendingDecisions,
    activeRisks,
    activeCollabItems,
    collabAttentionCount,
  }
}
