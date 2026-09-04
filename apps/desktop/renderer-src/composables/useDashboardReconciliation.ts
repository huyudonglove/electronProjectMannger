import type { Ref } from 'vue'
import type { AnyRecord } from '../utils/record-formatters'

type DashboardReconciliationOptions = {
  projectRoot: Ref<string>
  initialized: Ref<boolean>
  dashboard: Ref<AnyRecord | null>
  selectedTask: Ref<AnyRecord | null>
  resetForProject: (projectRoot: string) => void
  syncSelectedVersion: (dashboard: AnyRecord | null) => void
}

export function useDashboardReconciliation(options: DashboardReconciliationOptions) {
  const {
    projectRoot,
    initialized,
    dashboard,
    selectedTask,
    resetForProject,
    syncSelectedVersion,
  } = options

  function applyProjectResult(result: AnyRecord) {
    projectRoot.value = result.projectRoot
    initialized.value = result.initialized
    dashboard.value = result.dashboard
    resetForProject(result.projectRoot)
    syncSelectedVersion(result.dashboard)
  }

  function replaceDashboard(nextDashboard: AnyRecord) {
    initialized.value = true
    dashboard.value = nextDashboard
    syncSelectedVersion(nextDashboard)
    if (selectedTask.value) {
      selectedTask.value = (nextDashboard.tasks || [])
        .find((task: AnyRecord) => task.id === selectedTask.value?.id) || null
    }
  }

  return {
    applyProjectResult,
    replaceDashboard,
  }
}
