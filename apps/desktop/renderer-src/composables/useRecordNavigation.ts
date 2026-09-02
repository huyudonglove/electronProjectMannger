import { computed, nextTick, onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import { navigationGroups } from '../config/ui'
import { clampLogIndex, type AnyRecord } from '../utils/record-formatters'

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
    collections,
    versionContext,
    projectRoot,
    selectedVersionId,
    researchTab,
    collaborationTab,
    logQuery,
    versionMenuOpen,
    closeQuestionDialog,
    showToast,
  } = options
  const {
    allTasks,
    allThoughts,
    allLogs,
    tasks,
    visibleDialogues,
    logs,
    activeCollabItems,
  } = collections
  const { versions, setSelectedVersion } = versionContext
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

  const taskRefs = new Map<string, Element>()
  const thoughtRefs = new Map<string, Element>()
  const highlightTimers = new Set<number>()
  let disposed = false

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

  onMounted(() => {
    const initialSection = location.hash.replace('#', '') || 'overview'
    setActiveSection(initialSection)
  })

  onBeforeUnmount(() => {
    disposed = true
    for (const timer of highlightTimers) window.clearTimeout(timer)
    highlightTimers.clear()
    taskRefs.clear()
    thoughtRefs.clear()
  })

  function setActiveSection(nextSection: string) {
    const valid = navigationGroups.some((group) => group.items.some(([key]) => key === nextSection))
    section.value = valid ? nextSection : 'overview'
    history.replaceState(null, '', `#${section.value}`)
  }

  function selectVersion(versionId: string) {
    setSelectedVersion(versionId)
    versionMenuOpen.value = false
    secondaryTasksExpanded.value = false
    const targetVersion = versions.value.find((version) => version.shortId === versionId)
    if (versionId === 'all' || targetVersion?.status === 'completed') {
      closeQuestionDialog()
    }
  }

  function setTaskRef(taskId: string, element: Element | null) {
    if (element) taskRefs.set(taskId, element)
    else taskRefs.delete(taskId)
  }

  function setThoughtRef(thoughtId: string, element: Element | null) {
    if (element) thoughtRefs.set(thoughtId, element)
    else thoughtRefs.delete(thoughtId)
  }

  async function scrollToRef(
    refs: Map<any, Element>,
    key: any,
    highlight: () => void,
    clear: () => void,
    delay = 1600,
  ) {
    await nextTick()
    if (disposed) return
    const target = refs.get(key)
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    highlight()
    scheduleHighlightClear(clear, delay)
  }

  function openBoardTask(taskId: string) {
    const target = tasks.value.find((task) => task.id === taskId)
    if (target && ['backlog', 'abandoned'].includes(target.status)) secondaryTasksExpanded.value = true
    setActiveSection('board')
    scrollToRef(
      taskRefs,
      taskId,
      () => { highlightedTask.value = taskId },
      () => { highlightedTask.value = '' },
    )
  }

  function openThought(thoughtId: string) {
    setActiveSection('capture')
    scrollToRef(
      thoughtRefs,
      thoughtId,
      () => { highlightedThought.value = thoughtId },
      () => { highlightedThought.value = '' },
    )
  }

  function openDialogue(index: number) {
    selectedDialogueIndex.value = Math.min(Math.max(index, 0), Math.max(visibleDialogues.value.length - 1, 0))
    highlightedDialogue.value = selectedDialogueIndex.value
    scheduleHighlightClear(() => { highlightedDialogue.value = -1 }, 600)
  }

  function openWorkLog(index: number) {
    selectedLogIndex.value = clampLogIndex(Number(index || 0), logs.value)
    highlightedLog.value = selectedLogIndex.value
    scheduleHighlightClear(() => { highlightedLog.value = -1 }, 600)
  }

  function openCollabItem(index: number) {
    selectedCollabIndex.value = Math.min(
      Math.max(Number(index || 0), 0),
      Math.max(activeCollabItems.value.length - 1, 0),
    )
  }

  async function openQuestionTarget(item: AnyRecord) {
    const relation = (item.relations || []).find((value: string) => /^[TIL]\d+$/i.test(value))
    if (!relation) return
    if (/^L/i.test(relation)) {
      const target = allLogs.value.find((log) => log.shortId === relation)
      if (!target) return showToast('未找到关联记录')
      logQuery.value = ''
      if (target.version) selectVersion(target.version)
      await nextTick()
      const index = logs.value.findIndex((log) => log.shortId === relation)
      if (index >= 0) {
        setActiveSection('work-logs')
        openWorkLog(index)
      } else {
        showToast('未找到关联记录')
      }
    } else if (/^I/i.test(relation)) {
      const target = allThoughts.value.find((thought) => thought.shortId === relation)
      if (!target) return showToast('未找到关联记录')
      if (target.version) selectVersion(target.version)
      await nextTick()
      openThought(target.id)
    } else {
      const target = allTasks.value.find((task) => task.shortId === relation)
      if (!target) return showToast('未找到关联记录')
      if (target.version) selectVersion(target.version)
      await nextTick()
      openBoardTask(target.id)
    }
  }

  function boardItems(status: string) {
    const allItems = tasks.value.filter((task) => task.status === status)
    return status === 'done' && !doneExpanded.value ? allItems.slice(0, 6) : allItems
  }

  function hiddenDoneCount(status: string) {
    if (status !== 'done') return 0
    return tasks.value.filter((task) => task.status === 'done').length - boardItems(status).length
  }

  function secondaryTaskGroups() {
    return [
      { status: 'backlog', label: '待规划', count: tasks.value.filter((task) => task.status === 'backlog').length },
      { status: 'abandoned', label: '已放弃', count: tasks.value.filter((task) => task.status === 'abandoned').length },
    ].filter((group) => group.count > 0)
  }

  function toggleDoneExpanded() {
    doneExpanded.value = !doneExpanded.value
  }

  function toggleSecondaryTasksExpanded() {
    secondaryTasksExpanded.value = !secondaryTasksExpanded.value
  }

  function scheduleHighlightClear(callback: () => void, delay: number) {
    if (disposed) return
    const timer = window.setTimeout(() => {
      highlightTimers.delete(timer)
      callback()
    }, delay)
    highlightTimers.add(timer)
  }

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
