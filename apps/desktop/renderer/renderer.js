const state = {
  projectRoot: '',
  initialized: false,
  dashboard: null,
  recentProjects: [],
  projectOverlayOpen: false,
  doneExpanded: false,
  section: 'overview',
  busy: false,
  autoRefreshing: false,
  selectedLogIndex: 0,
  dialogueTocCollapsed: false,
  knowledgeTocCollapsed: false,
  quickCreateMode: '',
  replyItem: null,
}

const statusLabels = {
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
]

const icons = {
  archive: '<path d="M4 7h16" /><path d="M6 7v11h12V7" /><path d="M9 11h6" /><path d="M5 4h14v3H5z" />',
  bookOpen: '<path d="M12 7v14" /><path d="M3 18a1 1 0 0 1-1-1V5a2 2 0 0 1 2-2h5a3 3 0 0 1 3 3v15a3 3 0 0 0-3-3H3Z" /><path d="M21 18a1 1 0 0 0 1-1V5a2 2 0 0 0-2-2h-5a3 3 0 0 0-3 3" />',
  check: '<path d="m5 12 4 4L19 6" />',
  copy: '<path d="M8 8h11v11H8z" /><path d="M5 15H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1" />',
  cornerUpLeft: '<path d="m9 14-4-4 4-4" /><path d="M5 10h11a4 4 0 0 1 0 8h-1" />',
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
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="3" />',
  x: '<path d="M18 6 6 18" /><path d="m6 6 12 12" />',
}

const taskActionIcons = {
  abandoned: 'slash',
  doing: 'play',
  done: 'check',
  todo: 'cornerUpLeft',
}

const projectPath = document.querySelector('#projectPath')
const appStatus = document.querySelector('#appStatus')
const openFolderButton = document.querySelector('#openFolderButton')
const refreshButton = document.querySelector('#refreshButton')
const copyBriefButton = document.querySelector('#copyBriefButton')
const statusPanel = document.querySelector('#statusPanel')
const generatedAt = document.querySelector('#generatedAt')
const dataRoot = document.querySelector('#dataRoot')
const openDataRootButton = document.querySelector('#openDataRootButton')
const taskCount = document.querySelector('#taskCount')
const thoughtCount = document.querySelector('#thoughtCount')
const dialogueCount = document.querySelector('#dialogueCount')
const knowledgeCount = document.querySelector('#knowledgeCount')
const openQuestionCount = document.querySelector('#openQuestionCount')
const logCount = document.querySelector('#logCount')
const logIndexCount = document.querySelector('#logIndexCount')
const briefSummary = document.querySelector('#briefSummary')
const briefCopyStatus = document.querySelector('#briefCopyStatus')
const taskBoard = document.querySelector('#taskBoard')
const boardSummary = document.querySelector('#boardSummary')
const taskForm = document.querySelector('#taskForm')
const taskTitleInput = document.querySelector('#taskTitleInput')
const taskPriorityInput = document.querySelector('#taskPriorityInput')
const taskDetailInput = document.querySelector('#taskDetailInput')
const taskAcceptanceInput = document.querySelector('#taskAcceptanceInput')
const taskSaveStatus = document.querySelector('#taskSaveStatus')
const thoughtForm = document.querySelector('#thoughtForm')
const thoughtInput = document.querySelector('#thoughtInput')
const thoughtStatus = document.querySelector('#thoughtStatus')
const thoughtList = document.querySelector('#thoughtList')
const collaborationBody = document.querySelector('#collaborationBody')
const collaborationOpenQuestions = document.querySelector('#collaborationOpenQuestions')
const collaborationReplies = document.querySelector('#collaborationReplies')
const collaborationRules = document.querySelector('#collaborationRules')
const collaborationNavCount = document.querySelector('#collaborationNavCount')
const dialogueList = document.querySelector('#dialogueList')
const knowledgeList = document.querySelector('#knowledgeList')
const documentsList = document.querySelector('#documentsList')
const documentsCount = document.querySelector('#documentsCount')
const logIndex = document.querySelector('#logIndex')
const logDetail = document.querySelector('#logDetail')
const quickTask = document.querySelector('#quickTask')
const quickTaskToggle = document.querySelector('#quickTaskToggle')
const quickCreateMenu = document.querySelector('#quickCreateMenu')
const quickTaskClose = document.querySelector('#quickTaskClose')
const quickTaskForm = document.querySelector('#quickTaskForm')
const quickTaskTitle = document.querySelector('#quickTaskTitle')
const quickTaskDetail = document.querySelector('#quickTaskDetail')
const quickTaskAcceptance = document.querySelector('#quickTaskAcceptance')
const quickTaskPriority = document.querySelector('#quickTaskPriority')
const quickTaskStatusText = document.querySelector('#quickTaskStatusText')
const quickThoughtForm = document.querySelector('#quickThoughtForm')
const quickThoughtClose = document.querySelector('#quickThoughtClose')
const quickThoughtInput = document.querySelector('#quickThoughtInput')
const quickThoughtStatusText = document.querySelector('#quickThoughtStatusText')
const quickDialogueForm = document.querySelector('#quickDialogueForm')
const quickDialogueClose = document.querySelector('#quickDialogueClose')
const quickDialogueInput = document.querySelector('#quickDialogueInput')
const quickDialogueAcceptance = document.querySelector('#quickDialogueAcceptance')
const quickDialogueStatusText = document.querySelector('#quickDialogueStatusText')
const initOverlay = document.querySelector('#initOverlay')
const overlayInitButton = document.querySelector('#overlayInitButton')
const overlayChooseButton = document.querySelector('#overlayChooseButton')
const projectOverlay = document.querySelector('#projectOverlay')
const closeProjectOverlay = document.querySelector('#closeProjectOverlay')
const recentProjectsList = document.querySelector('#recentProjectsList')
const chooseOtherProjectButton = document.querySelector('#chooseOtherProjectButton')
const replyOverlay = document.querySelector('#replyOverlay')
const replyForm = document.querySelector('#replyForm')
const replyQuestionText = document.querySelector('#replyQuestionText')
const replyInput = document.querySelector('#replyInput')
const replyStatusText = document.querySelector('#replyStatusText')
const replyCloseButton = document.querySelector('#replyCloseButton')
const toastStack = document.querySelector('#toastStack')
const themeToggleButton = document.querySelector('#themeToggleButton')

setupTheme()
setupNavigation()
setupStaticIcons()
setupAutoRefresh()

openFolderButton.addEventListener('click', () => {
  openRecentProjects()
})

overlayInitButton.addEventListener('click', initializeCurrentProject)
overlayChooseButton.addEventListener('click', openRecentProjects)
closeProjectOverlay.addEventListener('click', closeRecentProjects)
chooseOtherProjectButton.addEventListener('click', openProjectPicker)
replyCloseButton.addEventListener('click', closeReplyDialog)
themeToggleButton.addEventListener('click', toggleTheme)

replyOverlay.addEventListener('click', (event) => {
  if (event.target === replyOverlay) closeReplyDialog()
})

projectOverlay.addEventListener('click', (event) => {
  if (event.target === projectOverlay) closeRecentProjects()
})

recentProjectsList.addEventListener('click', (event) => {
  const removeButton = event.target.closest('[data-remove-recent-project]')
  if (removeButton) {
    runAction('正在移除历史记录...', async () => {
      ensureApi()
      state.recentProjects = sortRecentProjects(await window.electronManager.removeRecentProject(removeButton.dataset.removeRecentProject))
      setStatus('')
    })
    return
  }

  const button = event.target.closest('[data-open-recent-project]')
  if (!button) return
  openProjectPath(button.dataset.openRecentProject)
})

refreshButton.addEventListener('click', () => {
  runAction('正在刷新数据...', async () => {
    if (!ensureReady()) return
    await refreshDashboard({ quiet: false })
    setStatus('')
  })
})

openDataRootButton.addEventListener('click', () => {
  runAction('正在打开数据层...', async () => {
    if (!ensureReady()) return
    const folderPath = state.dashboard?.agentBrief?.dataRoot
    if (!folderPath) throw new Error('数据层路径不存在')
    await window.electronManager.openFolderPath(folderPath)
    setStatus('')
  })
})

copyBriefButton.addEventListener('click', async () => {
  const briefText = syncEntryText(state.dashboard?.agentBrief)
  if (!state.initialized || !briefText.trim()) return
  try {
    await navigator.clipboard.writeText(briefText)
    briefCopyStatus.textContent = ''
    showToast('已复制')
  } catch {
    briefSummary.textContent = briefText
    selectText(briefSummary)
    briefCopyStatus.textContent = ''
    showToast('已选中')
  }
})

taskForm.addEventListener('submit', (event) => {
  event.preventDefault()
  createTaskFromInputs({
    title: taskTitleInput.value,
    priority: taskPriorityInput.value,
    area: 'tool',
    detail: taskDetailInput.value,
    acceptance: taskAcceptanceInput.value,
    setStatusText: (message) => {
      taskSaveStatus.textContent = message
    },
    reset: () => {
      taskTitleInput.value = ''
      taskDetailInput.value = ''
      taskAcceptanceInput.value = ''
      taskPriorityInput.value = 'medium'
    },
  })
})

thoughtForm.addEventListener('submit', (event) => {
  event.preventDefault()
  runAction('正在保存输入...', async () => {
    if (!ensureReady()) return
    const content = thoughtInput.value.trim()
    if (!content) {
      thoughtStatus.textContent = '先写一点内容'
      thoughtInput.focus()
      return
    }
    thoughtStatus.textContent = '保存中...'
    updateDashboard(await window.electronManager.addThought(state.projectRoot, content))
    thoughtInput.value = ''
    thoughtStatus.textContent = ''
    showToast('已保存')
    setStatus('')
  })
})

thoughtList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-delete-thought]')
  if (!button) return
  runAction('正在删除输入...', async () => {
    if (!ensureReady()) return
    updateDashboard(await window.electronManager.deleteThought(state.projectRoot, button.dataset.deleteThought))
    thoughtStatus.textContent = ''
    setStatus('')
  })
})

taskBoard.addEventListener('click', (event) => {
  const toggleDoneButton = event.target.closest('[data-toggle-done]')
  if (toggleDoneButton) {
    state.doneExpanded = !state.doneExpanded
    render()
    return
  }

  const deleteButton = event.target.closest('[data-delete-task]')
  if (deleteButton) {
    if (!confirm('删除这张任务卡？')) return
    runAction('正在删除任务...', async () => {
      if (!ensureReady()) return
      updateDashboard(await window.electronManager.deleteTask(state.projectRoot, deleteButton.dataset.deleteTask))
      taskSaveStatus.textContent = ''
      setStatus('')
    })
    return
  }

  const button = event.target.closest('[data-task-status]')
  if (!button) return
  runAction('正在更新任务状态...', async () => {
    if (!ensureReady()) return
    updateDashboard(await window.electronManager.updateTaskStatus(
      state.projectRoot,
      button.dataset.taskId,
      button.dataset.taskStatus,
    ))
    taskSaveStatus.textContent = ''
    setStatus('')
  })
})

logIndex.addEventListener('click', (event) => {
  const button = event.target.closest('[data-log-index]')
  if (!button) return
  openAgentLog(button.dataset.logIndex)
})

dialogueList.addEventListener('click', (event) => {
  const toggleButton = event.target.closest('[data-toggle-dialogue-toc]')
  if (toggleButton) {
    state.dialogueTocCollapsed = !state.dialogueTocCollapsed
    render()
    return
  }

  const button = event.target.closest('[data-dialogue-index]')
  if (button) {
    openDialogue(button.dataset.dialogueIndex)
  }
})

logDetail.addEventListener('click', (event) => {
  const button = event.target.closest('[data-open-task]')
  if (!button?.dataset.openTask) return
  openBoardTask(button.dataset.openTask)
})

knowledgeList.addEventListener('click', (event) => {
  const toggleButton = event.target.closest('[data-toggle-knowledge-toc]')
  if (toggleButton) {
    state.knowledgeTocCollapsed = !state.knowledgeTocCollapsed
    render()
    return
  }

  const button = event.target.closest('[data-knowledge-index]')
  if (!button) return
  openKnowledge(button.dataset.knowledgeIndex)
})

collaborationBody.addEventListener('click', (event) => {
  const replyButton = event.target.closest('[data-reply-open-question]')
  if (replyButton) {
    const item = state.dashboard?.openQuestions?.[Number(replyButton.dataset.replyOpenQuestion)]
    if (!item) return
    openReplyDialog(item)
    return
  }

  const logButton = event.target.closest('[data-open-log]')
  if (logButton) {
    setActiveSection('agent-logs')
    window.setTimeout(() => openAgentLog(logButton.dataset.openLog), 0)
    return
  }

  const thoughtButton = event.target.closest('[data-open-thought]')
  if (thoughtButton) {
    openThought(thoughtButton.dataset.openThought)
    return
  }

  const button = event.target.closest('[data-open-task]')
  if (!button) return
  setActiveSection('board')
  window.setTimeout(() => {
    const card = document.querySelector(`[data-task-card="${cssEscape(button.dataset.openTask)}"]`)
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    card?.classList.add('task-highlight')
    window.setTimeout(() => card?.classList.remove('task-highlight'), 1600)
  }, 0)
})

quickTaskToggle.addEventListener('click', () => {
  const isOpen = quickTask.classList.toggle('is-open')
  if (!isOpen) state.quickCreateMode = ''
  quickTaskToggle.setAttribute('aria-expanded', String(isOpen))
  updateQuickCreateView()
})

quickTaskClose.addEventListener('click', closeQuickTask)
quickThoughtClose.addEventListener('click', closeQuickTask)
quickDialogueClose.addEventListener('click', closeQuickTask)

quickCreateMenu.addEventListener('click', (event) => {
  const button = event.target.closest('[data-quick-create-kind]')
  if (!button) return
  state.quickCreateMode = button.dataset.quickCreateKind
  updateQuickCreateView()
})

quickTaskForm.addEventListener('submit', (event) => {
  event.preventDefault()
  createTaskFromInputs({
    title: quickTaskTitle.value,
    priority: quickTaskPriority.value,
    area: 'tool',
    detail: quickTaskDetail.value,
    acceptance: quickTaskAcceptance.value,
    setStatusText: (message) => {
      quickTaskStatusText.textContent = message
    },
    reset: () => {
      quickTaskTitle.value = ''
      quickTaskDetail.value = ''
      quickTaskAcceptance.value = ''
      quickTaskPriority.value = 'medium'
      closeQuickTask()
    },
  })
})

quickThoughtForm.addEventListener('submit', (event) => {
  event.preventDefault()
  runAction('正在保存输入...', async () => {
    if (!ensureReady()) return
    const content = quickThoughtInput.value.trim()
    if (!content) {
      quickThoughtStatusText.textContent = '先写一点内容'
      quickThoughtInput.focus()
      return
    }
    quickThoughtStatusText.textContent = '保存中...'
    updateDashboard(await window.electronManager.addThought(state.projectRoot, content))
    quickThoughtInput.value = ''
    quickThoughtStatusText.textContent = ''
    showToast('已保存')
    closeQuickTask()
    setStatus('')
  })
})

quickDialogueForm.addEventListener('submit', (event) => {
  event.preventDefault()
  runAction('正在保存研究...', async () => {
    if (!ensureReady()) return
    const content = quickDialogueInput.value.trim()
    if (!content) {
      quickDialogueStatusText.textContent = '先写一点内容'
      quickDialogueInput.focus()
      return
    }
    quickDialogueStatusText.textContent = '保存中...'
    updateDashboard(await window.electronManager.addDialogue(state.projectRoot, {
      content,
      acceptance: quickDialogueAcceptance.value,
    }))
    quickDialogueInput.value = ''
    quickDialogueAcceptance.value = ''
    quickDialogueStatusText.textContent = ''
    showToast('已保存')
    closeQuickTask()
    setStatus('')
  })
})

replyForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const item = state.replyItem
  if (!item) return
  runAction('正在保存回复...', async () => {
    if (!ensureReady()) return
    const answer = replyInput.value.trim()
    if (!answer) {
      replyStatusText.textContent = '先写回复'
      replyInput.focus()
      return
    }
    replyStatusText.textContent = '保存中...'
    updateDashboard(await window.electronManager.replyOpenQuestion(state.projectRoot, {
      questionId: item.id,
      source: item.source,
      shortId: item.shortId,
      thoughtId: item.thoughtId,
      title: item.title,
      openQuestions: item.openQuestions,
      answer,
    }))
    closeReplyDialog()
    setStatus('')
  })
})

function setupNavigation() {
  document.querySelectorAll('[data-section]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault()
      setActiveSection(link.dataset.section)
      history.replaceState(null, '', `#${link.dataset.section}`)
    })
  })

  const initialSection = location.hash.replace('#', '') || 'overview'
  setActiveSection(initialSection)
}

function setupStaticIcons() {
  document.querySelectorAll('nav [data-icon]').forEach((link) => {
    link.insertAdjacentHTML('afterbegin', `<span class="nav-icon">${icon(link.dataset.icon)}</span>`)
  })
  document.querySelectorAll('.stat-icon[data-icon]').forEach((target) => {
    target.innerHTML = icon(target.dataset.icon)
  })
  setButtonIcon(openFolderButton, 'history')
  setButtonIcon(refreshButton, 'refresh')
  setButtonIcon(copyBriefButton, 'copy')
  setButtonIcon(openDataRootButton, 'folderOpen')
  setButtonIcon(document.querySelector('#saveThoughtButton'), 'check')
  setButtonIcon(document.querySelector('#createTaskButton'), 'check')
  setButtonIcon(quickTaskToggle, 'plus')
  setButtonIcon(quickTaskClose, 'x')
  setButtonIcon(document.querySelector('#quickTaskSubmit'), 'check')
  setButtonIcon(quickThoughtClose, 'x')
  setButtonIcon(document.querySelector('#quickThoughtSubmit'), 'check')
  setButtonIcon(quickDialogueClose, 'x')
  setButtonIcon(document.querySelector('#quickDialogueSubmit'), 'check')
  setButtonIcon(overlayInitButton, 'archive')
  setButtonIcon(overlayChooseButton, 'history')
  setButtonIcon(closeProjectOverlay, 'x')
  setButtonIcon(chooseOtherProjectButton, 'folderOpen')
  setButtonIcon(replyCloseButton, 'x')
  setButtonIcon(document.querySelector('#replySubmitButton'), 'check')
  document.querySelectorAll('.quick-create-icon').forEach((item) => {
    item.innerHTML = icon(item.dataset.icon)
  })
  updateThemeToggle()
}

function setupTheme() {
  applyTheme(localStorage.getItem('electron-manager-theme') || 'dark')
}

function toggleTheme() {
  const nextTheme = document.body.dataset.theme === 'dark' ? 'light' : 'dark'
  applyTheme(nextTheme)
  localStorage.setItem('electron-manager-theme', nextTheme)
}

function applyTheme(theme) {
  const normalizedTheme = theme === 'light' ? 'light' : 'dark'
  document.body.dataset.theme = normalizedTheme
  updateThemeToggle()
}

function updateThemeToggle() {
  if (!themeToggleButton) return
  const isDark = document.body.dataset.theme !== 'light'
  themeToggleButton.setAttribute('aria-pressed', String(isDark))
  themeToggleButton.title = isDark ? '切换亮色模式' : '切换暗色模式'
  themeToggleButton.querySelector('.theme-toggle-icon').innerHTML = icon(isDark ? 'moon' : 'sun')
  themeToggleButton.querySelector('.theme-toggle-label').textContent = isDark ? '暗色' : '亮色'
}

function restoreLastProject() {
  runAction('正在读取最近项目...', async () => {
    ensureApi()
    state.recentProjects = sortRecentProjects(await window.electronManager.listRecentProjects())
    const latestProject = state.recentProjects[0]
    if (!latestProject) {
      setStatus('等待选择项目')
      return
    }
    const result = await window.electronManager.openPath(latestProject.projectRoot)
    updateState(result)
    setStatus(result.initialized ? '' : '项目尚未初始化。')
  })
}

function openRecentProjects() {
  runAction('正在读取最近项目...', async () => {
    ensureApi()
    state.recentProjects = sortRecentProjects(await window.electronManager.listRecentProjects())
    state.projectOverlayOpen = true
    setStatus('')
  })
}

function closeRecentProjects() {
  state.projectOverlayOpen = false
  render()
}

function openProjectPicker() {
  runAction('正在打开项目选择器...', async () => {
    ensureApi()
    const result = await window.electronManager.openFolder()
    if (!result) {
      setStatus('')
      return
    }
    state.projectOverlayOpen = false
    updateState(result)
    setStatus(result.initialized ? '' : '项目尚未初始化。')
  })
}

function openProjectPath(projectRoot) {
  runAction('正在打开项目...', async () => {
    ensureApi()
    const result = await window.electronManager.openPath(projectRoot)
    state.projectOverlayOpen = false
    state.recentProjects = sortRecentProjects(await window.electronManager.listRecentProjects())
    updateState(result)
    setStatus(result.initialized ? '' : '项目尚未初始化。')
  })
}

function initializeCurrentProject() {
  runAction('正在初始化项目管理数据...', async () => {
    ensureReadyForInit()
    const dashboard = await window.electronManager.initProject(state.projectRoot)
    updateState({ initialized: true, projectRoot: state.projectRoot, dashboard })
    setStatus('')
  })
}

function setActiveSection(section) {
  const fallback = document.querySelector(`#${section}`) ? section : 'overview'
  state.section = fallback
  document.querySelectorAll('[data-section]').forEach((link) => {
    link.classList.toggle('active', link.dataset.section === fallback)
  })
  document.querySelectorAll('.view').forEach((view) => {
    view.classList.toggle('active-view', view.id === fallback)
  })
}

async function createTaskFromInputs({ title, priority, area, detail, acceptance, setStatusText, reset }) {
  runAction('正在新增任务...', async () => {
    if (!ensureReady()) return
    const normalizedTitle = title.trim()
    if (!normalizedTitle) {
      setStatusText('先写任务标题')
      return
    }
    setStatusText('保存中...')
    const dashboard = await window.electronManager.addTask(state.projectRoot, {
      title: normalizedTitle,
      status: 'todo',
      priority,
      area,
      userOriginal: normalizedTitle,
      agentUnderstanding: '由 Electron Manager 新增。',
      executionScope: detail.trim() || '待补充。',
      acceptance: acceptance.trim() || '待补充。',
      openQuestions: '无。',
    })
    updateDashboard(dashboard)
    reset()
    setStatusText('')
    showToast('已保存')
    setStatus('')
  })
}

function updateState(result) {
  state.projectRoot = result.projectRoot
  state.initialized = result.initialized
  state.dashboard = result.dashboard
  state.selectedLogIndex = clampLogIndex(state.selectedLogIndex, result.dashboard?.logs || [])
  render()
}

function updateDashboard(dashboard) {
  state.initialized = true
  state.dashboard = dashboard
  state.selectedLogIndex = clampLogIndex(state.selectedLogIndex, dashboard.logs)
  render()
}

function render() {
  projectPath.textContent = state.projectRoot ? projectDisplayName(state.projectRoot) : '尚未打开项目'
  openFolderButton.disabled = state.busy
  overlayInitButton.disabled = state.busy || !state.projectRoot || state.initialized
  overlayChooseButton.disabled = state.busy
  projectOverlay.hidden = !state.projectOverlayOpen
  replyOverlay.hidden = !state.replyItem
  chooseOtherProjectButton.disabled = state.busy
  closeProjectOverlay.disabled = state.busy
  renderRecentProjects()
  refreshButton.disabled = state.busy || !state.initialized
  copyBriefButton.disabled = state.busy || !state.initialized
  openDataRootButton.disabled = state.busy || !state.initialized || !state.dashboard?.agentBrief?.dataRoot
  initOverlay.hidden = !state.projectRoot || state.initialized

  if (!state.projectRoot) {
    renderEmptyState()
    return
  }

  if (!state.initialized || !state.dashboard) {
    renderUninitializedState()
    return
  }

  const dashboard = state.dashboard
  generatedAt.textContent = `更新于 ${formatTime(dashboard.agentBrief.generatedAt)}`
  dataRoot.textContent = dashboard.agentBrief.dataRoot || '本地管理数据'
  statusPanel.innerHTML = `
    <h2>${escapeHtml(dashboard.config.name)}</h2>
  `
  taskCount.textContent = String(dashboard.tasks.length)
  thoughtCount.textContent = String(dashboard.thoughts.length)
  dialogueCount.textContent = String(dashboard.dialogues.length)
  knowledgeCount.textContent = String(dashboard.knowledge?.length || 0)
  openQuestionCount.textContent = String(dashboard.openQuestions.length)
  renderCollaborationNavCount(dashboard.openQuestions.length)
  logCount.textContent = String(dashboard.logs.length)
  renderBrief(dashboard.agentBrief)
  taskBoard.innerHTML = renderBoard(dashboard.tasks)
  boardSummary.innerHTML = renderBoardSummary(dashboard.tasks)
  thoughtList.innerHTML = renderThoughts(dashboard.thoughts)
  dialogueList.classList.toggle('toc-collapsed', state.dialogueTocCollapsed)
  dialogueList.innerHTML = renderDialogues(dashboard.dialogues)
  renderCollaboration(dashboard)
  renderLogs(dashboard.logs)
  knowledgeList.classList.toggle('toc-collapsed', state.knowledgeTocCollapsed)
  knowledgeList.innerHTML = renderKnowledge(dashboard)
  documentsList.innerHTML = renderDocuments(dashboard)
  documentsCount.textContent = `${dashboard.documents?.length || 0} 条`
}

function renderEmptyState() {
  generatedAt.textContent = '尚未读取'
  dataRoot.textContent = '初始化后显示'
  openDataRootButton.disabled = true
  statusPanel.innerHTML = `
    <span class="badge">Ready</span>
    <h2>选择任意项目开始</h2>
    <p>选择项目文件夹后，会创建 Markdown 主数据、JSON 同步包和本地协作 skill。</p>
  `
  resetDashboard()
}

function renderUninitializedState() {
  generatedAt.textContent = '尚未初始化'
  dataRoot.textContent = '初始化后显示'
  statusPanel.innerHTML = `
    <h2>项目尚未初始化</h2>
  `
  resetDashboard()
}

function resetDashboard() {
  taskCount.textContent = '0'
  thoughtCount.textContent = '0'
  dialogueCount.textContent = '0'
  knowledgeCount.textContent = '0'
  openQuestionCount.textContent = '0'
  logCount.textContent = '0'
  briefSummary.textContent = '打开项目后显示同步入口。'
  briefCopyStatus.textContent = ''
  taskBoard.innerHTML = '<p class="empty-panel">暂无任务。</p>'
  boardSummary.innerHTML = ''
  thoughtList.innerHTML = '<p class="empty-panel">暂无想法。</p>'
  dialogueList.innerHTML = '<p class="empty-panel">暂无研究。</p>'
  collaborationOpenQuestions.innerHTML = ''
  collaborationReplies.innerHTML = ''
  collaborationRules.innerHTML = '<p class="empty-panel">初始化后显示协作规则。</p>'
  renderCollaborationNavCount(0)
  logIndex.innerHTML = '<p class="empty-panel">暂无工作记录。</p>'
  logIndexCount.textContent = '0 条'
  logDetail.innerHTML = ''
  knowledgeList.innerHTML = '<p class="empty-panel">初始化后显示知识条目。</p>'
  documentsList.innerHTML = '<p class="empty-panel">初始化后显示文档索引。</p>'
  documentsCount.textContent = '0 条'
}

function renderRecentProjects() {
  const recentProjects = sortRecentProjects(state.recentProjects)
  recentProjectsList.innerHTML = recentProjects.length
    ? recentProjects.map((project) => `
      <div class="recent-project-row">
        <button class="recent-project-item" type="button" data-open-recent-project="${escapeHtml(project.projectRoot)}" ${state.busy ? 'disabled' : ''}>
          <span class="recent-project-mark">${icon('folderOpen')}</span>
          <span>
            <strong>${escapeHtml(project.projectName || projectDisplayName(project.projectRoot))}</strong>
            <small>${escapeHtml(projectDisplayName(project.projectRoot))} · ${escapeHtml(formatTime(project.lastOpenedAt))}</small>
          </span>
        </button>
        <button class="btn icon-button btn-outline-secondary btn-sm" type="button" data-remove-recent-project="${escapeHtml(project.projectId)}" title="移除历史记录" aria-label="移除历史记录" ${state.busy ? 'disabled' : ''}>
          ${icon('x')}
        </button>
      </div>
    `).join('')
    : '<p class="empty-panel">暂无最近项目。</p>'
}

function sortRecentProjects(projects = []) {
  return projects
    .slice()
    .sort((a, b) => projectOpenSortKey(b).localeCompare(projectOpenSortKey(a)))
}

function projectOpenSortKey(project) {
  return project.lastOpenedAt || project.createdAt || ''
}

function renderBoard(tasks = []) {
  return boardColumns.map(([status, label]) => {
    const allItems = tasks.filter((task) => task.status === status)
    const items = status === 'done' && !state.doneExpanded ? allItems.slice(0, 6) : allItems
    const hiddenCount = allItems.length - items.length
    return `
      <section class="card column">
        <div class="column-head">
          <h3>${label}</h3>
          <span class="badge">${allItems.length}</span>
        </div>
        <div class="tasks">
          ${items.length ? items.map(renderTask).join('') : '<p class="empty">暂无任务</p>'}
          ${status === 'done' && allItems.length > 6 ? `
            <button class="done-toggle" type="button" data-toggle-done>
              ${state.doneExpanded ? '收起已完成任务' : `展开 ${hiddenCount} 个已完成任务`}
            </button>
          ` : ''}
        </div>
      </section>
    `
  }).join('')
}

function renderTask(task) {
  const actions = taskActions(task)
    .map((action) => `
      <button class="btn icon-button btn-outline-secondary btn-sm" type="button" data-task-id="${escapeHtml(task.id)}" data-task-status="${action.status}" title="${escapeHtml(action.label)}" aria-label="${escapeHtml(action.label)}">
        ${icon(taskActionIcons[action.status] || 'check')}
      </button>
    `)
    .join('')
  return `
    <article class="task ${task.status === 'done' ? 'done' : ''}" data-task-card="${escapeHtml(task.id)}">
      <div class="task-head">
        <div class="task-title">
          ${task.shortId ? `<span class="task-short-id">${escapeHtml(task.shortId)}</span>` : ''}
          <span>${escapeHtml(task.title)}</span>
        </div>
        <button class="btn icon-button btn-outline-secondary btn-sm task-delete-button" type="button" data-delete-task="${escapeHtml(task.id)}" title="删除任务" aria-label="删除任务">
          ${icon('trash')}
        </button>
      </div>
      <div class="task-meta">
        <span class="badge ${priorityClass(task.priority)}">${escapeHtml(task.priority || 'medium')}</span>
        <span class="badge muted-badge">${escapeHtml(task.area || 'tool')}</span>
        <span class="badge ${statusBadgeClass(task.status)}">${escapeHtml(statusText(task.status))}</span>
      </div>
      ${task.detail ? `<p>${escapeHtml(task.detail).slice(0, 180)}</p>` : ''}
      <div class="task-actions">
        ${actions}
      </div>
    </article>
  `
}

function taskActions(task) {
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

function renderBoardSummary(tasks = []) {
  const backlog = tasks.filter((task) => task.status === 'backlog').length
  const abandoned = tasks.filter((task) => task.status === 'abandoned').length
  const parts = []
  if (backlog) parts.push(`Backlog ${backlog}`)
  if (abandoned) parts.push(`Abandoned ${abandoned}`)
  return parts.map((item) => `<span>${item}</span>`).join('')
}

function renderThoughts(thoughts = []) {
  return thoughts.length ? thoughts.map((thought) => {
    const title = thoughtDisplayTitle(thought)
    return `
    <article class="card thought" data-thought-card="${escapeHtml(thought.id || thought.shortId || '')}">
      <div class="thought-header">
        <div class="thought-title">
          <div class="thought-title-row">
            ${thought.shortId ? `<span class="thought-short-id">${escapeHtml(thought.shortId)}</span>` : ''}
            ${title ? `<strong>${escapeHtml(title)}</strong>` : ''}
            <span class="badge ${statusBadgeClass(thought.status)}">${escapeHtml(statusText(thought.status))}</span>
          </div>
        </div>
        <button class="btn icon-button btn-outline-secondary btn-sm" type="button" data-delete-thought="${escapeHtml(thought.id)}" title="删除输入" aria-label="删除输入">
          ${icon('trash')}
        </button>
      </div>
      <p>${escapeHtml(thought.content)}</p>
      ${thought.answer ? `<div class="answer"><span>摘要</span><p>${escapeHtml(thought.answer)}</p></div>` : ''}
      <small>${escapeHtml(formatTime(thought.created) || '未标注日期')}</small>
    </article>
  `
  }).join('') : '<p class="empty-panel">暂无想法</p>'
}

function thoughtDisplayTitle(thought) {
  const title = String(thought.title || '')
    .replace(/\s*想法\s*$/, '')
    .trim()
  return isDateOnlyThoughtTitle(title) ? '' : title
}

function isDateOnlyThoughtTitle(title) {
  return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2})?$/.test(String(title || '').trim())
}

function thoughtStatusLabel(status) {
  return statusText(status)
}

function thoughtStatusClass(status) {
  return statusBadgeClass(status)
}

function renderDialogues(dialogues = []) {
  if (!dialogues.length) return '<p class="empty-panel">暂无研究。</p>'
  return `
    <div class="dialogue-list-wrap">
      <div class="dialogue-list-spacer" aria-hidden="true"></div>
      <div class="dialogue-list">
        ${dialogues.map((dialogue, index) => renderDialogueItem(dialogue, index)).join('')}
      </div>
    </div>
    <aside class="dialogue-index ${state.dialogueTocCollapsed ? 'is-collapsed' : ''}">
      <div class="section-head compact-head dialogue-index-head">
        <h2>${state.dialogueTocCollapsed ? '' : '目录'}</h2>
        <button class="btn icon-button btn-outline-secondary btn-sm" type="button" data-toggle-dialogue-toc title="${state.dialogueTocCollapsed ? '展开目录' : '收起目录'}" aria-label="${state.dialogueTocCollapsed ? '展开目录' : '收起目录'}">
          ${icon(state.dialogueTocCollapsed ? 'panelRightOpen' : 'panelRightClose')}
        </button>
      </div>
      ${state.dialogueTocCollapsed ? '' : `
        <div class="dialogue-toc">
          ${dialogues.map((dialogue, index) => renderDialogueTocItem(dialogue, index)).join('')}
        </div>
      `}
    </aside>
  `
}

function renderDialogueItem(dialogue, index) {
  return `
    <article class="card dialogue" data-dialogue-card="${index}">
      <div class="dialogue-head">
        <div>
          <span class="task-short-id">${escapeHtml(dialogue.shortId || 'D000')}</span>
          <strong>${escapeHtml(dialogueTitle(dialogue))}</strong>
        </div>
        <div class="dialogue-actions">
          <small>${escapeHtml(formatTime(dialogue.created))}</small>
        </div>
      </div>
      ${renderDialoguePrompt(dialogue.recordContent)}
      ${renderDialogueAnswer(dialogue.answer || '暂无。')}
      ${renderDialogueMeta(dialogue.acceptance || '无。')}
      ${renderDialogueRelations(dialogue)}
    </article>
  `
}

function renderDialoguePrompt(value) {
  return value ? `
    <section class="dialogue-block dialogue-prompt">
      <strong>内容</strong>
      <p>${escapeHtml(value)}</p>
    </section>
  ` : ''
}

function renderDialogueAnswer(value) {
  return `
    <section class="dialogue-block dialogue-answer">
      <div class="dialogue-block-head">
        <strong>回答</strong>
        <span>Agent</span>
      </div>
      <div class="rendered-markdown">
        ${renderReadableMarkdown(value)}
      </div>
    </section>
  `
}

function renderDialogueMeta(value) {
  return `
    <section class="dialogue-block dialogue-meta-block">
      <strong>验收标准</strong>
      <p>${escapeHtml(value)}</p>
    </section>
  `
}

function renderDialogueTocItem(dialogue, index) {
  return `
    <button class="dialogue-toc-item" type="button" data-dialogue-index="${index}">
      <span>${escapeHtml(dialogue.shortId || 'D000')}</span>
      <strong>${escapeHtml(dialogueTitle(dialogue))}</strong>
      <small>${escapeHtml(dialogueTocSummary(dialogue))}</small>
    </button>
  `
}

function dialogueTitle(dialogue) {
  return String(dialogue.title || '').replace(/^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2})?\s*/, '').trim() || '研究'
}

function renderDialogueRelations(dialogue) {
  const refs = [...(dialogue.relatedTasks || []), ...(dialogue.relatedThoughts || []), ...(dialogue.tags || []).map((tag) => `#${tag}`)]
  return refs.length
    ? `<div class="dialogue-relations">${refs.map((ref) => `<span class="badge muted-badge">${escapeHtml(ref)}</span>`).join('')}</div>`
    : ''
}

function dialogueTocSummary(dialogue) {
  const answer = String(dialogue.answer || '').replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim()
  const summary = answer || String(dialogue.recordContent || '').replace(/\s+/g, ' ').trim()
  const clipped = summary.length > 44 ? `${summary.slice(0, 44).trimEnd()}...` : summary
  return clipped || formatTime(dialogue.created)
}

function openDialogue(index) {
  const targetIndex = Number(index || 0)
  const card = document.querySelector(`[data-dialogue-card="${cssEscape(targetIndex)}"]`)
  card?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  card?.classList.add('dialogue-highlight')
  window.setTimeout(() => card?.classList.remove('dialogue-highlight'), 1600)
}

function renderCollaboration(dashboard) {
  collaborationOpenQuestions.innerHTML = dashboard.openQuestions.length ? `
    <section class="card collab-open-panel">
      <div class="collab-open-head">
        <div>
          <span class="badge warning-badge">待确认</span>
        </div>
        <span class="collab-open-count">${dashboard.openQuestions.length}</span>
      </div>
      <div class="collab-open-list">
        ${dashboard.openQuestions.map((item, index) => renderOpenQuestionItem(item, index)).join('')}
      </div>
    </section>
  ` : '<p class="empty-panel">暂无待确认</p>'

  collaborationReplies.innerHTML = dashboard.replyRecords.length ? `
    <section class="card collab-reply-panel">
      <div class="collab-confirmed-head">
        <span class="badge">已回复</span>
        <span>${dashboard.replyRecords.length} 条</span>
      </div>
      <div class="collab-reply-list">
        ${dashboard.replyRecords.map(renderReplyRecordItem).join('')}
      </div>
    </section>
  ` : ''

  collaborationRules.innerHTML = ''
}

function renderCollaborationNavCount(count) {
  collaborationNavCount.hidden = !count
  collaborationNavCount.textContent = String(count)
}

function renderOpenQuestionItem(item, index) {
  const isLogQuestion = item.source === 'log'
  const isThoughtQuestion = item.source === 'thought'
  const targetAttr = isLogQuestion
    ? `data-open-log="${escapeHtml(String(item.logIndex || 0))}"`
    : isThoughtQuestion
      ? `data-open-thought="${escapeHtml(item.thoughtId || findThoughtIdByShortId(item.shortId))}"`
      : `data-open-task="${escapeHtml(findTaskIdByShortId(item.shortId))}"`
  return `
    <article class="collab-open-item">
      <div class="collab-card-top-right">
        ${renderQuestionRelations(item.relations)}
        <button class="btn icon-button btn-outline-secondary btn-sm" type="button" title="查看" aria-label="查看" ${targetAttr}>${icon('eye')}</button>
      </div>
      <div class="collab-open-main">
        <div class="collab-question-id-row">
          <span class="task-short-id" title="${escapeHtml(item.id || '')}">${escapeHtml(item.displayId || item.id || 'Q000')}</span>
        </div>
        <strong class="collab-question-title">${escapeHtml(item.title)}</strong>
        <p class="collab-question-text">${escapeHtml(item.openQuestions)}</p>
      </div>
      <div class="collab-card-bottom-left">
        ${renderQuestionMeta(item)}
      </div>
      <div class="collab-card-bottom-right">
        <button class="btn btn-primary btn-sm" type="button" data-reply-open-question="${escapeHtml(String(index))}">回复</button>
      </div>
    </article>
  `
}

function renderReplyRecordItem(item) {
  const targetAttr = item.source === 'log'
    ? `data-open-log="${escapeHtml(String(item.logIndex || 0))}"`
    : item.source === 'thought'
      ? `data-open-thought="${escapeHtml(item.thoughtId || findThoughtIdByShortId(item.shortId))}"`
      : `data-open-task="${escapeHtml(findTaskIdByShortId(item.shortId))}"`
  return `
    <article class="collab-reply-item">
      <div class="collab-card-top-right">
        ${renderQuestionRelations(item.relations)}
        <button class="btn icon-button btn-outline-secondary btn-sm" type="button" title="查看" aria-label="查看" ${targetAttr}>${icon('eye')}</button>
      </div>
      <div class="collab-reply-main">
        <div class="collab-question-id-row">
          <span class="task-short-id" title="${escapeHtml(item.questionId || '')}">${escapeHtml(item.displayId || item.questionId || 'Q000')}</span>
        </div>
        <strong class="collab-question-title">${escapeHtml(item.title)}</strong>
        <p class="collab-question-text">${escapeHtml(item.openQuestions || '暂无内容')}</p>
        <div class="collab-reply-answer">
          <time>${escapeHtml(formatTime(item.replyCreated))}</time>
          <p>回复：${escapeHtml(item.replyAnswer || item.reply || '暂无内容')}</p>
        </div>
      </div>
      <div class="collab-card-bottom-left">
        ${renderQuestionMeta(item)}
      </div>
    </article>
  `
}

function renderQuestionRelations(relations = []) {
  return relations.length
    ? relations.map((relation) => `<span class="badge muted-badge">${escapeHtml(relation)}</span>`).join('')
    : ''
}

function renderQuestionMeta(item) {
  const created = item.created ? `<time>${escapeHtml(formatTime(item.created))}</time>` : '<time>未知时间</time>'
  return `<div class="collab-question-meta">${created}</div>`
}

function renderLogs(logs = []) {
  logIndexCount.textContent = `${logs.length} 条`
  if (!logs.length) {
    logIndex.innerHTML = '<p class="empty-panel">暂无工作记录。</p>'
    logDetail.innerHTML = ''
    return
  }
  state.selectedLogIndex = clampLogIndex(state.selectedLogIndex, logs)
  logIndex.innerHTML = logs.map((log, index) => `
    <button class="agent-log-toc-item ${index === state.selectedLogIndex ? 'active' : ''}" type="button" data-log-index="${index}">
      <span class="agent-log-toc-meta">
        ${log.shortId ? `<span class="task-short-id">${escapeHtml(log.shortId)}</span>` : ''}
        <span class="badge ${statusBadgeClass(log.status)}">${escapeHtml(statusText(log.status || 'done'))}</span>
      </span>
      <span class="agent-log-toc-relations">${renderLogTaskRefs(resolveLogTasks(log))}</span>
      <strong>${escapeHtml(primaryLogPrompt(log))}</strong>
      <small>${escapeHtml(log.title)} · ${escapeHtml(formatTime(log.created) || '未标注日期')}</small>
    </button>
  `).join('')
  logDetail.innerHTML = logs.map(renderLogCard).join('')
}

function renderLogCard(log, index) {
  const tasks = resolveLogTasks(log)
  return `
    <article class="card collab-log agent-log-card ${index === state.selectedLogIndex ? 'active' : ''}" data-agent-log="${index}">
      <div class="collab-card-head collab-card-head--meta">
        <div>
          <div class="log-badges">
            ${log.shortId ? `<span class="task-short-id">${escapeHtml(log.shortId)}</span>` : ''}
            <span class="badge ${statusBadgeClass(log.status)}">${escapeHtml(statusText(log.status || 'done'))}</span>
            ${log.source ? `<span class="badge muted-badge">${escapeHtml(log.source)}</span>` : ''}
          </div>
          <h3>${escapeHtml(log.title)}</h3>
          <small>${escapeHtml(formatTime(log.created) || '未标注日期')}</small>
        </div>
        <div class="log-task-relations">${renderLogTaskRefs(tasks)}</div>
      </div>
      ${log.userOriginal && log.userOriginal !== primaryLogPrompt(log) ? `<section><strong>用户原话</strong>${renderTextBlock(log.userOriginal)}</section>` : ''}
      ${renderFieldBlock('理解', log.understanding)}
      ${log.answer ? `<section class="answer"><span>回答</span>${renderTextBlock(log.answer)}</section>` : ''}
      ${renderMiniList('产出', log.outputs, { required: true })}
      ${renderMiniList('关键步骤', log.keySteps, { required: true })}
      ${renderMiniList('关键判断', log.decisions)}
      ${renderMiniList('执行动作', log.actions)}
      ${renderMiniList('修改文件', log.changedFiles)}
      ${renderMiniList('验证', log.verification, { required: true })}
      ${renderMiniList('后续事项', log.followUps)}
      ${renderFieldBlock('验收标准', log.acceptance, { list: true })}
    </article>
  `
}

function primaryLogPrompt(log) {
  return log.userGoal || log.userOriginal || log.answer || log.title
}

function openAgentLog(index) {
  const logs = state.dashboard?.logs || []
  state.selectedLogIndex = clampLogIndex(Number(index || 0), logs)
  renderLogs(logs)
  window.setTimeout(() => {
    const log = document.querySelector(`[data-agent-log="${cssEscape(state.selectedLogIndex)}"]`)
    log?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    log?.classList.add('collab-log-highlight')
    window.setTimeout(() => log?.classList.remove('collab-log-highlight'), 1800)
  }, 0)
}

function openBoardTask(taskId) {
  setActiveSection('board')
  window.setTimeout(() => {
    const card = document.querySelector(`[data-task-card="${cssEscape(taskId)}"]`)
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    card?.classList.add('task-highlight')
    window.setTimeout(() => card?.classList.remove('task-highlight'), 1600)
  }, 0)
}

function openThought(thoughtId) {
  setActiveSection('capture')
  window.setTimeout(() => {
    const card = document.querySelector(`[data-thought-card="${cssEscape(thoughtId || '')}"]`)
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    card?.classList.add('thought-highlight')
    window.setTimeout(() => card?.classList.remove('thought-highlight'), 1600)
  }, 0)
}

function resolveLogTasks(log) {
  return (log.relatedTasks || []).map((task) => {
    const matched = state.dashboard?.tasks.find((item) => item.shortId === task.shortId)
    return {
      shortId: task.shortId || matched?.shortId || '',
      id: task.id || matched?.id || '',
      title: task.title || matched?.title || '',
      status: task.status || matched?.status || '',
    }
  })
}

function renderLogTaskRefs(tasks = []) {
  return tasks.length
    ? tasks.map((task) => `<span class="task-short-id">${escapeHtml(task.shortId)}</span>`).join('')
    : '<span class="badge muted-badge">general</span>'
}

function renderFieldBlock(title, value, options = {}) {
  const content = options.list ? renderListTextBlock(value) : renderTextBlock(value)
  return `
    <section class="${content ? '' : 'missing-field'}">
      <strong>${escapeHtml(title)}</strong>
      ${content || '<p>未记录</p>'}
    </section>
  `
}

function renderMiniList(title, items = [], options = {}) {
  return items?.length ? `
    <section>
      <strong>${escapeHtml(title)}</strong>
      <ul>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>
    </section>
  ` : options.required ? `
    <section class="missing-field">
      <strong>${escapeHtml(title)}</strong>
      <p>未记录</p>
    </section>
  ` : ''
}

function renderTextBlock(value) {
  const paragraphs = String(value || '')
    .split(/\n{2,}/)
    .map((text) => text.trim())
    .filter(Boolean)
  return paragraphs.length
    ? paragraphs.map((text) => `<p>${text.split('\n').map(renderInlineMarkdown).join('<br>')}</p>`).join('')
    : ''
}

function renderListTextBlock(value) {
  const lines = String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (!lines.length) return ''
  if (lines.some((line) => /^[-*]\s+/.test(line))) {
    return `<ul>${lines.map((line) => `<li>${renderInlineMarkdown(line.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`
  }
  return renderTextBlock(value)
}

function statusText(status) {
  return statusLabels[status] || String(status || 'Todo')
}

function statusBadgeClass(status) {
  if (status === 'done') return ''
  if (status === 'doing') return 'warning-badge'
  if (status === 'abandoned') return 'danger-badge'
  return 'muted-badge'
}

function logStatusClass(status) {
  return statusBadgeClass(status)
}

function renderKnowledge(dashboard) {
  const knowledge = dashboard.knowledge || []

  if (!knowledge.length) {
    return '<p class="empty-panel">暂无知识条目。</p>'
  }

  return `
    <div class="knowledge-list-wrap">
      <div class="knowledge-list-spacer" aria-hidden="true"></div>
      <div class="knowledge-list">
        ${knowledge.map((note, index) => renderKnowledgeNote(note, index)).join('')}
      </div>
    </div>
    <aside class="knowledge-index ${state.knowledgeTocCollapsed ? 'is-collapsed' : ''}">
      <div class="section-head compact-head knowledge-index-head">
        <h2>${state.knowledgeTocCollapsed ? '' : '目录'}</h2>
        <button class="btn icon-button btn-outline-secondary btn-sm" type="button" data-toggle-knowledge-toc title="${state.knowledgeTocCollapsed ? '展开目录' : '收起目录'}" aria-label="${state.knowledgeTocCollapsed ? '展开目录' : '收起目录'}">
          ${icon(state.knowledgeTocCollapsed ? 'panelRightOpen' : 'panelRightClose')}
        </button>
      </div>
      ${state.knowledgeTocCollapsed ? '' : `
        <div class="knowledge-toc">
          ${knowledge.map((note, index) => renderKnowledgeTocItem(note, index)).join('')}
        </div>
      `}
    </aside>
  `
}

function renderKnowledgeNote(note, index) {
  const displayTitle = knowledgeDisplayTitle(note)
  const refs = validRefs([
    note.source,
    ...(note.relatedRecords || []),
    ...(note.relatedTasks || []),
    ...(note.relatedNotes || []),
  ])
  return `
    <article class="card knowledge-item" data-knowledge-card="${index}">
      <div class="knowledge-head">
        <div>
          <span class="task-short-id">${escapeHtml(note.shortId || 'K000')}</span>
          <strong>${escapeHtml(displayTitle)}</strong>
          ${displayTitle !== note.title ? `<small>${escapeHtml(note.title)}</small>` : ''}
        </div>
        <div class="knowledge-actions">
          <span class="badge muted-badge">${escapeHtml(knowledgeStatusText(note.status))}</span>
          ${note.updated ? `<small>${escapeHtml(formatTime(note.updated))}</small>` : ''}
        </div>
      </div>
      <section class="knowledge-block">
        <strong>重点</strong>
        <p>${escapeHtml(knowledgeDisplaySummary(note, displayTitle))}</p>
      </section>
      <section class="knowledge-block knowledge-body">
        <strong>详细答案</strong>
        <div class="rendered-markdown">
          ${renderReadableMarkdown(knowledgeBodyContent(note.content))}
        </div>
      </section>
      ${note.tags?.length ? `<div class="knowledge-tags">${note.tags.map((tag) => `<span class="badge muted-badge">#${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
      ${refs.length ? `<div class="knowledge-tags">${refs.map((ref) => `<span class="badge">${escapeHtml(ref)}</span>`).join('')}</div>` : ''}
    </article>
  `
}

function renderKnowledgeTocItem(note, index) {
  const displayTitle = knowledgeDisplayTitle(note)
  return `
    <button class="knowledge-toc-item" type="button" data-knowledge-index="${index}">
      <span>${escapeHtml(note.shortId || 'K000')}</span>
      <strong>${escapeHtml(displayTitle)}</strong>
      <small>${escapeHtml(knowledgeTocSummary(note, displayTitle))}</small>
    </button>
  `
}

function knowledgeDisplayTitle(note) {
  return knowledgeFocusHeading(note.content)
    || knowledgeSummaryHeadline(note.summary, note.title)
    || note.title
}

function knowledgeFocusHeading(content) {
  const genericHeadings = new Set(['项目', '概览', '总览', '背景', '目标', '目录', '说明', '知识结构'])
  const headings = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^#{2,3}\s+(.+)$/)?.[1]?.trim())
    .filter(Boolean)
  return headings.find((heading) => !genericHeadings.has(heading)) || headings[0] || ''
}

function knowledgeSummaryHeadline(summary, fallbackTitle) {
  const text = String(summary || '').trim()
  if (!text || text === fallbackTitle || /^[-*]\s+/.test(text)) return ''
  return text.split(/[。.!！\n]/).map((item) => item.trim()).find(Boolean) || ''
}

function knowledgeTocSummary(note, displayTitle) {
  if (displayTitle !== note.title) return note.title
  return note.summary || noteCategory(note.path)
}

function knowledgeDisplaySummary(note, displayTitle) {
  const summary = String(note.summary || '').trim()
  if (isUsefulKnowledgeSummary(summary, note.title)) return summary
  return knowledgeSectionSummary(note.content, displayTitle) || summary || '暂无摘要。'
}

function isUsefulKnowledgeSummary(summary, title) {
  if (!summary || summary === title) return false
  if (/^- 名称[:：]/.test(summary)) return false
  if (/数据层[:：]/.test(summary) && summary.length < 80) return false
  return true
}

function knowledgeSectionSummary(content, heading) {
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

function knowledgeBodyContent(content) {
  const lines = String(content || '').split(/\r?\n/)
  const firstSectionIndex = lines.findIndex((line) => /^##\s+/.test(line.trim()))
  if (firstSectionIndex >= 0) return lines.slice(firstSectionIndex).join('\n').trim()
  return lines
    .filter((line) => !/^#\s+/.test(line.trim()) && !/^[A-Za-z0-9_-]+::\s*/.test(line.trim()))
    .join('\n')
    .trim()
}

function openKnowledge(index) {
  const targetIndex = Number(index || 0)
  const card = document.querySelector(`[data-knowledge-card="${cssEscape(targetIndex)}"]`)
  card?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  card?.classList.add('knowledge-highlight')
  window.setTimeout(() => card?.classList.remove('knowledge-highlight'), 1600)
}

function renderDocuments(dashboard) {
  const documents = dashboard.documents || []

  if (!documents.length) {
    return '<p class="empty-panel">暂无文档。</p>'
  }

  const groups = groupDocumentsByFolder(documents)
  return Object.entries(groups).map(([folder, notes]) => `
    <section class="document-group">
      <div class="knowledge-group-head">
        <strong>${escapeHtml(folder || '根目录')}</strong>
        <span>${notes.length} 条</span>
      </div>
      <div class="document-list">
        ${notes.map(renderDocumentNote).join('')}
      </div>
    </section>
  `).join('')
}

function groupDocumentsByFolder(documents) {
  return documents.reduce((groups, note) => {
    const folder = note.folder || '根目录'
    groups[folder] = groups[folder] || []
    groups[folder].push(note)
    return groups
  }, {})
}

function knowledgeStatusText(status) {
  return {
    active: '生效中',
    archived: '已归档',
    draft: '草稿',
  }[status] || status || '生效中'
}

function renderDocumentNote(note) {
  const labels = [
    note.shortId,
    note.type,
    note.status,
  ].filter(Boolean)
  return `
    <article class="card note-row">
      <div class="document-row-head">
        <strong>${escapeHtml(note.title)}</strong>
        <span>${escapeHtml(noteCategory(note.path))}</span>
      </div>
      <code>${escapeHtml(note.path)}</code>
      ${note.summary ? `<p>${escapeHtml(note.summary)}</p>` : ''}
      ${labels.length ? `<div class="knowledge-tags">${labels.map((label) => `<span class="badge muted-badge">${escapeHtml(label)}</span>`).join('')}</div>` : ''}
    </article>
  `
}

function validRefs(refs = []) {
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

function findTaskIdByShortId(shortId) {
  return state.dashboard?.tasks.find((task) => task.shortId === shortId)?.id || ''
}

function findThoughtIdByShortId(shortId) {
  return state.dashboard?.thoughts.find((thought) => thought.shortId === shortId)?.id || ''
}

function closeQuickTask() {
  quickTask.classList.remove('is-open')
  state.quickCreateMode = ''
  quickTaskToggle.setAttribute('aria-expanded', 'false')
  updateQuickCreateView()
}

function openReplyDialog(item) {
  state.replyItem = item
  replyQuestionText.textContent = item.openQuestions || '待确认'
  replyInput.value = ''
  replyStatusText.textContent = ''
  render()
  window.setTimeout(() => replyInput.focus(), 0)
}

function closeReplyDialog() {
  state.replyItem = null
  replyInput.value = ''
  replyStatusText.textContent = ''
  render()
}

function updateQuickCreateView() {
  quickTask.dataset.mode = state.quickCreateMode
  quickCreateMenu.hidden = !quickTask.classList.contains('is-open') || Boolean(state.quickCreateMode)
  quickTaskForm.hidden = state.quickCreateMode !== 'task'
  quickThoughtForm.hidden = state.quickCreateMode !== 'thought'
  quickDialogueForm.hidden = state.quickCreateMode !== 'dialogue'
  if (state.quickCreateMode === 'task') window.setTimeout(() => quickTaskTitle.focus(), 0)
  if (state.quickCreateMode === 'thought') window.setTimeout(() => quickThoughtInput.focus(), 0)
  if (state.quickCreateMode === 'dialogue') window.setTimeout(() => quickDialogueInput.focus(), 0)
}

function ensureApi() {
  if (!window.electronManager) throw new Error('preload API 未注入，请重新启动 Electron。')
}

function ensureReadyForInit() {
  ensureApi()
  if (!state.projectRoot) throw new Error('请先打开项目。')
}

function ensureReady() {
  ensureApi()
  if (!state.projectRoot || !state.initialized) {
    setStatus('请先打开并初始化项目。')
    return false
  }
  return true
}

function setupAutoRefresh() {
  if (!window.electronManager?.onProjectDataChanged) return
  window.electronManager.onProjectDataChanged((payload) => {
    if (!payload?.projectRoot || payload.projectRoot !== state.projectRoot || !state.initialized) return
    refreshDashboard({ quiet: true })
  })
}

async function refreshDashboard({ quiet = false } = {}) {
  if (!ensureReady()) return
  if (state.autoRefreshing) return
  state.autoRefreshing = true
  try {
    const dashboard = await window.electronManager.getDashboard(state.projectRoot)
    updateDashboard(dashboard)
    if (!quiet) setStatus('')
  } catch (error) {
    console.error(error)
    if (!quiet) setStatus(error?.message || '刷新失败。')
  } finally {
    state.autoRefreshing = false
  }
}

async function runAction(message, action) {
  try {
    state.busy = true
    setStatus(message)
    render()
    await action()
  } catch (error) {
    console.error(error)
    setStatus(error?.message || '操作失败。')
  } finally {
    state.busy = false
    render()
  }
}

function setStatus(message) {
  appStatus.textContent = message
}

function showToast(message) {
  if (!toastStack || !message) return
  const toast = document.createElement('div')
  toast.className = 'toast-message'
  toast.textContent = message
  toastStack.append(toast)
  window.setTimeout(() => toast.classList.add('is-leaving'), 1800)
  window.setTimeout(() => toast.remove(), 2200)
}

function renderBrief(brief) {
  briefSummary.textContent = brief
    ? '复制给新 Agent 的同步指令'
    : '打开项目后显示同步入口。'
}

function syncEntryText(brief) {
  if (!brief?.dataRoot) return ''
  const skillPath = brief.skillPath || `${brief.dataRoot}/skills/project-collaboration/SKILL.md`
  return `请读取 Electron Manager 同步入口：

1. ${brief.dataRoot}/agent-brief.json
2. ${skillPath}

先按 agent-brief 建立上下文；只有执行具体任务时，再按 brief.paths/skill 读取对应 Markdown。按 brief/skill 更新任务状态和工作记录，不要回滚无关改动。`
}

function renderReadableMarkdown(markdown) {
  const lines = String(markdown || '').split(/\r?\n/)
  const html = []
  let listOpen = false
  let codeOpen = false
  let codeLanguage = ''
  let codeLines = []

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
      if (codeOpen) {
        closeCode()
      } else {
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

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function noteCategory(filePath) {
  if (filePath.startsWith('00_')) return '项目管理'
  if (filePath.startsWith('01_')) return '知识结构'
  if (filePath.startsWith('02_')) return '运行说明'
  if (filePath.startsWith('03_')) return '可视化入口'
  if (filePath.startsWith('04_')) return '记录'
  return '文档'
}

function projectDisplayName(projectRoot) {
  return String(projectRoot || '').split(/[\\/]/).filter(Boolean).at(-1) || projectRoot
}

function setButtonIcon(button, name) {
  if (!button) return
  button.innerHTML = icon(name)
}

function icon(name) {
  const paths = icons[name] || icons.check
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`
}

function selectText(element) {
  const range = document.createRange()
  range.selectNodeContents(element)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
}

function formatTime(value) {
  if (!value) return '未知时间'
  const date = parseDisplayDate(value)
  if (Number.isNaN(date.getTime())) return value
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function parseDisplayDate(value) {
  if (value instanceof Date) return value
  const text = String(value || '').trim()
  const localMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/)
  if (localMatch && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
    return new Date(
      Number(localMatch[1]),
      Number(localMatch[2]) - 1,
      Number(localMatch[3]),
      Number(localMatch[4] || 0),
      Number(localMatch[5] || 0),
    )
  }
  return new Date(text)
}

function clampLogIndex(index, logs = []) {
  if (!logs.length) return 0
  if (!Number.isFinite(index)) return 0
  return Math.min(Math.max(index, 0), logs.length - 1)
}

function priorityClass(priority) {
  if (priority === 'high') return 'danger-badge'
  if (priority === 'low') return 'muted-badge'
  return ''
}

function cssEscape(value) {
  if (window.CSS?.escape) return CSS.escape(String(value))
  return String(value).replace(/["\\]/g, '\\$&')
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

render()
if (window.electronManager) {
  restoreLastProject()
} else {
  setStatus('preload API 未注入，请重新启动 Electron。')
}
