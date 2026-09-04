import type { Ref } from 'vue'
import type { AnyRecord } from '../../utils/record-formatters'

type TaskBoardStateOptions = {
  tasks: Readonly<Ref<AnyRecord[]>>
  doneExpanded: Ref<boolean>
  secondaryTasksExpanded: Ref<boolean>
}

export function useTaskBoardState(options: TaskBoardStateOptions) {
  const { tasks, doneExpanded, secondaryTasksExpanded } = options

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

  return {
    boardItems,
    hiddenDoneCount,
    secondaryTaskGroups,
    toggleDoneExpanded,
    toggleSecondaryTasksExpanded,
  }
}
