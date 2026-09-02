import { reactive, ref, type Ref } from 'vue'
import type { AnyRecord } from '../utils/record-formatters'

export type VersionForm = {
  label: string
  title: string
  goal: string
  summary: string
  versionStatus: string
  feedback: string
}

type VersionApi = {
  createVersion: (projectRoot: string, payload: AnyRecord) => Promise<AnyRecord>
  updateVersionStatus: (projectRoot: string, versionId: string, status: string) => Promise<AnyRecord>
}

type ReadyVersionContext = {
  api: VersionApi
  projectRoot: string
}

type VersionCommandsOptions = {
  versions: Readonly<Ref<AnyRecord[]>>
  selectedVersionId: Readonly<Ref<string>>
  runAction: (message: string, action: () => Promise<void>) => Promise<unknown>
  ensureReady: () => ReadyVersionContext | null
  replaceDashboard: (dashboard: AnyRecord) => void
  showToast: (message: string) => void
  setStatus: (message: string) => void
  onSelectedVersionCompleted: () => void
}

export function useVersionCommands(options: VersionCommandsOptions) {
  const {
    versions,
    selectedVersionId,
    runAction,
    ensureReady,
    replaceDashboard,
    showToast,
    setStatus,
    onSelectedVersionCompleted,
  } = options

  const versionDialogOpen = ref(false)
  const versionForm = reactive<VersionForm>({
    label: '',
    title: '',
    goal: '',
    summary: '',
    versionStatus: 'planned',
    feedback: '',
  })

  function openVersionDialog() {
    versionForm.label = `v0.${versions.value.length + 1}`
    versionForm.title = ''
    versionForm.goal = ''
    versionForm.summary = ''
    versionForm.versionStatus = 'planned'
    versionForm.feedback = ''
    versionDialogOpen.value = true
  }

  function closeVersionDialog() {
    versionDialogOpen.value = false
  }

  async function saveVersion() {
    await runAction('正在创建版本...', async () => {
      const ready = ensureReady()
      if (!ready) return
      if (!versionForm.label.trim() || !versionForm.title.trim() || !versionForm.goal.trim()) {
        versionForm.feedback = '请填写版本名称、标题和目标'
        return
      }
      versionForm.feedback = '保存中...'
      replaceDashboard(await ready.api.createVersion(ready.projectRoot, {
        label: versionForm.label,
        title: versionForm.title,
        goal: versionForm.goal,
        summary: versionForm.summary,
        status: versionForm.versionStatus,
      }))
      closeVersionDialog()
      showToast('版本已创建')
    })
  }

  async function changeVersionStatus(version: AnyRecord, status: string) {
    if (!version?.shortId || version.status === status) return
    await runAction('正在更新版本状态...', async () => {
      const ready = ensureReady()
      if (!ready) return
      replaceDashboard(await ready.api.updateVersionStatus(ready.projectRoot, version.shortId, status))
      if (version.shortId === selectedVersionId.value && status === 'completed') {
        onSelectedVersionCompleted()
      }
      showToast(`版本已设为${versionStatusText(status)}`)
      setStatus('')
    })
  }

  return {
    versionDialogOpen,
    versionForm,
    openVersionDialog,
    closeVersionDialog,
    saveVersion,
    changeVersionStatus,
  }
}

function versionStatusText(status: string) {
  return ({
    planned: '规划中',
    active: '进行中',
    paused: '已暂停',
    completed: '已完成',
  } as Record<string, string>)[status] || status
}
