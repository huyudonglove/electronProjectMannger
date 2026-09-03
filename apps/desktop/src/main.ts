import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions, type WebContents } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  appendTask,
  appendDialogue,
  appendConstraint,
  appendProjectQuestion,
  appendThought,
  createProjectVersion,
  deleteConstraint,
  deleteDialogue,
  deleteDocument,
  deleteKnowledge,
  deleteTask,
  deleteThought,
  getDashboard,
  initProject,
  isInitialized,
  listManagedProjects,
  recordProjectOpen,
  removeManagedProject,
  replyOpenQuestion,
  refreshRecordSummary,
  updateQuestionStatus,
  updateRiskStatus,
  updateProjectMetadata,
  updateProjectVersionStatus,
  updateAllProjectMetadata,
  updateTaskStatus,
} from '@telance-records/project-core'
import { WindowController } from './window-controller.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appIconPath = path.join(__dirname, '..', 'assets', 'icon.png')

let mainWindow: BrowserWindow | null = null
let managerDataRoot = ''
let projectWatchers: FSWatcher[] = []
let watchedProjectRoot = ''
let watcherTimer: NodeJS.Timeout | null = null
let windowController: WindowController | null = null
let quitAfterWindowFlush = false
let quitFlushInProgress = false

app.setPath('userData', path.join(app.getPath('appData'), 'electron-manager'))

async function createWindow() {
  windowController ||= await WindowController.load(managerDataRoot)
  const windowOptions = windowController.initialWindowOptions()
  mainWindow = new BrowserWindow({
    ...windowOptions,
    title: 'Telance Records',
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  windowController.attach(mainWindow)
  mainWindow.once('closed', () => { mainWindow = null })

  await mainWindow.loadFile(path.join(__dirname, '..', 'renderer-vue', 'index.html'))

  if (process.env.TELANCE_RECORDS_DEVTOOLS === '1' || process.env.ELECTRON_MANAGER_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.setIcon(appIconPath)
  managerDataRoot = app.getPath('userData')
  const metadataResults = await updateAllProjectMetadata(managerDataRoot)
  for (const result of metadataResults) {
    if (result.status === 'failed') {
      console.warn(`failed to update metadata for ${result.projectName}`, result.error)
    }
  }
  registerIpc()
  await createWindow()
})

app.on('window-all-closed', () => {
  stopProjectWatcher()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  stopProjectWatcher()
  if (quitAfterWindowFlush || !windowController) return

  event.preventDefault()
  if (quitFlushInProgress) return
  quitFlushInProgress = true
  void windowController.flush()
    .catch((error) => console.warn('failed to flush window preferences before quit', error))
    .finally(() => {
      quitAfterWindowFlush = true
      app.quit()
    })
})

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) await createWindow()
})

function registerIpc() {
  ipcMain.handle('window:get-companion-state', (event) => {
    assertMainWindowSender(event.sender)
    return windowController?.state() || { enabled: false, alwaysOnTop: true }
  })

  ipcMain.handle('window:set-companion-mode', async (event, enabled: boolean) => {
    assertMainWindowSender(event.sender)
    if (typeof enabled !== 'boolean') throw new Error('陪伴模式参数无效')
    if (!windowController) throw new Error('窗口控制器尚未就绪')
    return windowController.setCompanionMode(enabled)
  })

  ipcMain.handle('window:set-companion-always-on-top', async (event, alwaysOnTop: boolean) => {
    assertMainWindowSender(event.sender)
    if (typeof alwaysOnTop !== 'boolean') throw new Error('窗口置顶参数无效')
    if (!windowController) throw new Error('窗口控制器尚未就绪')
    return windowController.setCompanionAlwaysOnTop(alwaysOnTop)
  })

  ipcMain.handle('project:open-folder', async () => {
    mainWindow?.focus()
    const options: OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择项目文件夹',
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || !result.filePaths[0]) return null
    return openProject(result.filePaths[0])
  })

  ipcMain.handle('project:list-recent', async () => {
    return listManagedProjects(managerDataRoot)
  })

  ipcMain.handle('project:remove-recent', async (_event, projectId: string) => {
    return removeManagedProject(managerDataRoot, projectId)
  })

  ipcMain.handle('project:open-path', async (_event, projectRoot: string) => {
    return openProject(projectRoot)
  })

  ipcMain.handle('system:open-folder', async (_event, folderPath: string) => {
    if (!folderPath) throw new Error('文件夹路径不能为空')
    const error = await shell.openPath(folderPath)
    if (error) throw new Error(error)
    return true
  })

  ipcMain.handle('project:init', async (_event, projectRoot: string) => {
    const dashboard = await initProject(managerDataRoot, projectRoot)
    startProjectWatcher(projectRoot, [dashboard.config.dataRoot, dashboard.recordSummary.knowledgeRoot])
    return dashboard
  })

  ipcMain.handle('project:refresh-summary', async (_event, projectRoot: string) => {
    return refreshRecordSummary(managerDataRoot, projectRoot)
  })

  ipcMain.handle('project:get-dashboard', async (_event, projectRoot: string) => {
    return getDashboard(managerDataRoot, projectRoot)
  })

  ipcMain.handle('project:update-metadata', async (_event, projectRoot: string) => {
    const dashboard = await updateProjectMetadata(managerDataRoot, projectRoot)
    startProjectWatcher(projectRoot, [dashboard.config.dataRoot, dashboard.recordSummary.knowledgeRoot])
    return dashboard
  })

  ipcMain.handle('project:add-task', async (_event, projectRoot: string, payload) => {
    return appendTask(managerDataRoot, projectRoot, payload)
  })

  ipcMain.handle('project:create-version', async (_event, projectRoot: string, payload) => {
    return createProjectVersion(managerDataRoot, projectRoot, payload)
  })

  ipcMain.handle('project:update-version-status', async (
    _event,
    projectRoot: string,
    versionId: string,
    status: string,
  ) => {
    return updateProjectVersionStatus(managerDataRoot, projectRoot, versionId, status as 'planned' | 'active' | 'paused' | 'completed')
  })

  ipcMain.handle('project:add-question', async (_event, projectRoot: string, payload) => {
    return appendProjectQuestion(managerDataRoot, projectRoot, payload)
  })

  ipcMain.handle('project:update-question-status', async (
    _event,
    projectRoot: string,
    questionId: string,
    status: string,
  ) => {
    return updateQuestionStatus(managerDataRoot, projectRoot, questionId, status as 'open' | 'decided' | 'resolved' | 'expired')
  })

  ipcMain.handle('project:update-risk-status', async (
    _event,
    projectRoot: string,
    riskId: string,
    status: string,
  ) => {
    return updateRiskStatus(managerDataRoot, projectRoot, riskId, status as 'open' | 'resolved' | 'expired')
  })

  ipcMain.handle('project:update-task-status', async (_event, projectRoot: string, taskId: string, status: string) => {
    return updateTaskStatus(managerDataRoot, projectRoot, taskId, status)
  })

  ipcMain.handle('project:delete-task', async (_event, projectRoot: string, taskId: string) => {
    return deleteTask(managerDataRoot, projectRoot, taskId)
  })

  ipcMain.handle('project:add-thought', async (_event, projectRoot: string, payload) => {
    return appendThought(managerDataRoot, projectRoot, payload)
  })

  ipcMain.handle('project:add-dialogue', async (_event, projectRoot: string, payload) => {
    return appendDialogue(managerDataRoot, projectRoot, payload)
  })

  ipcMain.handle('project:delete-dialogue', async (_event, projectRoot: string, dialogueId: string) => {
    return deleteDialogue(managerDataRoot, projectRoot, dialogueId)
  })

  ipcMain.handle('project:add-constraint', async (_event, projectRoot: string, payload) => {
    return appendConstraint(managerDataRoot, projectRoot, payload)
  })

  ipcMain.handle('project:delete-constraint', async (_event, projectRoot: string, constraintId: string) => {
    return deleteConstraint(managerDataRoot, projectRoot, constraintId)
  })

  ipcMain.handle('project:delete-document', async (_event, projectRoot: string, documentTarget: string) => {
    return deleteDocument(managerDataRoot, projectRoot, documentTarget)
  })

  ipcMain.handle('project:delete-knowledge', async (_event, projectRoot: string, knowledgeTarget: string) => {
    return deleteKnowledge(managerDataRoot, projectRoot, knowledgeTarget)
  })

  ipcMain.handle('project:delete-thought', async (_event, projectRoot: string, thoughtId: string) => {
    return deleteThought(managerDataRoot, projectRoot, thoughtId)
  })

  ipcMain.handle('project:reply-open-question', async (_event, projectRoot: string, payload) => {
    return replyOpenQuestion(managerDataRoot, projectRoot, payload)
  })

}

function assertMainWindowSender(sender: WebContents) {
  if (!mainWindow || mainWindow.isDestroyed() || sender !== mainWindow.webContents) {
    throw new Error('无效的窗口请求来源')
  }
}

async function openProject(projectRoot: string) {
  const initialized = await isInitialized(managerDataRoot, projectRoot)
  if (!initialized) {
    stopProjectWatcher()
    return {
      initialized,
      projectRoot,
      dashboard: null,
    }
  }

  const project = await recordProjectOpen(managerDataRoot, projectRoot)
  await refreshRecordSummary(managerDataRoot, projectRoot)
  const dashboard = await getDashboard(managerDataRoot, projectRoot)
  startProjectWatcher(projectRoot, [dashboard.config.dataRoot, dashboard.recordSummary.knowledgeRoot])

  return {
    initialized,
    projectRoot,
    project,
    dashboard,
  }
}

function startProjectWatcher(projectRoot: string, watchRoots: string[]) {
  if (watchedProjectRoot === projectRoot && projectWatchers.length) return

  stopProjectWatcher()
  watchedProjectRoot = projectRoot

  const uniqueRoots = [...new Set(watchRoots.filter(Boolean))]
  for (const watchRoot of uniqueRoots) {
    try {
      projectWatchers.push(watch(watchRoot, { recursive: true }, (_eventType, filename) => {
        const changedPath = String(filename || '').replaceAll('\\', '/')
        if (changedPath && !changedPath.toLowerCase().endsWith('.md')) return
        if (
          changedPath.endsWith('record-summary.json')
          || changedPath.endsWith('index.json')
          || changedPath.endsWith('metadata/当前项目基线.md')
        ) return
        if (watcherTimer) clearTimeout(watcherTimer)
        watcherTimer = setTimeout(async () => {
          try {
            await refreshRecordSummary(managerDataRoot, projectRoot)
            mainWindow?.webContents.send('project:data-changed', { projectRoot })
          } catch (error) {
            console.warn('failed to refresh record summary after Markdown change', error)
          }
        }, 250)
      }))
    } catch (error) {
      console.warn('failed to watch data root', watchRoot, error)
    }
  }
}

function stopProjectWatcher() {
  if (watcherTimer) {
    clearTimeout(watcherTimer)
    watcherTimer = null
  }
  for (const watcher of projectWatchers) watcher.close()
  projectWatchers = []
  watchedProjectRoot = ''
}
