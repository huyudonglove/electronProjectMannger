import { onMounted, type Ref } from 'vue'
import { useSelectionState } from './record-navigation/useSelectionState'
import { useTargetNavigation } from './record-navigation/useTargetNavigation'
import { useTaskBoardState } from './record-navigation/useTaskBoardState'
import type { AnyRecord } from '../utils/record-formatters'

type ResearchTab = 'active' | 'done'
type CollaborationTab = 'open' | 'decided' | 'risks' | 'history'

type NavigationCollections = {
  allTasks: Readonly<Ref<AnyRecord[]>>
  allThoughts: Readonly<Ref<AnyRecord[]>>
  allLogs: Readonly<Ref<AnyRecord[]>>
  tasks: Readonly<Ref<AnyRecord[]>>
  visibleDialogues: Readonly<Ref<AnyRecord[]>>
  logs: Readonly<Ref<AnyRecord[]>>
  activeCollabItems: Readonly<Ref<AnyRecord[]>>
}

type NavigationVersionContext = {
  versions: Readonly<Ref<AnyRecord[]>>
  setSelectedVersion: (versionId: string) => void
}

type RecordNavigationOptions = {
  state: {
    section: Ref<string>
    selectedDialogueIndex: Ref<number>
    selectedLogIndex: Ref<number>
    selectedCollabIndex: Ref<number>
    highlightedTask: Ref<string>
    highlightedThought: Ref<string>
    highlightedDialogue: Ref<number>
    highlightedLog: Ref<number>
    doneExpanded: Ref<boolean>
    secondaryTasksExpanded: Ref<boolean>
  }
  collections: NavigationCollections
  versionContext: NavigationVersionContext
  projectRoot: Readonly<Ref<string>>
  selectedVersionId: Readonly<Ref<string>>
  researchTab: Readonly<Ref<ResearchTab>>
  collaborationTab: Readonly<Ref<CollaborationTab>>
  logQuery: Ref<string>
  versionMenuOpen: Ref<boolean>
  closeQuestionDialog: () => void
  showToast: (message: string) => void
}

export function useRecordNavigation(options: RecordNavigationOptions) {
  const {
    section,
    selectedDialogueIndex,
    selectedLogIndex,
    selectedCollabIndex,
    highlightedTask,
    highlightedThought,
    highlightedDialogue,
    highlightedLog,
    doneExpanded,
    secondaryTasksExpanded,
  } = options.state

  const {
    selectedDialogue,
    selectedCollabItem,
    visibleLog,
  } = useSelectionState({
    selectedDialogueIndex,
    selectedLogIndex,
    selectedCollabIndex,
    visibleDialogues: options.collections.visibleDialogues,
    logs: options.collections.logs,
    activeCollabItems: options.collections.activeCollabItems,
    projectRoot: options.projectRoot,
    selectedVersionId: options.selectedVersionId,
    researchTab: options.researchTab,
    collaborationTab: options.collaborationTab,
    logQuery: options.logQuery,
  })

  const {
    taskRefs,
    thoughtRefs,
    setActiveSection,
    selectVersion,
    setTaskRef,
    setThoughtRef,
    openBoardTask,
    openThought,
    openDialogue,
    openWorkLog,
    openCollabItem,
    openQuestionTarget,
  } = useTargetNavigation({
    state: {
      section,
      selectedDialogueIndex,
      selectedLogIndex,
      selectedCollabIndex,
      highlightedTask,
      highlightedThought,
      highlightedDialogue,
      highlightedLog,
      secondaryTasksExpanded,
    },
    collections: options.collections,
    versionContext: options.versionContext,
    logQuery: options.logQuery,
    versionMenuOpen: options.versionMenuOpen,
    closeQuestionDialog: options.closeQuestionDialog,
    showToast: options.showToast,
  })

  const {
    boardItems,
    hiddenDoneCount,
    secondaryTaskGroups,
    toggleDoneExpanded,
    toggleSecondaryTasksExpanded,
  } = useTaskBoardState({
    tasks: options.collections.tasks,
    doneExpanded,
    secondaryTasksExpanded,
  })

  onMounted(() => {
    const initialSection = location.hash.replace('#', '') || 'overview'
    setActiveSection(initialSection)
  })

  return {
    section,
    selectedDialogueIndex,
    selectedLogIndex,
    selectedCollabIndex,
    selectedDialogue,
    selectedCollabItem,
    visibleLog,
    highlightedTask,
    highlightedThought,
    highlightedDialogue,
    highlightedLog,
    doneExpanded,
    secondaryTasksExpanded,
    taskRefs,
    thoughtRefs,
    setActiveSection,
    selectVersion,
    setTaskRef,
    setThoughtRef,
    openBoardTask,
    openThought,
    openDialogue,
    openWorkLog,
    openCollabItem,
    openQuestionTarget,
    boardItems,
    hiddenDoneCount,
    secondaryTaskGroups,
    toggleDoneExpanded,
    toggleSecondaryTasksExpanded,
  }
}
