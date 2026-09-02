import { nextTick, onBeforeUnmount, type Ref } from 'vue'
import { navigationGroups } from '../../config/ui'
import { clampLogIndex, type AnyRecord } from '../../utils/record-formatters'

type TargetNavigationOptions = {
  state: {
    section: Ref<string>
    selectedDialogueIndex: Ref<number>
    selectedLogIndex: Ref<number>
    selectedCollabIndex: Ref<number>
    highlightedTask: Ref<string>
    highlightedThought: Ref<string>
    highlightedDialogue: Ref<number>
    highlightedLog: Ref<number>
    secondaryTasksExpanded: Ref<boolean>
  }
  collections: {
    allTasks: Readonly<Ref<AnyRecord[]>>
    allThoughts: Readonly<Ref<AnyRecord[]>>
    allLogs: Readonly<Ref<AnyRecord[]>>
    tasks: Readonly<Ref<AnyRecord[]>>
    visibleDialogues: Readonly<Ref<AnyRecord[]>>
    logs: Readonly<Ref<AnyRecord[]>>
    activeCollabItems: Readonly<Ref<AnyRecord[]>>
  }
  versionContext: {
    versions: Readonly<Ref<AnyRecord[]>>
    setSelectedVersion: (versionId: string) => void
  }
  logQuery: Ref<string>
  versionMenuOpen: Ref<boolean>
  closeQuestionDialog: () => void
  showToast: (message: string) => void
}

export function useTargetNavigation(options: TargetNavigationOptions) {
  const {
    allTasks,
    allThoughts,
    allLogs,
    tasks,
    visibleDialogues,
    logs,
    activeCollabItems,
  } = options.collections
  const { versions, setSelectedVersion } = options.versionContext
  const {
    section,
    selectedDialogueIndex,
    selectedLogIndex,
    selectedCollabIndex,
    highlightedTask,
    highlightedThought,
    highlightedDialogue,
    highlightedLog,
    secondaryTasksExpanded,
  } = options.state
  const {
    logQuery,
    versionMenuOpen,
    closeQuestionDialog,
    showToast,
  } = options

  const taskRefs = new Map<string, Element>()
  const thoughtRefs = new Map<string, Element>()
  const highlightTimers = new Set<number>()
  let disposed = false

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

  function scheduleHighlightClear(callback: () => void, delay: number) {
    if (disposed) return
    const timer = window.setTimeout(() => {
      highlightTimers.delete(timer)
      callback()
    }, delay)
    highlightTimers.add(timer)
  }

  return {
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
  }
}
