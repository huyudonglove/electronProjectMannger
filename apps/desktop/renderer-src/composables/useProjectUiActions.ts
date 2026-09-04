import type { Ref } from 'vue'
import type { AnyRecord } from '../utils/record-formatters'

type ProjectUiActionsOptions = {
  initialized: Readonly<Ref<boolean>>
  busy: Readonly<Ref<boolean>>
  dashboard: Readonly<Ref<AnyRecord | null>>
  projectOverlayOpen: Ref<boolean>
  runAction: (message: string, action: () => Promise<void>) => Promise<unknown>
  loadRecentProjects: () => Promise<void>
  pickProject: () => Promise<AnyRecord | null | undefined>
  applyProjectResult: (result: AnyRecord) => void
  openProject: (projectRoot: string) => Promise<void>
  removeRecentProjectRecord: (projectId: string) => Promise<void>
  initializeProject: () => Promise<void>
  openRecordRoot: (kind: 'data' | 'knowledge') => Promise<void>
  setStatus: (message: string) => void
  showToast: (message: string) => void
}

export function useProjectUiActions(options: ProjectUiActionsOptions) {
  const {
    initialized,
    busy,
    dashboard,
    projectOverlayOpen,
    runAction,
    loadRecentProjects,
    pickProject,
    applyProjectResult,
    openProject,
    removeRecentProjectRecord,
    initializeProject,
    openRecordRoot,
    setStatus,
    showToast,
  } = options

  async function openRecentProjects() {
    await runAction('正在读取最近项目...', async () => {
      await loadRecentProjects()
      projectOverlayOpen.value = true
      setStatus('')
    })
  }

  function closeRecentProjects() {
    if (busy.value) return
    projectOverlayOpen.value = false
  }

  async function openProjectPicker() {
    await runAction('正在打开项目选择器...', async () => {
      const result = await pickProject()
      if (!result) {
        setStatus('')
        return
      }
      projectOverlayOpen.value = false
      applyProjectResult(result)
      setStatus(initialized.value ? '' : '项目尚未初始化。')
    })
  }

  async function openProjectPath(nextProjectRoot: string) {
    await runAction('正在打开项目...', async () => {
      await openProject(nextProjectRoot)
      projectOverlayOpen.value = false
      setStatus(initialized.value ? '' : '项目尚未初始化。')
    })
  }

  async function removeRecentProject(projectId: string) {
    if (!String(projectId || '').trim()) {
      setStatus('项目 ID 不能为空。')
      return
    }
    await runAction('正在移除历史记录...', async () => {
      await removeRecentProjectRecord(projectId)
      setStatus('')
    })
  }

  async function initializeCurrentProject() {
    await runAction('正在初始化项目管理数据...', async () => {
      await initializeProject()
      setStatus('')
    })
  }

  async function openDataRoot() {
    await runAction('正在打开数据层...', async () => {
      await openRecordRoot('data')
      setStatus('')
    })
  }

  async function openKnowledgeRoot() {
    await runAction('正在打开知识库...', async () => {
      await openRecordRoot('knowledge')
      setStatus('')
    })
  }

  async function copyRecordSkill() {
    const skillPath = String(dashboard.value?.recordSummary?.recordSkillPath || '').trim()
    if (!initialized.value || !skillPath) return
    const instruction = `使用此 Skill：${skillPath}`
    try {
      await navigator.clipboard.writeText(instruction)
      showToast('Skill 已复制')
    } catch {
      showToast('复制失败')
    }
  }

  return {
    projectOverlayOpen,
    openRecentProjects,
    closeRecentProjects,
    openProjectPicker,
    openProjectPath,
    removeRecentProject,
    initializeCurrentProject,
    openDataRoot,
    openKnowledgeRoot,
    copyRecordSkill,
  }
}
