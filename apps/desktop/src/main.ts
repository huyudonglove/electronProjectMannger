import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron'
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
  refreshAgentBrief,
  updateQuestionStatus,
  updateRiskStatus,
  updateProjectGuidance,
  updateAllProjectGuidance,
  updateTaskStatus,
} from '@electron-manager/project-core'

import { registerAgentIpc } from './agent-ipc.js'
import type { AppDiagnosticInput } from './app-diagnostics.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let managerDataRoot = ''
let projectWatchers: FSWatcher[] = []
let watchedProjectRoot = ''
let watcherTimer: NodeJS.Timeout | null = null
let codeMapWatcher: FSWatcher | null = null
let codeMapTimer: NodeJS.Timeout | null = null
let cancelAllAgentRuns: (() => number) | null = null
let ensureCodeMap: ((projectRoot: string) => Promise<unknown>) | null = null
let reconcileCodeMap: ((projectRoot: string) => Promise<unknown>) | null = null
let appendAppDiagnostic: ((input: AppDiagnosticInput) => Promise<void>) | null = null
let agentShutdownComplete = false

app.setPath('userData', path.join(app.getPath('appData'), 'electron-manager'))

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'Electron Manager',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    void appendAppDiagnostic?.({
      level: 'error', category: 'startup', event: 'renderer.process-gone',
      message: details.reason, context: { exitCode: details.exitCode },
    })
  })
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    void appendAppDiagnostic?.({
      level: 'error', category: 'startup', event: 'renderer.load.failed', message: errorDescription,
      context: { errorCode, url: validatedURL },
    })
  })

  await mainWindow.loadFile(path.join(__dirname, '..', 'renderer-vue', 'index.html'))

  if (process.env.ELECTRON_MANAGER_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
}

const applicationReady = app.whenReady().then(async () => {
  managerDataRoot = app.getPath('userData')
  registerIpc()
  const agentIpc = registerAgentIpc(managerDataRoot, (notification) => {
    mainWindow?.webContents.send('agent:runs:changed', notification)
  }, (projectRoot) => {
    mainWindow?.webContents.send('agent:project-maps:changed', { projectRoot })
  })
  ensureCodeMap = (projectRoot) => agentIpc.codeMaps.ensure(projectRoot)
  reconcileCodeMap = (projectRoot) => agentIpc.codeMaps.reconcile(projectRoot)
  appendAppDiagnostic = (input) => agentIpc.appDiagnostics.append(input)
  cancelAllAgentRuns = () => agentIpc.coordinator.cancelAllActiveRuns()
  await createWindow()
  void updateAllProjectGuidance(managerDataRoot)
    .then((guidanceResults) => {
      for (const result of guidanceResults) {
        if (result.status === 'failed') {
          console.warn(`failed to update guidance for ${result.projectName}`, result.error)
          void appendAppDiagnostic?.({
            level: 'warning', category: 'startup', event: 'guidance.update.failed',
            message: result.error, context: { projectName: result.projectName },
          })
        }
      }
    })
    .catch((error) => {
      console.warn('failed to update project guidance in the background', error)
      void appendAppDiagnostic?.({ level: 'error', category: 'startup', event: 'guidance.update-all.failed', error })
    })
})

applicationReady.catch((error) => {
  console.error('Electron Manager failed to initialize.', error)
  void appendAppDiagnostic?.({ level: 'error', category: 'startup', event: 'application.initialize.failed', error })
  app.quit()
})

app.on('before-quit', (event) => {
  if (agentShutdownComplete) return
  const cancelled = cancelAllAgentRuns?.() || 0
  if (!cancelled) return
  event.preventDefault()
  setTimeout(() => {
    agentShutdownComplete = true
    app.quit()
  }, 650)
})

app.on('window-all-closed', () => {
  stopProjectWatcher()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', async () => {
  await applicationReady
  if (BrowserWindow.getAllWindows().length === 0) await createWindow()
})

function registerIpc() {
  handleIpc('project:open-folder', async () => {
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

  handleIpc('project:list-recent', async () => {
    return listManagedProjects(managerDataRoot)
  })

  handleIpc('project:remove-recent', async (_event, projectId: string) => {
    return removeManagedProject(managerDataRoot, projectId)
  })

  handleIpc('project:open-path', async (_event, projectRoot: string) => {
    return openProject(projectRoot)
  })

  handleIpc('system:open-folder', async (_event, folderPath: string) => {
    if (!folderPath) throw new Error('文件夹路径不能为空')
    const error = await shell.openPath(folderPath)
    if (error) throw new Error(error)
    return true
  })

  handleIpc('project:init', async (_event, projectRoot: string) => {
    const dashboard = await initProject(managerDataRoot, projectRoot)
    await ensureCodeMap?.(projectRoot)
    startProjectWatcher(projectRoot, [dashboard.config.dataRoot, dashboard.agentBrief.knowledgeRoot])
    return dashboard
  })

  handleIpc('project:refresh-brief', async (_event, projectRoot: string) => {
    return refreshAgentBrief(managerDataRoot, projectRoot)
  })

  handleIpc('project:get-dashboard', async (_event, projectRoot: string) => {
    return getDashboard(managerDataRoot, projectRoot)
  })

  handleIpc('project:update-guidance', async (_event, projectRoot: string) => {
    const dashboard = await updateProjectGuidance(managerDataRoot, projectRoot)
    startProjectWatcher(projectRoot, [dashboard.config.dataRoot, dashboard.agentBrief.knowledgeRoot])
    return dashboard
  })

  handleIpc('project:add-task', async (_event, projectRoot: string, payload: Parameters<typeof appendTask>[2]) => {
    return appendTask(managerDataRoot, projectRoot, payload)
  })

  handleIpc('project:create-version', async (_event, projectRoot: string, payload: Parameters<typeof createProjectVersion>[2]) => {
    return createProjectVersion(managerDataRoot, projectRoot, payload)
  })

  handleIpc('project:add-question', async (_event, projectRoot: string, payload: Parameters<typeof appendProjectQuestion>[2]) => {
    return appendProjectQuestion(managerDataRoot, projectRoot, payload)
  })

  handleIpc('project:update-question-status', async (
    _event,
    projectRoot: string,
    questionId: string,
    status: string,
  ) => {
    return updateQuestionStatus(managerDataRoot, projectRoot, questionId, status as 'open' | 'decided' | 'resolved' | 'expired')
  })

  handleIpc('project:update-risk-status', async (
    _event,
    projectRoot: string,
    riskId: string,
    status: string,
  ) => {
    return updateRiskStatus(managerDataRoot, projectRoot, riskId, status as 'open' | 'resolved' | 'expired')
  })

  handleIpc('project:update-task-status', async (_event, projectRoot: string, taskId: string, status: string) => {
    return updateTaskStatus(managerDataRoot, projectRoot, taskId, status)
  })

  handleIpc('project:delete-task', async (_event, projectRoot: string, taskId: string) => {
    return deleteTask(managerDataRoot, projectRoot, taskId)
  })

  handleIpc('project:add-thought', async (_event, projectRoot: string, content: string) => {
    return appendThought(managerDataRoot, projectRoot, content)
  })

  handleIpc('project:add-dialogue', async (_event, projectRoot: string, payload: Parameters<typeof appendDialogue>[2]) => {
    return appendDialogue(managerDataRoot, projectRoot, payload)
  })

  handleIpc('project:delete-dialogue', async (_event, projectRoot: string, dialogueId: string) => {
    return deleteDialogue(managerDataRoot, projectRoot, dialogueId)
  })

  handleIpc('project:add-constraint', async (_event, projectRoot: string, payload: Parameters<typeof appendConstraint>[2]) => {
    return appendConstraint(managerDataRoot, projectRoot, payload)
  })

  handleIpc('project:delete-constraint', async (_event, projectRoot: string, constraintId: string) => {
    return deleteConstraint(managerDataRoot, projectRoot, constraintId)
  })

  handleIpc('project:delete-document', async (_event, projectRoot: string, documentTarget: string) => {
    return deleteDocument(managerDataRoot, projectRoot, documentTarget)
  })

  handleIpc('project:delete-knowledge', async (_event, projectRoot: string, knowledgeTarget: string) => {
    return deleteKnowledge(managerDataRoot, projectRoot, knowledgeTarget)
  })

  handleIpc('project:delete-thought', async (_event, projectRoot: string, thoughtId: string) => {
    return deleteThought(managerDataRoot, projectRoot, thoughtId)
  })

  handleIpc('project:reply-open-question', async (_event, projectRoot: string, payload: Parameters<typeof replyOpenQuestion>[2]) => {
    return replyOpenQuestion(managerDataRoot, projectRoot, payload)
  })

}

function handleIpc<TArgs extends unknown[], TResult>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>,
) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await listener(event, ...(args as TArgs))
    } catch (error) {
      const projectRoot = projectRootFromIpcArgs(args)
      await appendAppDiagnostic?.({
        level: 'error', category: 'ipc', event: `${channel}.failed`, error,
        ...(projectRoot ? { projectRoot } : {}),
        context: { argumentCount: args.length },
      })
      throw error
    }
  })
}

function projectRootFromIpcArgs(args: unknown[]) {
  const first = args[0]
  if (typeof first === 'string' && path.isAbsolute(first)) return first
  if (first && typeof first === 'object' && 'projectRoot' in first && typeof first.projectRoot === 'string') return first.projectRoot
  return ''
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
  await refreshAgentBrief(managerDataRoot, projectRoot)
  const dashboard = await getDashboard(managerDataRoot, projectRoot)
  await ensureCodeMap?.(projectRoot)
  startProjectWatcher(projectRoot, [dashboard.config.dataRoot, dashboard.agentBrief.knowledgeRoot])

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
          changedPath.endsWith('agent-brief.json')
          || changedPath.endsWith('index.json')
          || changedPath.endsWith('collaboration/当前项目基线.md')
        ) return
        if (watcherTimer) clearTimeout(watcherTimer)
        watcherTimer = setTimeout(async () => {
          try {
            await refreshAgentBrief(managerDataRoot, projectRoot)
            mainWindow?.webContents.send('project:data-changed', { projectRoot })
          } catch (error) {
            console.warn('failed to refresh project brief after Markdown change', error)
            void appendAppDiagnostic?.({
              level: 'error', category: 'watcher', event: 'project-brief.refresh.failed', projectRoot, error,
              context: { changedPath },
            })
          }
        }, 250)
      }))
    } catch (error) {
      console.warn('failed to watch data root', watchRoot, error)
      void appendAppDiagnostic?.({
        level: 'warning', category: 'watcher', event: 'project-data.watch.failed', projectRoot, error,
        context: { watchRoot },
      })
    }
  }
  try {
    codeMapWatcher = watch(projectRoot, { recursive: true }, (_eventType, filename) => {
      const changedPath = String(filename || '').replaceAll('\\', '/')
      if (!changedPath || changedPath.split('/').some((segment) => ['.git', '.cache', '.next', 'build', 'coverage', 'dist', 'node_modules', 'out', 'release'].includes(segment))) return
      if (codeMapTimer) clearTimeout(codeMapTimer)
      codeMapTimer = setTimeout(async () => {
        try {
          await reconcileCodeMap?.(projectRoot)
          mainWindow?.webContents.send('agent:project-maps:changed', { projectRoot })
        } catch (error) {
          console.warn('failed to reconcile code map after project change', error)
          void appendAppDiagnostic?.({
            level: 'error', category: 'code_map', event: 'code-map.watcher-reconcile.failed', projectRoot, error,
            context: { changedPath },
          })
        }
      }, 450)
    })
  } catch (error) {
    console.warn('failed to watch project source for code map changes', projectRoot, error)
    void appendAppDiagnostic?.({ level: 'warning', category: 'watcher', event: 'code-map.watch.failed', projectRoot, error })
  }
}

function stopProjectWatcher() {
  if (watcherTimer) {
    clearTimeout(watcherTimer)
    watcherTimer = null
  }
  if (codeMapTimer) {
    clearTimeout(codeMapTimer)
    codeMapTimer = null
  }
  codeMapWatcher?.close()
  codeMapWatcher = null
  for (const watcher of projectWatchers) watcher.close()
  projectWatchers = []
  watchedProjectRoot = ''
}
