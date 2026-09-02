import { onBeforeUnmount, onMounted } from 'vue'
import { sortRecentProjects, type AnyRecord } from '../utils/record-formatters'

type WorkspaceState = {
  projectRoot: string
  initialized: boolean
  dashboard: AnyRecord | null
  recentProjects: AnyRecord[]
  busy: boolean
  autoRefreshing: boolean
  status: string
}

export function useProjectWorkspace(options: {
  state: WorkspaceState
  applyProjectResult: (result: AnyRecord) => void
  replaceDashboard: (dashboard: AnyRecord) => void
}) {
  const { state, applyProjectResult, replaceDashboard } = options
  let stopAutoRefresh: (() => void) | null = null

  function ensureApi() {
    if (!window.electronManager) throw new Error('preload API 未注入，请重新启动 Electron。')
    return window.electronManager
  }

  function ensureReadyForInit() {
    const api = ensureApi()
    if (!state.projectRoot) throw new Error('请先打开项目。')
    return api
  }

  function ensureReady() {
    const api = ensureApi()
    if (!state.projectRoot || !state.initialized) {
      state.status = '请先打开并初始化项目。'
      return null
    }
    return api
  }

  async function runAction(message: string, action: () => Promise<void>) {
    if (state.busy) return false
    try {
      state.busy = true
      state.status = message
      await action()
      return true
    } catch (error: any) {
      console.error(error)
      state.status = error?.message || '操作失败。'
      return false
    } finally {
      state.busy = false
    }
  }

  async function restoreLastProject() {
    await runAction('正在读取最近项目...', async () => {
      const api = ensureApi()
      state.recentProjects = sortRecentProjects(await api.listRecentProjects())
      const latestProject = state.recentProjects[0]
      if (!latestProject) {
        state.status = '等待选择项目'
        return
      }
      applyProjectResult(await api.openPath(latestProject.projectRoot))
      state.status = state.initialized ? '' : '项目尚未初始化。'
    })
  }

  async function loadRecentProjects() {
    state.recentProjects = sortRecentProjects(await ensureApi().listRecentProjects())
  }

  async function pickProject() {
    return ensureApi().openFolder()
  }

  async function openProject(projectRoot: string) {
    const api = ensureApi()
    applyProjectResult(await api.openPath(projectRoot))
    state.recentProjects = sortRecentProjects(await api.listRecentProjects())
  }

  async function removeRecentProject(projectId: string) {
    state.recentProjects = sortRecentProjects(await ensureApi().removeRecentProject(projectId))
  }

  async function initializeProject() {
    const api = ensureReadyForInit()
    applyProjectResult({
      initialized: true,
      projectRoot: state.projectRoot,
      dashboard: await api.initProject(state.projectRoot),
    })
  }

  async function refreshDashboard({ quiet = false } = {}) {
    const api = ensureReady()
    if (!api || state.autoRefreshing || state.busy) return
    state.autoRefreshing = true
    try {
      replaceDashboard(await api.getDashboard(state.projectRoot))
      if (!quiet) state.status = ''
    } catch (error: any) {
      console.error(error)
      if (!quiet) state.status = error?.message || '刷新失败。'
    } finally {
      state.autoRefreshing = false
    }
  }

  async function openRecordRoot(kind: 'data' | 'knowledge') {
    const api = ensureReady()
    const folderPath = kind === 'data'
      ? state.dashboard?.recordSummary?.dataRoot
      : state.dashboard?.recordSummary?.knowledgeRoot
    if (!api || !folderPath) throw new Error(kind === 'data' ? '数据层路径不存在' : '知识库路径不存在')
    await api.openFolderPath(folderPath)
  }

  function setupAutoRefresh() {
    if (!window.electronManager?.onProjectDataChanged) return
    stopAutoRefresh?.()
    stopAutoRefresh = window.electronManager.onProjectDataChanged((payload) => {
      if (!payload?.projectRoot || payload.projectRoot !== state.projectRoot || !state.initialized) return
      refreshDashboard({ quiet: true })
    })
  }

  onMounted(setupAutoRefresh)
  onBeforeUnmount(() => {
    stopAutoRefresh?.()
    stopAutoRefresh = null
  })

  return {
    ensureReady,
    runAction,
    restoreLastProject,
    loadRecentProjects,
    pickProject,
    openProject,
    removeRecentProject,
    initializeProject,
    refreshDashboard,
    openRecordRoot,
  }
}
