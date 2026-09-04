import { computed, type Ref } from 'vue'
import type { AnyRecord } from '../utils/record-formatters'

export function useVersionContext(options: {
  dashboard: Readonly<Ref<AnyRecord | null>>
  projectRoot: Readonly<Ref<string>>
  selectedVersionId: Ref<string>
  selectedVersionByProject: Record<string, string>
}) {
  const { dashboard, projectRoot, selectedVersionId, selectedVersionByProject } = options

  const versions = computed<AnyRecord[]>(() => dashboard.value?.versions || [])
  const currentVersion = computed<AnyRecord | null>(() => dashboard.value?.currentVersion || null)
  const selectedVersion = computed<AnyRecord | null>(() => {
    if (selectedVersionId.value === 'all') {
      return {
        shortId: '全部版本',
        label: '全部',
        title: '版本历史总览',
        goal: '包含所有版本的协作记录。',
      }
    }
    return versions.value.find((version) => version.shortId === selectedVersionId.value) || currentVersion.value
  })
  const creationVersionId = computed(() => selectedVersionId.value === 'all' ? '' : selectedVersionId.value)
  const creationDisabledReason = computed(() => validateCreationVersion().reason)

  function setSelectedVersion(versionId: string) {
    selectedVersionId.value = versionId
    if (projectRoot.value) selectedVersionByProject[projectRoot.value] = versionId
  }

  function resetForProject(nextProjectRoot: string) {
    selectedVersionId.value = selectedVersionByProject[nextProjectRoot] || ''
  }

  function syncSelectedVersion(nextDashboard: AnyRecord | null = dashboard.value) {
    const currentId = nextDashboard?.currentVersion?.shortId || nextDashboard?.config?.currentVersionId || ''
    const valid = selectedVersionId.value === 'all'
      || (nextDashboard?.versions || []).some((version: AnyRecord) => version.shortId === selectedVersionId.value)
    if (!valid || !selectedVersionId.value) selectedVersionId.value = currentId
    if (projectRoot.value && selectedVersionId.value) {
      selectedVersionByProject[projectRoot.value] = selectedVersionId.value
    }
  }

  function validateCreationVersion(requestedVersionId = creationVersionId.value) {
    const targetVersion = versions.value.find((version) => version.shortId === requestedVersionId)
    const reason = !requestedVersionId
      ? '请先从顶部选择一个具体版本'
      : targetVersion?.status === 'completed'
        ? '已完成版本不接收新记录，请先调整版本状态'
        : ''
    return { versionId: reason ? '' : requestedVersionId, reason }
  }

  return {
    versions,
    currentVersion,
    selectedVersion,
    creationVersionId,
    creationDisabledReason,
    setSelectedVersion,
    resetForProject,
    syncSelectedVersion,
    validateCreationVersion,
  }
}
