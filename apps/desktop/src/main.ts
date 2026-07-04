import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron'
import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  appendTask,
  appendDialogue,
  appendThought,
  deleteTask,
  deleteThought,
  getDashboard,
  initProject,
  isInitialized,
  listManagedProjects,
  recordProjectOpen,
  removeManagedProject,
  replyOpenQuestion,
  refreshAgentBrief,
  updateProjectGuidance,
  updateTaskStatus,
} from '@electron-manager/project-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let managerDataRoot = ''
let projectWatcher: FSWatcher | null = null
let watchedProjectRoot = ''
let watcherTimer: NodeJS.Timeout | null = null

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'Electron Manager',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  await mainWindow.loadFile(path.join(__dirname, '..', 'renderer-vue', 'index.html'))

  if (process.env.ELECTRON_MANAGER_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
}

app.whenReady().then(async () => {
  managerDataRoot = app.getPath('userData')
  registerIpc()
  await createWindow()
})

app.on('window-all-closed', () => {
  stopProjectWatcher()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) await createWindow()
})

function registerIpc() {
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
    startProjectWatcher(projectRoot, dashboard.config.dataRoot)
    return dashboard
  })

  ipcMain.handle('project:refresh-brief', async (_event, projectRoot: string) => {
    return refreshAgentBrief(managerDataRoot, projectRoot)
  })

  ipcMain.handle('project:get-dashboard', async (_event, projectRoot: string) => {
    return getDashboard(managerDataRoot, projectRoot)
  })

  ipcMain.handle('project:update-guidance', async (_event, projectRoot: string) => {
    const dashboard = await updateProjectGuidance(managerDataRoot, projectRoot)
    startProjectWatcher(projectRoot, dashboard.config.dataRoot)
    return dashboard
  })

  ipcMain.handle('project:add-task', async (_event, projectRoot: string, payload) => {
    return appendTask(managerDataRoot, projectRoot, payload)
  })

  ipcMain.handle('project:update-task-status', async (_event, projectRoot: string, taskId: string, status: string) => {
    return updateTaskStatus(managerDataRoot, projectRoot, taskId, status)
  })

  ipcMain.handle('project:delete-task', async (_event, projectRoot: string, taskId: string) => {
    return deleteTask(managerDataRoot, projectRoot, taskId)
  })

  ipcMain.handle('project:add-thought', async (_event, projectRoot: string, content: string) => {
    return appendThought(managerDataRoot, projectRoot, content)
  })

  ipcMain.handle('project:add-dialogue', async (_event, projectRoot: string, payload) => {
    return appendDialogue(managerDataRoot, projectRoot, payload)
  })

  ipcMain.handle('project:delete-thought', async (_event, projectRoot: string, thoughtId: string) => {
    return deleteThought(managerDataRoot, projectRoot, thoughtId)
  })

  ipcMain.handle('project:reply-open-question', async (_event, projectRoot: string, payload) => {
    return replyOpenQuestion(managerDataRoot, projectRoot, payload)
  })
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
  const dashboard = await getDashboard(managerDataRoot, projectRoot)
  startProjectWatcher(projectRoot, dashboard.config.dataRoot)

  return {
    initialized,
    projectRoot,
    project,
    dashboard,
  }
}

function startProjectWatcher(projectRoot: string, dataRoot: string) {
  if (watchedProjectRoot === projectRoot && projectWatcher) return

  stopProjectWatcher()
  watchedProjectRoot = projectRoot

  try {
    projectWatcher = watch(dataRoot, { recursive: true }, () => {
      if (watcherTimer) clearTimeout(watcherTimer)
      watcherTimer = setTimeout(() => {
        mainWindow?.webContents.send('project:data-changed', { projectRoot })
      }, 250)
    })
  } catch (error) {
    console.warn('failed to watch project data root', error)
  }
}

function stopProjectWatcher() {
  if (watcherTimer) {
    clearTimeout(watcherTimer)
    watcherTimer = null
  }
  projectWatcher?.close()
  projectWatcher = null
  watchedProjectRoot = ''
}
