<script setup lang="ts">
import { computed, nextTick, onMounted, reactive } from 'vue'

type AnyRecord = Record<string, any>

declare global {
  interface Window {
    electronManager?: {
      openFolder: () => Promise<any>
      listRecentProjects: () => Promise<any[]>
      removeRecentProject: (projectId: string) => Promise<any[]>
      openPath: (projectRoot: string) => Promise<any>
      openFolderPath: (folderPath: string) => Promise<boolean>
      initProject: (projectRoot: string) => Promise<any>
      getDashboard: (projectRoot: string) => Promise<any>
      addTask: (projectRoot: string, payload: AnyRecord) => Promise<any>
      updateTaskStatus: (projectRoot: string, taskId: string, status: string) => Promise<any>
      deleteTask: (projectRoot: string, taskId: string) => Promise<any>
      addThought: (projectRoot: string, content: string) => Promise<any>
      deleteThought: (projectRoot: string, thoughtId: string) => Promise<any>
      addDialogue: (projectRoot: string, payload: AnyRecord) => Promise<any>
      replyOpenQuestion: (projectRoot: string, payload: AnyRecord) => Promise<any>
      onProjectDataChanged?: (callback: (payload: AnyRecord) => void) => () => void
    }
  }
}

const statusLabels: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  doing: 'Doing',
  done: 'Done',
  abandoned: 'Abandoned',
  inbox: 'Inbox',
  handled: 'Done',
}

const boardColumns = [
  ['todo', 'Todo'],
  ['doing', 'Doing'],
  ['done', 'Done'],
] as const

const icons: Record<string, string> = {
  archive: '<path d="M4 7h16" /><path d="M6 7v11h12V7" /><path d="M9 11h6" /><path d="M5 4h14v3H5z" />',
  bookOpen: '<path d="M12 7v14" /><path d="M3 18a1 1 0 0 1-1-1V5a2 2 0 0 1 2-2h5a3 3 0 0 1 3 3v15a3 3 0 0 0-3-3H3Z" /><path d="M21 18a1 1 0 0 0 1-1V5a2 2 0 0 0-2-2h-5a3 3 0 0 0-3 3" />',
  check: '<path d="m5 12 4 4L19 6" />',
  copy: '<path d="M8 8h11v11H8z" /><path d="M5 15H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1" />',
  cornerUpLeft: '<path d="m9 14-4-4 4-4" /><path d="M5 10h11a4 4 0 0 1 0 8h-1" />',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="3" />',
  fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" />',
  folderOpen: '<path d="M6 17a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1" /><path d="M4 15l2-5h14l-2 7a2 2 0 0 1-2 1H6a2 2 0 0 1-2-3Z" />',
  gitPullRequest: '<circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h3a2 2 0 0 1 2 2v7" /><path d="M6 9v12" />',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" />',
  layoutDashboard: '<rect width="7" height="9" x="3" y="3" rx="1" /><rect width="7" height="5" x="14" y="3" rx="1" /><rect width="7" height="9" x="14" y="12" rx="1" /><rect width="7" height="5" x="3" y="16" rx="1" />',
  listChecks: '<path d="m3 17 2 2 4-4" /><path d="m3 7 2 2 4-4" /><path d="M13 6h8" /><path d="M13 12h8" /><path d="M13 18h8" />',
  messageCircle: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />',
  messagesSquare: '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" /><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />',
  moon: '<path d="M20.99 13.03A8.5 8.5 0 1 1 10.97 3.01 6.8 6.8 0 0 0 20.99 13.03Z" />',
  panelRightClose: '<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M15 3v18" /><path d="m10 9-3 3 3 3" />',
  panelRightOpen: '<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M15 3v18" /><path d="m7 9 3 3-3 3" />',
  play: '<path d="M8 5v14l11-7Z" />',
  plus: '<path d="M12 5v14" /><path d="M5 12h14" />',
  refresh: '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M3 21v-5h5" /><path d="M3 12a9 9 0 0 1 15.74-6.26L21 8" /><path d="M16 8h5V3" />',
  rotateLeft: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" />',
  scrollText: '<path d="M8 21h8" /><path d="M12 21V7" /><path d="M16 7h3a2 2 0 0 1 2 2v8" /><path d="M8 7H5a2 2 0 0 0-2 2v8" /><path d="M7 3h10" /><path d="M7 7h10" />',
  slash: '<circle cx="12" cy="12" r="8" /><path d="M7 17 17 7" />',
  sun: '<circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />',
  trash: '<path d="M4 7h16" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" />',
  x: '<path d="M18 6 6 18" /><path d="m6 6 12 12" />',
}

const taskActionIcons: Record<string, string> = {
  abandoned: 'slash',
  doing: 'play',
  done: 'check',
  todo: 'cornerUpLeft',
}

const sections = [
  ['overview', '总览', 'layoutDashboard'],
  ['capture', '想法', 'messageCircle'],
  ['board', '任务', 'listChecks'],
  ['dialogues', '研究', 'messagesSquare'],
  ['collaboration', '协作', 'gitPullRequest'],
  ['agent-logs', '工作记录', 'scrollText'],
  ['knowledge', '知识库', 'bookOpen'],
  ['documents', '文档', 'fileText'],
] as const

const state = reactive({
  projectRoot: '',
  initialized: false,
  dashboard: null as AnyRecord | null,
  recentProjects: [] as AnyRecord[],
  projectOverlayOpen: false,
  doneExpanded: false,
  section: 'overview',
  busy: false,
  autoRefreshing: false,
  selectedLogIndex: 0,
  dialogueTocCollapsed: false,
  knowledgeTocCollapsed: false,
  quickOpen: false,
  quickCreateMode: '',
  replyItem: null as AnyRecord | null,
  status: '等待选择项目',
  theme: 'dark',
  toasts: [] as Array<{ id: number; message: string; leaving: boolean }>,
  highlightedTask: '',
  highlightedThought: '',
  highlightedDialogue: -1,
  highlightedKnowledge: -1,
  highlightedLog: -1,
})

const taskForm = reactive({ title: '', priority: 'medium', detail: '', acceptance: '', status: '' })
const thoughtForm = reactive({ content: '', status: '' })
const quickTaskForm = reactive({ title: '', priority: 'medium', detail: '', acceptance: '', status: '' })
const quickThoughtForm = reactive({ content: '', status: '' })
const quickDialogueForm = reactive({ content: '', acceptance: '', status: '' })
const replyForm = reactive({ answer: '', status: '' })

const taskRefs = new Map<string, Element>()
const thoughtRefs = new Map<string, Element>()
const dialogueRefs = new Map<number, Element>()
const knowledgeRefs = new Map<number, Element>()
const logRefs = new Map<number, Element>()

const dashboard = computed(() => state.dashboard)
const tasks = computed(() => dashboard.value?.tasks || [])
const thoughts = computed(() => dashboard.value?.thoughts || [])
const dialogues = computed(() => dashboard.value?.dialogues || [])
const knowledge = computed(() => dashboard.value?.knowledge || [])
const documents = computed(() => dashboard.value?.documents || [])
const logs = computed(() => dashboard.value?.logs || [])
const openQuestions = computed(() => dashboard.value?.openQuestions || [])
const replyRecords = computed(() => dashboard.value?.replyRecords || [])
const activeThemeIcon = computed(() => state.theme === 'dark' ? 'moon' : 'sun')
const visibleLog = computed(() => logs.value[clampLogIndex(state.selectedLogIndex, logs.value)])

const generatedAtText = computed(() => {
  if (!state.projectRoot) return '尚未读取'
  if (!state.initialized || !dashboard.value) return '尚未初始化'
  return `更新于 ${formatTime(dashboard.value.agentBrief?.generatedAt)}`
})

const statusTitle = computed(() => {
  if (!state.projectRoot) return '选择任意项目开始'
  if (!state.initialized || !dashboard.value) return '项目尚未初始化'
  return dashboard.value.config?.name || projectDisplayName(state.projectRoot)
})

const statusDescription = computed(() => {
  if (!state.projectRoot) return '选择项目文件夹后，会创建 Markdown 主数据、JSON 同步包和本地协作 skill。'
  if (!state.initialized || !dashboard.value) return ''
  return ''
})

const groupedDocuments = computed(() => groupDocumentsByFolder(documents.value))

onMounted(() => {
  applyTheme(localStorage.getItem('electron-manager-theme') || 'dark')
  setupAutoRefresh()
  const initialSection = location.hash.replace('#', '') || 'overview'
  setActiveSection(initialSection)
  if (window.electronManager) {
    restoreLastProject()
  } else {
    state.status = 'preload API 未注入，请重新启动 Electron。'
  }
})

function icon(name: string) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[name] || icons.check}</svg>`
}

function setActiveSection(section: string) {
  state.section = sections.some(([key]) => key === section) ? section : 'overview'
  history.replaceState(null, '', `#${state.section}`)
}

function setupAutoRefresh() {
  if (!window.electronManager?.onProjectDataChanged) return
  window.electronManager.onProjectDataChanged((payload) => {
    if (!payload?.projectRoot || payload.projectRoot !== state.projectRoot || !state.initialized) return
    refreshDashboard({ quiet: true })
  })
}

async function runAction(message: string, action: () => Promise<void>) {
  try {
    state.busy = true
    state.status = message
    await action()
  } catch (error: any) {
    console.error(error)
    state.status = error?.message || '操作失败。'
  } finally {
    state.busy = false
  }
}

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

async function restoreLastProject() {
  await runAction('正在读取最近项目...', async () => {
    const api = ensureApi()
    state.recentProjects = sortRecentProjects(await api.listRecentProjects())
    const latestProject = state.recentProjects[0]
    if (!latestProject) {
      state.status = '等待选择项目'
      return
    }
    updateState(await api.openPath(latestProject.projectRoot))
    state.status = state.initialized ? '' : '项目尚未初始化。'
  })
}

async function openRecentProjects() {
  await runAction('正在读取最近项目...', async () => {
    const api = ensureApi()
    state.recentProjects = sortRecentProjects(await api.listRecentProjects())
    state.projectOverlayOpen = true
    state.status = ''
  })
}

function closeRecentProjects() {
  state.projectOverlayOpen = false
}

async function openProjectPicker() {
  await runAction('正在打开项目选择器...', async () => {
    const api = ensureApi()
    const result = await api.openFolder()
    if (!result) {
      state.status = ''
      return
    }
    state.projectOverlayOpen = false
    updateState(result)
    state.status = state.initialized ? '' : '项目尚未初始化。'
  })
}

async function openProjectPath(projectRoot: string) {
  await runAction('正在打开项目...', async () => {
    const api = ensureApi()
    state.projectOverlayOpen = false
    updateState(await api.openPath(projectRoot))
    state.recentProjects = sortRecentProjects(await api.listRecentProjects())
    state.status = state.initialized ? '' : '项目尚未初始化。'
  })
}

async function removeRecentProject(projectId: string) {
  await runAction('正在移除历史记录...', async () => {
    const api = ensureApi()
    state.recentProjects = sortRecentProjects(await api.removeRecentProject(projectId))
    state.status = ''
  })
}

async function initializeCurrentProject() {
  await runAction('正在初始化项目管理数据...', async () => {
    const api = ensureReadyForInit()
    updateState({ initialized: true, projectRoot: state.projectRoot, dashboard: await api.initProject(state.projectRoot) })
    state.status = ''
  })
}

async function refreshDashboard({ quiet = false } = {}) {
  const api = ensureReady()
  if (!api || state.autoRefreshing) return
  state.autoRefreshing = true
  try {
    updateDashboard(await api.getDashboard(state.projectRoot))
    if (!quiet) state.status = ''
  } catch (error: any) {
    console.error(error)
    if (!quiet) state.status = error?.message || '刷新失败。'
  } finally {
    state.autoRefreshing = false
  }
}

async function openDataRoot() {
  await runAction('正在打开数据层...', async () => {
    const api = ensureReady()
    const folderPath = dashboard.value?.agentBrief?.dataRoot
    if (!api || !folderPath) throw new Error('数据层路径不存在')
    await api.openFolderPath(folderPath)
    state.status = ''
  })
}

async function copyBrief() {
  const briefText = syncEntryText(dashboard.value?.agentBrief)
  if (!state.initialized || !briefText.trim()) return
  try {
    await navigator.clipboard.writeText(briefText)
    showToast('已复制')
  } catch {
    showToast('复制失败')
  }
}

async function createTask(source: 'main' | 'quick') {
  const form = source === 'main' ? taskForm : quickTaskForm
  await runAction('正在新增任务...', async () => {
    const api = ensureReady()
    if (!api) return
    const normalizedTitle = form.title.trim()
    if (!normalizedTitle) {
      form.status = '先写任务标题'
      return
    }
    form.status = '保存中...'
    updateDashboard(await api.addTask(state.projectRoot, {
      title: normalizedTitle,
      status: 'todo',
      priority: form.priority,
      area: 'tool',
      userOriginal: normalizedTitle,
      agentUnderstanding: '由 Electron Manager 新增。',
      executionScope: form.detail.trim() || '待补充。',
      acceptance: form.acceptance.trim() || '待补充。',
      openQuestions: '无。',
    }))
    form.title = ''
    form.detail = ''
    form.acceptance = ''
    form.priority = 'medium'
    form.status = ''
    if (source === 'quick') closeQuickTask()
    showToast('已保存')
    state.status = ''
  })
}

async function saveThought(source: 'main' | 'quick') {
  const form = source === 'main' ? thoughtForm : quickThoughtForm
  await runAction('正在保存输入...', async () => {
    const api = ensureReady()
    if (!api) return
    const content = form.content.trim()
    if (!content) {
      form.status = '先写一点内容'
      return
    }
    form.status = '保存中...'
    updateDashboard(await api.addThought(state.projectRoot, content))
    form.content = ''
    form.status = ''
    if (source === 'quick') closeQuickTask()
    showToast('已保存')
    state.status = ''
  })
}

async function saveDialogue() {
  await runAction('正在记录研究...', async () => {
    const api = ensureReady()
    if (!api) return
    const content = quickDialogueForm.content.trim()
    if (!content) {
      quickDialogueForm.status = '先写一点内容'
      return
    }
    quickDialogueForm.status = '保存中...'
    updateDashboard(await api.addDialogue(state.projectRoot, {
      content,
      acceptance: quickDialogueForm.acceptance,
    }))
    quickDialogueForm.content = ''
    quickDialogueForm.acceptance = ''
    quickDialogueForm.status = ''
    closeQuickTask()
    showToast('已保存')
    state.status = ''
  })
}

async function deleteThought(thoughtId: string) {
  await runAction('正在删除输入...', async () => {
    const api = ensureReady()
    if (!api) return
    updateDashboard(await api.deleteThought(state.projectRoot, thoughtId))
    state.status = ''
  })
}

async function deleteTask(taskId: string) {
  if (!confirm('删除这张任务卡？')) return
  await runAction('正在删除任务...', async () => {
    const api = ensureReady()
    if (!api) return
    updateDashboard(await api.deleteTask(state.projectRoot, taskId))
    state.status = ''
  })
}

async function updateTaskStatus(taskId: string, status: string) {
  await runAction('正在更新任务状态...', async () => {
    const api = ensureReady()
    if (!api) return
    updateDashboard(await api.updateTaskStatus(state.projectRoot, taskId, status))
    state.status = ''
  })
}

function openReplyDialog(item: AnyRecord) {
  state.replyItem = item
  replyForm.answer = ''
  replyForm.status = ''
}

function closeReplyDialog() {
  state.replyItem = null
  replyForm.answer = ''
  replyForm.status = ''
}

async function submitReply() {
  const item = state.replyItem
  if (!item) return
  await runAction('正在保存回复...', async () => {
    const api = ensureReady()
    if (!api) return
    const answer = replyForm.answer.trim()
    if (!answer) {
      replyForm.status = '先写回复'
      return
    }
    replyForm.status = '保存中...'
    updateDashboard(await api.replyOpenQuestion(state.projectRoot, {
      questionId: item.id,
      source: item.source,
      shortId: item.shortId,
      thoughtId: item.thoughtId,
      title: item.title,
      openQuestions: item.openQuestions,
      answer,
    }))
    closeReplyDialog()
    state.status = ''
  })
}

function updateState(result: AnyRecord) {
  state.projectRoot = result.projectRoot
  state.initialized = result.initialized
  state.dashboard = result.dashboard
  state.selectedLogIndex = clampLogIndex(state.selectedLogIndex, result.dashboard?.logs || [])
}

function updateDashboard(nextDashboard: AnyRecord) {
  state.initialized = true
  state.dashboard = nextDashboard
  state.selectedLogIndex = clampLogIndex(state.selectedLogIndex, nextDashboard.logs || [])
}

function toggleTheme() {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark')
  localStorage.setItem('electron-manager-theme', state.theme)
}

function applyTheme(theme: string) {
  state.theme = theme === 'light' ? 'light' : 'dark'
  document.body.dataset.theme = state.theme
}

function openQuickMenu() {
  state.quickOpen = !state.quickOpen
  if (!state.quickOpen) state.quickCreateMode = ''
}

function selectQuickCreate(kind: string) {
  state.quickCreateMode = kind
}

function closeQuickTask() {
  state.quickOpen = false
  state.quickCreateMode = ''
}

function showToast(message: string) {
  if (!message) return
  const toast = { id: Date.now() + Math.random(), message, leaving: false }
  state.toasts.push(toast)
  window.setTimeout(() => { toast.leaving = true }, 1800)
  window.setTimeout(() => {
    state.toasts = state.toasts.filter((item) => item.id !== toast.id)
  }, 2200)
}

function setTaskRef(taskId: string, el: Element | null) {
  if (el) taskRefs.set(taskId, el)
  else taskRefs.delete(taskId)
}

function setThoughtRef(thoughtId: string, el: Element | null) {
  if (el) thoughtRefs.set(thoughtId, el)
  else thoughtRefs.delete(thoughtId)
}

function setDialogueRef(index: number, el: Element | null) {
  if (el) dialogueRefs.set(index, el)
  else dialogueRefs.delete(index)
}

function setKnowledgeRef(index: number, el: Element | null) {
  if (el) knowledgeRefs.set(index, el)
  else knowledgeRefs.delete(index)
}

function setLogRef(index: number, el: Element | null) {
  if (el) logRefs.set(index, el)
  else logRefs.delete(index)
}

async function scrollToRef(refs: Map<any, Element>, key: any, highlight: () => void, clear: () => void, delay = 1600) {
  await nextTick()
  const target = refs.get(key)
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  highlight()
  window.setTimeout(clear, delay)
}

function openBoardTask(taskId: string) {
  setActiveSection('board')
  scrollToRef(taskRefs, taskId, () => { state.highlightedTask = taskId }, () => { state.highlightedTask = '' })
}

function openThought(thoughtId: string) {
  setActiveSection('capture')
  scrollToRef(thoughtRefs, thoughtId, () => { state.highlightedThought = thoughtId }, () => { state.highlightedThought = '' })
}

function openDialogue(index: number) {
  scrollToRef(dialogueRefs, index, () => { state.highlightedDialogue = index }, () => { state.highlightedDialogue = -1 })
}

function openKnowledge(index: number) {
  scrollToRef(knowledgeRefs, index, () => { state.highlightedKnowledge = index }, () => { state.highlightedKnowledge = -1 })
}

function openAgentLog(index: number) {
  state.selectedLogIndex = clampLogIndex(Number(index || 0), logs.value)
  scrollToRef(logRefs, state.selectedLogIndex, () => { state.highlightedLog = state.selectedLogIndex }, () => { state.highlightedLog = -1 }, 1800)
}

function openQuestionTarget(item: AnyRecord) {
  if (item.source === 'log') {
    setActiveSection('agent-logs')
    openAgentLog(item.logIndex || 0)
  } else if (item.source === 'thought') {
    openThought(item.thoughtId || findThoughtIdByShortId(item.shortId))
  } else {
    openBoardTask(findTaskIdByShortId(item.shortId))
  }
}

function boardItems(status: string) {
  const allItems = tasks.value.filter((task: AnyRecord) => task.status === status)
  return status === 'done' && !state.doneExpanded ? allItems.slice(0, 6) : allItems
}

function hiddenDoneCount(status: string) {
  if (status !== 'done') return 0
  return tasks.value.filter((task: AnyRecord) => task.status === 'done').length - boardItems(status).length
}

function taskActions(task: AnyRecord) {
  if (task.status === 'todo') {
    return [
      { status: 'doing', label: '开始' },
      { status: 'done', label: '完成' },
      { status: 'abandoned', label: 'Abandon' },
    ]
  }
  if (task.status === 'doing') {
    return [
      { status: 'done', label: '完成' },
      { status: 'todo', label: '退回' },
      { status: 'abandoned', label: 'Abandon' },
    ]
  }
  if (task.status === 'done') return [{ status: 'todo', label: '重开' }]
  if (task.status === 'backlog') return [{ status: 'todo', label: '移入待办' }]
  if (task.status === 'abandoned') return [{ status: 'todo', label: '恢复' }]
  return []
}

function boardSummaryParts() {
  const backlog = tasks.value.filter((task: AnyRecord) => task.status === 'backlog').length
  const abandoned = tasks.value.filter((task: AnyRecord) => task.status === 'abandoned').length
  return [
    backlog ? `Backlog ${backlog}` : '',
    abandoned ? `Abandoned ${abandoned}` : '',
  ].filter(Boolean)
}

function thoughtDisplayTitle(thought: AnyRecord) {
  const title = String(thought.title || '').replace(/\s*想法\s*$/, '').trim()
  return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2})?$/.test(title) ? '' : title
}

function dialogueDisplayTitle(dialogue: AnyRecord) {
  return firstMeaningfulLine(dialogue.recordContent || dialogue.answer || dialogue.title || '') || dialogueTitle(dialogue)
}

function dialogueTitle(dialogue: AnyRecord) {
  return String(dialogue.title || '').replace(/^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2})?\s*/, '').trim() || '研究'
}

function dialogueTocSummary(dialogue: AnyRecord) {
  const answer = String(dialogue.answer || '').replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim()
  const summary = answer || String(dialogue.recordContent || '').replace(/\s+/g, ' ').trim()
  return summary.length > 44 ? `${summary.slice(0, 44).trimEnd()}...` : summary || formatTime(dialogue.created)
}

function dialogueRefsList(dialogue: AnyRecord) {
  return [...(dialogue.relatedTasks || []), ...(dialogue.relatedThoughts || []), ...(dialogue.tags || []).map((tag: string) => `#${tag}`)]
}

function resolveLogTasks(log: AnyRecord) {
  return (log.relatedTasks || []).map((task: AnyRecord) => {
    const matched = tasks.value.find((item: AnyRecord) => item.shortId === task.shortId)
    return {
      shortId: task.shortId || matched?.shortId || '',
      id: task.id || matched?.id || '',
      title: task.title || matched?.title || '',
      status: task.status || matched?.status || '',
    }
  })
}

function primaryLogPrompt(log: AnyRecord) {
  return log.userGoal || log.userOriginal || log.answer || log.title
}

function knowledgeDisplayTitle(note: AnyRecord) {
  return knowledgeFocusHeading(note.content) || knowledgeSummaryHeadline(note.summary, note.title) || note.title
}

function knowledgeFocusHeading(content: string) {
  const genericHeadings = new Set(['项目', '概览', '总览', '背景', '目标', '目录', '说明', '知识结构'])
  const headings = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^#{2,3}\s+(.+)$/)?.[1]?.trim())
    .filter(Boolean) as string[]
  return headings.find((heading) => !genericHeadings.has(heading)) || headings[0] || ''
}

function knowledgeSummaryHeadline(summary: string, fallbackTitle: string) {
  const text = String(summary || '').trim()
  if (!text || text === fallbackTitle || /^[-*]\s+/.test(text)) return ''
  return text.split(/[。.!！\n]/).map((item) => item.trim()).find(Boolean) || ''
}

function knowledgeTocSummary(note: AnyRecord, displayTitle: string) {
  if (displayTitle !== note.title) return note.title
  return note.summary || noteCategory(note.path)
}

function knowledgeDisplaySummary(note: AnyRecord, displayTitle: string) {
  const summary = String(note.summary || '').trim()
  if (isUsefulKnowledgeSummary(summary, note.title)) return summary
  return knowledgeSectionSummary(note.content, displayTitle) || summary || '暂无摘要。'
}

function isUsefulKnowledgeSummary(summary: string, title: string) {
  if (!summary || summary === title) return false
  if (/^- 名称[:：]/.test(summary)) return false
  if (/数据层[:：]/.test(summary) && summary.length < 80) return false
  return true
}

function knowledgeSectionSummary(content: string, heading: string) {
  if (!heading) return ''
  const lines = String(content || '').split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === `## ${heading}` || line.trim() === `### ${heading}`)
  if (start < 0) return ''
  const sectionLines = []
  for (const line of lines.slice(start + 1)) {
    if (/^#{2,3}\s+/.test(line.trim())) break
    const normalized = line.trim().replace(/^[-*]\s+/, '')
    if (normalized) sectionLines.push(normalized)
    if (sectionLines.length >= 3) break
  }
  return sectionLines.join(' ')
}

function knowledgeBodyContent(content: string) {
  const lines = String(content || '').split(/\r?\n/)
  const firstSectionIndex = lines.findIndex((line) => /^##\s+/.test(line.trim()))
  if (firstSectionIndex >= 0) return lines.slice(firstSectionIndex).join('\n').trim()
  return lines.filter((line) => !/^#\s+/.test(line.trim()) && !/^[A-Za-z0-9_-]+::\s*/.test(line.trim())).join('\n').trim()
}

function validRefs(refs = [] as any[]) {
  const seen = new Set()
  return refs
    .map((ref) => String(ref || '').trim())
    .filter((ref) => ref && !/^(?:无|暂无|没有|none|n\/a)[。.!！]?$/i.test(ref))
    .filter((ref) => {
      const key = ref.toUpperCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function groupDocumentsByFolder(items: AnyRecord[]) {
  return items.reduce((groups: Record<string, AnyRecord[]>, note) => {
    const folder = note.folder || '根目录'
    groups[folder] = groups[folder] || []
    groups[folder].push(note)
    return groups
  }, {})
}

function findTaskIdByShortId(shortId: string) {
  return tasks.value.find((task: AnyRecord) => task.shortId === shortId)?.id || ''
}

function findThoughtIdByShortId(shortId: string) {
  return thoughts.value.find((thought: AnyRecord) => thought.shortId === shortId)?.id || ''
}

function statusText(status: string) {
  return statusLabels[status] || String(status || 'Todo')
}

function statusBadgeClass(status: string) {
  if (status === 'done') return ''
  if (status === 'doing') return 'warning-badge'
  if (status === 'abandoned') return 'danger-badge'
  return 'muted-badge'
}

function priorityClass(priority: string) {
  if (priority === 'high') return 'danger-badge'
  if (priority === 'low') return 'muted-badge'
  return ''
}

function knowledgeStatusText(status: string) {
  return {
    active: '生效中',
    archived: '已归档',
    draft: '草稿',
  }[status] || status || '生效中'
}

function renderTextBlock(value: string) {
  const paragraphs = String(value || '').split(/\n{2,}/).map((text) => text.trim()).filter(Boolean)
  return paragraphs.length ? paragraphs.map((text) => `<p>${text.split('\n').map(renderInlineMarkdown).join('<br>')}</p>`).join('') : ''
}

function renderListTextBlock(value: string) {
  const lines = String(value || '').split('\n').map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return ''
  if (lines.some((line) => /^[-*]\s+/.test(line))) {
    return `<ul>${lines.map((line) => `<li>${renderInlineMarkdown(line.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`
  }
  return renderTextBlock(value)
}

function renderReadableMarkdown(markdown: string) {
  const lines = String(markdown || '').split(/\r?\n/)
  const html: string[] = []
  let listOpen = false
  let codeOpen = false
  let codeLanguage = ''
  let codeLines: string[] = []
  const closeList = () => {
    if (listOpen) {
      html.push('</ul>')
      listOpen = false
    }
  }
  const closeCode = () => {
    if (!codeOpen) return
    html.push(`<pre${codeLanguage ? ` data-language="${escapeHtml(codeLanguage)}"` : ''}><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
    codeOpen = false
    codeLanguage = ''
    codeLines = []
  }
  for (const rawLine of lines) {
    const fence = rawLine.trim().match(/^```([A-Za-z0-9_-]+)?\s*$/)
    if (fence) {
      if (codeOpen) closeCode()
      else {
        closeList()
        codeOpen = true
        codeLanguage = fence[1] || ''
        codeLines = []
      }
      continue
    }
    if (codeOpen) {
      codeLines.push(rawLine)
      continue
    }
    const line = rawLine.trim()
    if (!line) {
      closeList()
      continue
    }
    const heading = line.match(/^(#{2,4})\s+(.+)$/)
    if (heading) {
      closeList()
      const level = heading[1].length === 2 ? 'h4' : 'h5'
      html.push(`<${level}>${escapeHtml(heading[2])}</${level}>`)
      continue
    }
    const field = line.match(/^([A-Za-z0-9_-]+)::\s*(.+)$/)
    if (field) {
      closeList()
      html.push(`<p class="log-meta-line"><span>${escapeHtml(field[1])}</span>${escapeHtml(field[2])}</p>`)
      continue
    }
    const item = line.match(/^[-*]\s+(.+)$/)
    if (item) {
      if (!listOpen) {
        html.push('<ul>')
        listOpen = true
      }
      html.push(`<li>${renderInlineMarkdown(item[1])}</li>`)
      continue
    }
    closeList()
    html.push(`<p>${renderInlineMarkdown(line)}</p>`)
  }
  closeList()
  closeCode()
  return html.join('') || '<p class="empty">暂无内容</p>'
}

function renderInlineMarkdown(value: string) {
  return escapeHtml(value).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function firstMeaningfulLine(value: string) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/^```/.test(line) && !/^#{1,6}\s+/.test(line) && !/^[-*]\s+/.test(line) && !/^[A-Za-z0-9_-]+::\s*/.test(line))
    || ''
}

function noteCategory(filePath: string) {
  if (filePath.startsWith('00_')) return '项目管理'
  if (filePath.startsWith('01_')) return '知识结构'
  if (filePath.startsWith('02_')) return '运行说明'
  if (filePath.startsWith('03_')) return '可视化入口'
  if (filePath.startsWith('04_')) return '记录'
  return '文档'
}

function syncEntryText(brief: AnyRecord) {
  if (!brief?.dataRoot) return ''
  return '请读取当前项目的 .agent-collaboration.md，并按其中指向的 Electron Manager 文件建立上下文和协作规则。'
}

function sortRecentProjects(projects = [] as AnyRecord[]) {
  return projects.slice().sort((a, b) => String(b.lastOpenedAt || b.createdAt || '').localeCompare(String(a.lastOpenedAt || a.createdAt || '')))
}

function projectDisplayName(projectRoot: string) {
  return String(projectRoot || '').split(/[\\/]/).filter(Boolean).at(-1) || projectRoot
}

function formatTime(value: string) {
  if (!value) return '未知时间'
  const date = parseDisplayDate(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function parseDisplayDate(value: any) {
  if (value instanceof Date) return value
  const text = String(value || '').trim()
  const localMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/)
  if (localMatch && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
    return new Date(Number(localMatch[1]), Number(localMatch[2]) - 1, Number(localMatch[3]), Number(localMatch[4] || 0), Number(localMatch[5] || 0))
  }
  return new Date(text)
}

function clampLogIndex(index: number, items = [] as AnyRecord[]) {
  if (!items.length) return 0
  if (!Number.isFinite(index)) return 0
  return Math.min(Math.max(index, 0), items.length - 1)
}

function escapeHtml(value: any) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}
</script>

<template>
  <main class="page-shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="mark">E</span>
        <div>
          <strong>Agent Manager</strong>
          <small>Local Project Hub</small>
        </div>
      </div>
      <nav>
        <a
          v-for="[key, label, iconName] in sections"
          :key="key"
          :href="`#${key}`"
          :class="{ active: state.section === key }"
          @click.prevent="setActiveSection(key)"
        >
          <span class="nav-icon" v-html="icon(iconName)" />
          <span>{{ label }}</span>
          <span v-if="key === 'collaboration' && openQuestions.length" class="nav-count">{{ openQuestions.length }}</span>
        </a>
      </nav>
      <div class="sidebar-footer">
        <button class="theme-toggle" type="button" :aria-pressed="state.theme === 'dark'" :title="state.theme === 'dark' ? '切换亮色模式' : '切换暗色模式'" @click="toggleTheme">
          <span class="theme-toggle-icon" v-html="icon(activeThemeIcon)" />
          <span class="theme-toggle-label">{{ state.theme === 'dark' ? '暗色' : '亮色' }}</span>
        </button>
      </div>
    </aside>

    <section class="content">
      <header class="topbar">
        <div>
          <p class="eyebrow" aria-hidden="true"></p>
          <small>{{ state.status }}</small>
        </div>
        <div class="topbar-actions">
          <button class="btn icon-button btn-outline-primary" type="button" title="打开项目" aria-label="打开项目" :disabled="state.busy" @click="openRecentProjects" v-html="icon('history')" />
          <button class="btn icon-button btn-ghost" type="button" title="手动刷新" aria-label="手动刷新" :disabled="state.busy || !state.initialized" @click="refreshDashboard({ quiet: false })" v-html="icon('refresh')" />
        </div>
      </header>

      <section id="overview" class="section view" :class="{ 'active-view': state.section === 'overview' }">
        <div class="section-head">
          <h2>总览</h2>
          <span>{{ generatedAtText }}</span>
        </div>
        <section class="card status-panel">
          <span v-if="!state.projectRoot" class="badge">Ready</span>
          <h2>{{ statusTitle }}</h2>
          <p v-if="statusDescription">{{ statusDescription }}</p>
        </section>
        <div class="stats">
          <article class="card stat">
            <div class="stat-head"><span class="stat-icon" v-html="icon('listChecks')" /><span>任务</span></div>
            <strong>{{ tasks.length }}</strong>
          </article>
          <article class="card stat">
            <div class="stat-head"><span class="stat-icon" v-html="icon('messageCircle')" /><span>想法</span></div>
            <strong>{{ thoughts.length }}</strong>
          </article>
          <article class="card stat">
            <div class="stat-head"><span class="stat-icon" v-html="icon('messagesSquare')" /><span>研究</span></div>
            <strong>{{ dialogues.length }}</strong>
          </article>
          <article class="card stat">
            <div class="stat-head"><span class="stat-icon" v-html="icon('bookOpen')" /><span>知识</span></div>
            <strong>{{ knowledge.length }}</strong>
          </article>
          <article class="card stat">
            <div class="stat-head"><span class="stat-icon" v-html="icon('gitPullRequest')" /><span>未确认</span></div>
            <strong>{{ openQuestions.length }}</strong>
          </article>
          <article class="card stat">
            <div class="stat-head"><span class="stat-icon" v-html="icon('scrollText')" /><span>记录</span></div>
            <strong>{{ logs.length }}</strong>
          </article>
        </div>
        <div class="card paths">
          <div>
            <span>当前项目</span>
            <code>{{ state.projectRoot ? projectDisplayName(state.projectRoot) : '尚未打开项目' }}</code>
          </div>
          <div>
            <span>数据层</span>
            <div class="path-value">
              <code>{{ dashboard?.agentBrief?.dataRoot || '初始化后显示' }}</code>
              <button class="btn icon-button btn-outline-secondary btn-sm" type="button" title="打开数据层文件夹" aria-label="打开数据层文件夹" :disabled="state.busy || !state.initialized || !dashboard?.agentBrief?.dataRoot" @click="openDataRoot" v-html="icon('folderOpen')" />
            </div>
          </div>
        </div>
        <div class="card agent-sync-card">
          <div class="agent-sync-head">
            <div><span class="badge">Agent 同步</span></div>
            <div class="agent-sync-actions">
              <button class="btn icon-button btn-outline-primary btn-sm" type="button" title="复制同步" aria-label="复制同步" :disabled="state.busy || !state.initialized" @click="copyBrief" v-html="icon('copy')" />
            </div>
          </div>
          <p class="brief-summary">{{ dashboard?.agentBrief ? '复制给新 Agent 的同步指令' : '打开项目后显示同步入口。' }}</p>
          <small></small>
        </div>
      </section>

      <section id="capture" class="section view" :class="{ 'active-view': state.section === 'capture' }">
        <div class="section-head"><h2>想法</h2><span></span></div>
        <div class="thoughts">
          <p v-if="!thoughts.length" class="empty-panel">暂无想法</p>
          <article
            v-for="thought in thoughts"
            :key="thought.id || thought.shortId"
            :ref="(el) => setThoughtRef(thought.id || thought.shortId || '', el as Element | null)"
            class="card thought"
            :class="{ 'thought-highlight': state.highlightedThought === (thought.id || thought.shortId) }"
          >
            <div class="thought-header">
              <div class="thought-title">
                <div class="thought-title-row">
                  <span v-if="thought.shortId" class="thought-short-id">{{ thought.shortId }}</span>
                  <strong v-if="thoughtDisplayTitle(thought)">{{ thoughtDisplayTitle(thought) }}</strong>
                  <span class="badge" :class="statusBadgeClass(thought.status)">{{ statusText(thought.status) }}</span>
                </div>
              </div>
              <button class="btn icon-button btn-outline-secondary btn-sm" type="button" title="删除输入" aria-label="删除输入" @click="deleteThought(thought.id)" v-html="icon('trash')" />
            </div>
            <p>{{ thought.content }}</p>
            <div v-if="thought.answer" class="answer"><span>摘要</span><p>{{ thought.answer }}</p></div>
            <small>{{ formatTime(thought.created) || '未标注日期' }}</small>
          </article>
        </div>
      </section>

      <section id="board" class="section view" :class="{ 'active-view': state.section === 'board' }">
        <div class="section-head"><h2>任务</h2><span></span></div>
        <div class="board-summary"><span v-for="part in boardSummaryParts()" :key="part">{{ part }}</span></div>
        <div class="board">
          <section v-for="[status, label] in boardColumns" :key="status" class="card column">
            <div class="column-head"><h3>{{ label }}</h3><span class="badge">{{ tasks.filter((task: AnyRecord) => task.status === status).length }}</span></div>
            <div class="tasks">
              <p v-if="!boardItems(status).length" class="empty">暂无任务</p>
              <article
                v-for="task in boardItems(status)"
                :key="task.id"
                :ref="(el) => setTaskRef(task.id, el as Element | null)"
                class="task"
                :class="{ done: task.status === 'done', 'task-highlight': state.highlightedTask === task.id }"
              >
                <div class="task-head">
                  <div class="task-title"><span v-if="task.shortId" class="task-short-id">{{ task.shortId }}</span><span>{{ task.title }}</span></div>
                  <button class="btn icon-button btn-outline-secondary btn-sm task-delete-button" type="button" title="删除任务" aria-label="删除任务" @click="deleteTask(task.id)" v-html="icon('trash')" />
                </div>
                <div class="task-meta">
                  <span class="badge" :class="priorityClass(task.priority)">{{ task.priority || 'medium' }}</span>
                  <span class="badge muted-badge">{{ task.area || 'tool' }}</span>
                  <span class="badge" :class="statusBadgeClass(task.status)">{{ statusText(task.status) }}</span>
                </div>
                <p v-if="task.detail">{{ String(task.detail).slice(0, 180) }}</p>
                <div class="task-actions">
                  <button v-for="action in taskActions(task)" :key="action.status" class="btn icon-button btn-outline-secondary btn-sm" type="button" :title="action.label" :aria-label="action.label" @click="updateTaskStatus(task.id, action.status)" v-html="icon(taskActionIcons[action.status] || 'check')" />
                </div>
              </article>
              <button v-if="status === 'done' && tasks.filter((task: AnyRecord) => task.status === 'done').length > 6" class="done-toggle" type="button" @click="state.doneExpanded = !state.doneExpanded">
                {{ state.doneExpanded ? '收起已完成任务' : `展开 ${hiddenDoneCount(status)} 个已完成任务` }}
              </button>
            </div>
          </section>
        </div>
      </section>

      <section id="dialogues" class="section view" :class="{ 'active-view': state.section === 'dialogues' }">
        <div class="section-head"><h2>研究</h2><span></span></div>
        <div class="dialogue-layout" :class="{ 'toc-collapsed': state.dialogueTocCollapsed }">
          <p v-if="!dialogues.length" class="empty-panel">暂无研究。</p>
          <template v-else>
            <div class="dialogue-list-wrap">
              <div class="dialogue-list-spacer" aria-hidden="true"></div>
              <div class="dialogue-list">
                <article
                  v-for="(dialogue, index) in dialogues"
                  :key="dialogue.id || dialogue.shortId || index"
                  :ref="(el) => setDialogueRef(index, el as Element | null)"
                  class="card dialogue"
                  :class="{ 'dialogue-highlight': state.highlightedDialogue === index }"
                >
                  <div class="dialogue-head">
                    <div><span class="task-short-id">{{ dialogue.shortId || 'D000' }}</span><strong>{{ dialogueDisplayTitle(dialogue) }}</strong></div>
                    <div class="dialogue-actions"><small>{{ formatTime(dialogue.created) }}</small></div>
                  </div>
                  <section v-if="dialogue.recordContent" class="dialogue-block dialogue-prompt"><strong>内容</strong><p>{{ dialogue.recordContent }}</p></section>
                  <section class="dialogue-block dialogue-answer">
                    <div class="dialogue-block-head"><strong>回答</strong><span>Agent</span></div>
                    <div class="rendered-markdown" v-html="renderReadableMarkdown(dialogue.answer || '暂无。')" />
                  </section>
                  <section class="dialogue-block dialogue-meta-block"><strong>验收标准</strong><p>{{ dialogue.acceptance || '无。' }}</p></section>
                  <div v-if="dialogueRefsList(dialogue).length" class="dialogue-relations"><span v-for="ref in dialogueRefsList(dialogue)" :key="ref" class="badge muted-badge">{{ ref }}</span></div>
                </article>
              </div>
            </div>
            <aside class="dialogue-index" :class="{ 'is-collapsed': state.dialogueTocCollapsed }">
              <div class="section-head compact-head dialogue-index-head">
                <h2>{{ state.dialogueTocCollapsed ? '' : '目录' }}</h2>
                <button class="btn icon-button btn-outline-secondary btn-sm" type="button" :title="state.dialogueTocCollapsed ? '展开目录' : '收起目录'" :aria-label="state.dialogueTocCollapsed ? '展开目录' : '收起目录'" @click="state.dialogueTocCollapsed = !state.dialogueTocCollapsed" v-html="icon(state.dialogueTocCollapsed ? 'panelRightOpen' : 'panelRightClose')" />
              </div>
              <div v-if="!state.dialogueTocCollapsed" class="dialogue-toc">
                <button v-for="(dialogue, index) in dialogues" :key="dialogue.id || index" class="dialogue-toc-item" type="button" @click="openDialogue(index)">
                  <span>{{ dialogue.shortId || 'D000' }}</span>
                  <strong>{{ dialogueDisplayTitle(dialogue) }}</strong>
                  <small>{{ dialogueTocSummary(dialogue) }}</small>
                </button>
              </div>
            </aside>
          </template>
        </div>
      </section>

      <section id="collaboration" class="section view" :class="{ 'active-view': state.section === 'collaboration' }">
        <div class="section-head"><h2>协作</h2><span></span></div>
        <div>
          <div class="collab-open-questions">
            <p v-if="!openQuestions.length" class="empty-panel">暂无待确认</p>
            <section v-else class="card collab-open-panel">
              <div class="collab-open-head"><div><span class="badge warning-badge">待确认</span></div><span class="collab-open-count">{{ openQuestions.length }}</span></div>
              <div class="collab-open-list">
                <article v-for="(item, index) in openQuestions" :key="item.id || index" class="collab-open-item">
                  <div class="collab-card-top-right">
                    <span v-for="relation in item.relations || []" :key="relation" class="badge muted-badge">{{ relation }}</span>
                    <button class="btn icon-button btn-outline-secondary btn-sm" type="button" title="查看" aria-label="查看" @click="openQuestionTarget(item)" v-html="icon('eye')" />
                  </div>
                  <div class="collab-open-main">
                    <div class="collab-question-id-row"><span class="task-short-id" :title="item.id || ''">{{ item.displayId || item.id || 'Q000' }}</span></div>
                    <strong class="collab-question-title">{{ item.title }}</strong>
                    <p class="collab-question-text">{{ item.openQuestions }}</p>
                  </div>
                  <div class="collab-card-bottom-left"><div class="collab-question-meta"><time>{{ item.created ? formatTime(item.created) : '未知时间' }}</time></div></div>
                  <div class="collab-card-bottom-right"><button class="btn btn-primary btn-sm" type="button" @click="openReplyDialog(item)">回复</button></div>
                </article>
              </div>
            </section>
          </div>
          <div class="collab-replies">
            <section v-if="replyRecords.length" class="card collab-reply-panel">
              <div class="collab-confirmed-head"><span class="badge">已回复</span><span>{{ replyRecords.length }} 条</span></div>
              <div class="collab-reply-list">
                <article v-for="(item, index) in replyRecords" :key="item.questionId || index" class="collab-reply-item">
                  <div class="collab-card-top-right">
                    <span v-for="relation in item.relations || []" :key="relation" class="badge muted-badge">{{ relation }}</span>
                    <button class="btn icon-button btn-outline-secondary btn-sm" type="button" title="查看" aria-label="查看" @click="openQuestionTarget(item)" v-html="icon('eye')" />
                  </div>
                  <div class="collab-reply-main">
                    <div class="collab-question-id-row"><span class="task-short-id" :title="item.questionId || ''">{{ item.displayId || item.questionId || 'Q000' }}</span></div>
                    <strong class="collab-question-title">{{ item.title }}</strong>
                    <p class="collab-question-text">{{ item.openQuestions || '暂无内容' }}</p>
                    <div class="collab-reply-answer"><time>{{ formatTime(item.replyCreated) }}</time><p>回复：{{ item.replyAnswer || item.reply || '暂无内容' }}</p></div>
                  </div>
                  <div class="collab-card-bottom-left"><div class="collab-question-meta"><time>{{ item.created ? formatTime(item.created) : '未知时间' }}</time></div></div>
                </article>
              </div>
            </section>
          </div>
          <div class="collab-rules"></div>
        </div>
      </section>

      <section id="agent-logs" class="section view" :class="{ 'active-view': state.section === 'agent-logs' }">
        <div class="agent-log-layout">
          <aside class="agent-log-index">
            <div class="section-head compact-head"><h2>目录</h2><span>{{ logs.length }} 条</span></div>
            <div class="agent-log-toc">
              <p v-if="!logs.length" class="empty-panel">暂无工作记录。</p>
              <button v-for="(log, index) in logs" :key="log.id || index" class="agent-log-toc-item" :class="{ active: index === state.selectedLogIndex }" type="button" @click="openAgentLog(index)">
                <span class="agent-log-toc-meta"><span v-if="log.shortId" class="task-short-id">{{ log.shortId }}</span><span class="badge" :class="statusBadgeClass(log.status)">{{ statusText(log.status || 'done') }}</span></span>
                <span class="agent-log-toc-relations"><span v-if="!resolveLogTasks(log).length" class="badge muted-badge">general</span><span v-for="task in resolveLogTasks(log)" :key="task.shortId" class="task-short-id">{{ task.shortId }}</span></span>
                <strong>{{ primaryLogPrompt(log) }}</strong>
                <small>{{ log.title }} · {{ formatTime(log.created) || '未标注日期' }}</small>
              </button>
            </div>
          </aside>
          <div class="agent-log-list-wrap">
            <div class="agent-log-list-spacer" aria-hidden="true"></div>
            <div class="agent-log-list">
              <article
                v-for="(log, index) in logs"
                :key="log.id || index"
                :ref="(el) => setLogRef(index, el as Element | null)"
                class="card collab-log agent-log-card"
                :class="{ active: index === state.selectedLogIndex, 'collab-log-highlight': state.highlightedLog === index }"
              >
                <div class="collab-card-head collab-card-head--meta">
                  <div>
                    <div class="log-badges"><span v-if="log.shortId" class="task-short-id">{{ log.shortId }}</span><span class="badge" :class="statusBadgeClass(log.status)">{{ statusText(log.status || 'done') }}</span><span v-if="log.source" class="badge muted-badge">{{ log.source }}</span></div>
                    <h3>{{ log.title }}</h3>
                    <small>{{ formatTime(log.created) || '未标注日期' }}</small>
                  </div>
                  <div class="log-task-relations"><span v-if="!resolveLogTasks(log).length" class="badge muted-badge">general</span><span v-for="task in resolveLogTasks(log)" :key="task.shortId" class="task-short-id">{{ task.shortId }}</span></div>
                </div>
                <section v-if="log.userOriginal && log.userOriginal !== primaryLogPrompt(log)"><strong>用户原话</strong><div v-html="renderTextBlock(log.userOriginal)" /></section>
                <section :class="{ 'missing-field': !log.understanding }"><strong>理解</strong><div v-if="log.understanding" v-html="renderTextBlock(log.understanding)" /><p v-else>未记录</p></section>
                <section v-if="log.answer" class="answer"><span>回答</span><div v-html="renderTextBlock(log.answer)" /></section>
                <section v-for="[title, items, required] in [['产出', log.outputs, true], ['关键步骤', log.keySteps, true], ['关键判断', log.decisions, false], ['执行动作', log.actions, false], ['修改文件', log.changedFiles, false], ['验证', log.verification, true], ['后续事项', log.followUps, false]]" :key="title" v-show="(items && items.length) || required" :class="{ 'missing-field': required && !(items && items.length) }">
                  <strong>{{ title }}</strong>
                  <ul v-if="items && items.length"><li v-for="item in items" :key="item" v-html="renderInlineMarkdown(item)" /></ul>
                  <p v-else>未记录</p>
                </section>
                <section :class="{ 'missing-field': !log.acceptance }"><strong>验收标准</strong><div v-if="log.acceptance" v-html="renderListTextBlock(log.acceptance)" /><p v-else>未记录</p></section>
              </article>
            </div>
          </div>
        </div>
      </section>

      <section id="knowledge" class="section view" :class="{ 'active-view': state.section === 'knowledge' }">
        <div class="section-head"><h2>知识库</h2><span></span></div>
        <div class="knowledge-layout" :class="{ 'toc-collapsed': state.knowledgeTocCollapsed }">
          <p v-if="!knowledge.length" class="empty-panel">暂无知识条目。</p>
          <template v-else>
            <div class="knowledge-list-wrap">
              <div class="knowledge-list-spacer" aria-hidden="true"></div>
              <div class="knowledge-list">
                <article v-for="(note, index) in knowledge" :key="note.path || note.shortId || index" :ref="(el) => setKnowledgeRef(index, el as Element | null)" class="card knowledge-item" :class="{ 'knowledge-highlight': state.highlightedKnowledge === index }">
                  <div class="knowledge-head">
                    <div><span class="task-short-id">{{ note.shortId || 'K000' }}</span><strong>{{ knowledgeDisplayTitle(note) }}</strong><small v-if="knowledgeDisplayTitle(note) !== note.title">{{ note.title }}</small></div>
                    <div class="knowledge-actions"><span class="badge muted-badge">{{ knowledgeStatusText(note.status) }}</span><small v-if="note.updated">{{ formatTime(note.updated) }}</small></div>
                  </div>
                  <section class="knowledge-block"><strong>重点</strong><p>{{ knowledgeDisplaySummary(note, knowledgeDisplayTitle(note)) }}</p></section>
                  <section class="knowledge-block knowledge-body"><strong>详细答案</strong><div class="rendered-markdown" v-html="renderReadableMarkdown(knowledgeBodyContent(note.content))" /></section>
                  <div v-if="note.tags?.length" class="knowledge-tags"><span v-for="tag in note.tags" :key="tag" class="badge muted-badge">#{{ tag }}</span></div>
                  <div v-if="validRefs([note.source, ...(note.relatedRecords || []), ...(note.relatedTasks || []), ...(note.relatedNotes || [])]).length" class="knowledge-tags"><span v-for="ref in validRefs([note.source, ...(note.relatedRecords || []), ...(note.relatedTasks || []), ...(note.relatedNotes || [])])" :key="ref" class="badge">{{ ref }}</span></div>
                </article>
              </div>
            </div>
            <aside class="knowledge-index" :class="{ 'is-collapsed': state.knowledgeTocCollapsed }">
              <div class="section-head compact-head knowledge-index-head">
                <h2>{{ state.knowledgeTocCollapsed ? '' : '目录' }}</h2>
                <button class="btn icon-button btn-outline-secondary btn-sm" type="button" :title="state.knowledgeTocCollapsed ? '展开目录' : '收起目录'" :aria-label="state.knowledgeTocCollapsed ? '展开目录' : '收起目录'" @click="state.knowledgeTocCollapsed = !state.knowledgeTocCollapsed" v-html="icon(state.knowledgeTocCollapsed ? 'panelRightOpen' : 'panelRightClose')" />
              </div>
              <div v-if="!state.knowledgeTocCollapsed" class="knowledge-toc">
                <button v-for="(note, index) in knowledge" :key="note.path || index" class="knowledge-toc-item" type="button" @click="openKnowledge(index)">
                  <span>{{ note.shortId || 'K000' }}</span>
                  <strong>{{ knowledgeDisplayTitle(note) }}</strong>
                  <small>{{ knowledgeTocSummary(note, knowledgeDisplayTitle(note)) }}</small>
                </button>
              </div>
            </aside>
          </template>
        </div>
      </section>

      <section id="documents" class="section view" :class="{ 'active-view': state.section === 'documents' }">
        <div class="section-head"><h2>文档</h2><span>{{ documents.length }} 条</span></div>
        <div class="notes">
          <p v-if="!documents.length" class="empty-panel">暂无文档。</p>
          <section v-for="(notes, folder) in groupedDocuments" :key="folder" class="document-group">
            <div class="knowledge-group-head"><strong>{{ folder || '根目录' }}</strong><span>{{ notes.length }} 条</span></div>
            <div class="document-list">
              <article v-for="note in notes" :key="note.path" class="card note-row">
                <div class="document-row-head"><strong>{{ note.title }}</strong><span>{{ noteCategory(note.path) }}</span></div>
                <code>{{ note.path }}</code>
                <p v-if="note.summary">{{ note.summary }}</p>
                <div v-if="[note.shortId, note.type, note.status].filter(Boolean).length" class="knowledge-tags"><span v-for="label in [note.shortId, note.type, note.status].filter(Boolean)" :key="label" class="badge muted-badge">{{ label }}</span></div>
              </article>
            </div>
          </section>
        </div>
      </section>
    </section>
  </main>

  <div class="quick-task" :class="{ 'is-open': state.quickOpen }" :data-mode="state.quickCreateMode">
    <button class="btn btn-primary icon-button quick-task-button" type="button" title="新建" aria-label="新建" :aria-expanded="state.quickOpen" @click="openQuickMenu" v-html="icon('plus')" />
    <div v-if="state.quickOpen && !state.quickCreateMode" class="card quick-create-menu" aria-label="新建类型">
      <button class="btn btn-outline-primary quick-create-option" type="button" @click="selectQuickCreate('task')"><span class="quick-create-icon" v-html="icon('listChecks')" /><span>任务</span></button>
      <button class="btn btn-outline-primary quick-create-option" type="button" @click="selectQuickCreate('thought')"><span class="quick-create-icon" v-html="icon('messageCircle')" /><span>想法</span></button>
      <button class="btn btn-outline-primary quick-create-option" type="button" @click="selectQuickCreate('dialogue')"><span class="quick-create-icon" v-html="icon('messagesSquare')" /><span>研究</span></button>
    </div>
    <form v-if="state.quickCreateMode === 'task'" class="card quick-task-panel" aria-label="快速新建任务" @submit.prevent="createTask('quick')">
      <div class="quick-task-head"><strong>新建任务</strong><button class="btn icon-button btn-outline-secondary btn-sm" type="button" title="关闭" aria-label="关闭" @click="closeQuickTask" v-html="icon('x')" /></div>
      <input v-model="quickTaskForm.title" type="text" placeholder="任务标题" />
      <textarea v-model="quickTaskForm.detail" rows="3" placeholder="看到的信息、上下文或下一步。"></textarea>
      <textarea v-model="quickTaskForm.acceptance" rows="2" placeholder="验收标准（可选）。"></textarea>
      <div class="quick-task-grid"><select v-model="quickTaskForm.priority" aria-label="优先级"><option value="medium">Medium</option><option value="high">High</option><option value="low">Low</option></select></div>
      <div class="quick-task-actions"><span>{{ quickTaskForm.status }}</span><button class="btn icon-button btn-primary" type="submit" title="保存任务" aria-label="保存任务" v-html="icon('check')" /></div>
    </form>
    <form v-if="state.quickCreateMode === 'thought'" class="card quick-task-panel" aria-label="快速保存想法" @submit.prevent="saveThought('quick')">
      <div class="quick-task-head"><strong>保存想法</strong><button class="btn icon-button btn-outline-secondary btn-sm" type="button" title="关闭" aria-label="关闭" @click="closeQuickTask" v-html="icon('x')" /></div>
      <textarea v-model="quickThoughtForm.content" rows="5" placeholder="把想法、问题或下一步判断写在这里。"></textarea>
      <div class="quick-task-actions"><span>{{ quickThoughtForm.status }}</span><button class="btn icon-button btn-primary" type="submit" title="保存想法" aria-label="保存想法" v-html="icon('check')" /></div>
    </form>
    <form v-if="state.quickCreateMode === 'dialogue'" class="card quick-task-panel" aria-label="快速研究" @submit.prevent="saveDialogue">
      <div class="quick-task-head"><strong>研究</strong><button class="btn icon-button btn-outline-secondary btn-sm" type="button" title="关闭" aria-label="关闭" @click="closeQuickTask" v-html="icon('x')" /></div>
      <textarea v-model="quickDialogueForm.content" rows="6" placeholder="保存思路演进、关键问答、方案比较、技术背景或重要上下文。"></textarea>
      <textarea v-model="quickDialogueForm.acceptance" rows="2" placeholder="验收标准（可选）。"></textarea>
      <div class="quick-task-actions"><span>{{ quickDialogueForm.status }}</span><button class="btn icon-button btn-primary" type="submit" title="研究" aria-label="研究" v-html="icon('check')" /></div>
    </form>
  </div>

  <div class="toast-stack" aria-live="polite" aria-atomic="false">
    <div v-for="toast in state.toasts" :key="toast.id" class="toast-message" :class="{ 'is-leaving': toast.leaving }">{{ toast.message }}</div>
  </div>

  <div v-if="state.projectRoot && !state.initialized" class="modal-overlay">
    <section class="card init-dialog" role="dialog" aria-modal="true" aria-labelledby="initDialogTitle">
      <h2 id="initDialogTitle">初始化项目管理数据</h2>
      <p>为当前项目创建本地管理数据和 Agent 协作入口。</p>
      <div class="init-dialog-actions">
        <button class="btn icon-button btn-primary" type="button" title="初始化" aria-label="初始化" :disabled="state.busy || !state.projectRoot || state.initialized" @click="initializeCurrentProject" v-html="icon('archive')" />
        <button class="btn icon-button btn-outline-secondary" type="button" title="重新选择项目" aria-label="重新选择项目" :disabled="state.busy" @click="openRecentProjects" v-html="icon('history')" />
      </div>
    </section>
  </div>

  <div v-if="state.projectOverlayOpen" class="modal-overlay" @click.self="closeRecentProjects">
    <section class="card project-dialog" role="dialog" aria-modal="true" aria-labelledby="projectDialogTitle">
      <div class="project-dialog-head">
        <div><h2 id="projectDialogTitle">打开项目</h2><p>选择最近项目，或打开其他项目文件夹。</p></div>
        <button class="btn icon-button btn-outline-secondary btn-sm" type="button" title="关闭" aria-label="关闭" :disabled="state.busy" @click="closeRecentProjects" v-html="icon('x')" />
      </div>
      <div class="recent-project-list">
        <p v-if="!state.recentProjects.length" class="empty-panel">暂无最近项目。</p>
        <div v-for="project in state.recentProjects" :key="project.projectId" class="recent-project-row">
          <button class="recent-project-item" type="button" :disabled="state.busy" @click="openProjectPath(project.projectRoot)">
            <span class="recent-project-mark" v-html="icon('folderOpen')" />
            <span><strong>{{ project.projectName || projectDisplayName(project.projectRoot) }}</strong><small>{{ projectDisplayName(project.projectRoot) }} · {{ formatTime(project.lastOpenedAt) }}</small></span>
          </button>
          <button class="btn icon-button btn-outline-secondary btn-sm" type="button" title="移除历史记录" aria-label="移除历史记录" :disabled="state.busy" @click.stop="removeRecentProject(project.projectId)" v-html="icon('x')" />
        </div>
      </div>
      <div class="init-dialog-actions"><button class="btn icon-button btn-primary" type="button" title="打开其他项目" aria-label="打开其他项目" @click="openProjectPicker" v-html="icon('folderOpen')" /></div>
    </section>
  </div>

  <div v-if="state.replyItem" class="modal-overlay" @click.self="closeReplyDialog">
    <form class="card reply-dialog" role="dialog" aria-modal="true" aria-labelledby="replyDialogTitle" @submit.prevent="submitReply">
      <div class="project-dialog-head">
        <div><h2 id="replyDialogTitle">回复待确认</h2><p>{{ state.replyItem.openQuestions || '待确认内容' }}</p></div>
        <button class="btn icon-button btn-outline-secondary btn-sm" type="button" title="关闭" aria-label="关闭" @click="closeReplyDialog" v-html="icon('x')" />
      </div>
      <textarea v-model="replyForm.answer" rows="5" placeholder="写下回复或处理结论。"></textarea>
      <div class="quick-task-actions"><span>{{ replyForm.status }}</span><button class="btn icon-button btn-primary" type="submit" title="保存回复" aria-label="保存回复" v-html="icon('check')" /></div>
    </form>
  </div>
</template>
