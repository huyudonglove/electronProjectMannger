import { computed, watch, type Ref } from 'vue'
import { clampLogIndex, type AnyRecord } from '../../utils/record-formatters'

type ResearchTab = 'active' | 'done'
type CollaborationTab = 'open' | 'decided' | 'risks' | 'history'

type SelectionStateOptions = {
  selectedDialogueIndex: Ref<number>
  selectedLogIndex: Ref<number>
  selectedCollabIndex: Ref<number>
  visibleDialogues: Readonly<Ref<AnyRecord[]>>
  logs: Readonly<Ref<AnyRecord[]>>
  activeCollabItems: Readonly<Ref<AnyRecord[]>>
  projectRoot: Readonly<Ref<string>>
  selectedVersionId: Readonly<Ref<string>>
  researchTab: Readonly<Ref<ResearchTab>>
  collaborationTab: Readonly<Ref<CollaborationTab>>
  logQuery: Ref<string>
}

export function useSelectionState(options: SelectionStateOptions) {
  const {
    selectedDialogueIndex,
    selectedLogIndex,
    selectedCollabIndex,
    visibleDialogues,
    logs,
    activeCollabItems,
    projectRoot,
    selectedVersionId,
    researchTab,
    collaborationTab,
    logQuery,
  } = options

  const selectedDialogue = computed(() => (
    visibleDialogues.value[selectedDialogueIndex.value] || visibleDialogues.value[0] || null
  ))
  const selectedCollabItem = computed(() => (
    activeCollabItems.value[selectedCollabIndex.value] || activeCollabItems.value[0] || null
  ))
  const visibleLog = computed(() => logs.value[clampLogIndex(selectedLogIndex.value, logs.value)])

  watch(
    [logQuery, selectedVersionId, projectRoot],
    () => {
      selectedLogIndex.value = 0
    },
  )

  watch(
    [researchTab, selectedVersionId, projectRoot],
    () => {
      selectedDialogueIndex.value = 0
    },
  )

  watch(
    [collaborationTab, selectedVersionId, projectRoot],
    () => {
      selectedCollabIndex.value = 0
    },
  )

  watch(
    () => activeCollabItems.value.length,
    () => {
      selectedCollabIndex.value = clampLogIndex(selectedCollabIndex.value, activeCollabItems.value)
    },
  )

  watch(
    visibleDialogues,
    (items) => {
      selectedDialogueIndex.value = clampLogIndex(selectedDialogueIndex.value, items)
    },
    { flush: 'sync' },
  )

  watch(
    logs,
    (items) => {
      selectedLogIndex.value = clampLogIndex(selectedLogIndex.value, items)
    },
    { flush: 'sync' },
  )

  return {
    selectedDialogue,
    selectedCollabItem,
    visibleLog,
  }
}
