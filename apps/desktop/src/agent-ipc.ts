import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'

import {
  EncryptedCredentialVault,
  credentialVaultPath,
} from '@electron-manager/agent-credential-vault'
import {
  DesktopAgentSettingsService,
  DesktopAgentSettingsStore,
  desktopAgentSettingsPath,
  type DesktopOpenAIModelSettingsPatch,
  type DesktopProjectModelRoutePatch,
} from '@electron-manager/agent-desktop-config/settings'
import {
  DesktopAgentConfigService,
  DesktopAgentPermissionPolicy,
  DesktopModelProviderFactory,
  inferDesktopVerificationPlan,
} from '@electron-manager/agent-desktop-config'
import {
  DesktopAgentCoordinator,
  createHeadlessDesktopAgentBackend,
  type DesktopRunNotification,
} from '@electron-manager/agent-desktop-coordinator'
import { getDashboard } from '@electron-manager/project-core'
import { CodeMapService } from '@electron-manager/agent-repo-map'

import { AGENT_IPC } from './agent-ipc-contract.js'
import { AgentChatService } from './agent-chat-service.js'
import { AgentChatStore } from './agent-chat-store.js'
import { withProjectMemoryStatus } from './agent-memory-view.js'
import { ElectronSafeStorageCipher } from './safe-storage-cipher.js'
import { ModelDiagnosticLog, modelDiagnosticProjectKey } from './model-diagnostics.js'
import { projectMapsView } from './project-maps.js'
import { AppDiagnosticLog } from './app-diagnostics.js'
import { buildDiagnosticReport } from './diagnostic-report.js'

export function registerAgentIpc(
  managerDataRoot: string,
  publishRunChange?: (notification: DesktopRunNotification) => void,
  publishMapsChange?: (projectRoot: string) => void,
) {
  const credentials = new EncryptedCredentialVault(
    credentialVaultPath(managerDataRoot),
    new ElectronSafeStorageCipher(),
  )
  const store = new DesktopAgentSettingsStore(desktopAgentSettingsPath(managerDataRoot))
  const diagnostics = new ModelDiagnosticLog(managerDataRoot)
  const appDiagnostics = new AppDiagnosticLog(managerDataRoot)
  const service = new DesktopAgentSettingsService({
    store,
  })
  const config = new DesktopAgentConfigService({
    managerDataRoot,
    store,
    providers: new DesktopModelProviderFactory({
      credentials,
      onModelDiagnostic: (entry) => diagnostics.append(entry),
    }),
  })
  const chat = new AgentChatService({
    store: new AgentChatStore(managerDataRoot),
    config,
    diagnostics,
    managerDataRoot,
  })
  const permissionPolicy = new DesktopAgentPermissionPolicy()
  const codeMaps = new CodeMapService(managerDataRoot)
  const backend = createHeadlessDesktopAgentBackend({
    storageFor: (projectRoot) => config.storageFor(projectRoot),
    runnerOptionsFor: async ({ projectRoot }) => ({
      ...await config.resolve(projectRoot),
      codeMapSnapshot: await codeMaps.ensure(projectRoot),
      permissionPolicy,
      runtimeOptions: { timeoutMs: 180_000 },
      onModelAttempt: (entry) => diagnostics.append({
        at: entry.attempt.completedAt,
        level: entry.attempt.outcome === 'succeeded' ? 'info' : 'error',
        event: `route.attempt.${entry.attempt.outcome}`,
        providerId: entry.attempt.provider,
        model: entry.attempt.model,
        runId: entry.runId,
        turnId: entry.turnId,
        projectKey: modelDiagnosticProjectKey(projectRoot),
        routeId: entry.attempt.routeId,
        profileId: entry.attempt.profileId,
        attempt: entry.attempt.attempt,
        order: entry.order,
        result: entry.attempt.outcome,
        ...(entry.attempt.error ? {
          errorCategory: entry.attempt.error.category,
          error: entry.attempt.error.message,
        } : {}),
      }),
    }),
  })
  const coordinator = new DesktopAgentCoordinator({ managerDataRoot, backend })
  coordinator.subscribe(async (notification) => {
    publishRunChange?.(notification)
    if (notification.events.some((event) => event.type === 'files.changed')) {
      try {
        await codeMaps.reconcile(notification.projectRoot)
        publishMapsChange?.(notification.projectRoot)
      } catch (error) {
        await appDiagnostics.append({
          level: 'error', category: 'code_map', event: 'code-map.reconcile.failed',
          projectRoot: notification.projectRoot, runId: notification.run.runId, error,
        })
      }
    }
  })

  const handle = (
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>,
  ) => ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await listener(event, ...args)
    } catch (error) {
      const projectRoot = projectRootFrom(args)
      await appDiagnostics.append({
        level: 'error', category: 'ipc', event: `${channel}.failed`, error,
        ...(projectRoot ? { projectRoot } : {}),
        context: { argumentCount: args.length },
      })
      throw error
    }
  })

  const settingsViewForProject = async (projectRoot: string) => {
    const projectId = (await getDashboard(managerDataRoot, projectRoot)).config.projectId
    return withProjectMemoryStatus(
      await service.getView(projectId),
      await config.getProjectMemoryStatus(projectRoot),
    )
  }

  handle(AGENT_IPC.getSettings.channel, async (_event, projectRoot?: unknown) => {
    const root = typeof projectRoot === 'string' ? projectRoot : ''
    return root ? settingsViewForProject(root) : service.getView()
  })
  handle(AGENT_IPC.getModelDiagnostics.channel, async (_event, projectRoot?: unknown) => {
    if (!String(projectRoot || '').trim()) return []
    return diagnostics.recent(80, modelDiagnosticProjectKey(String(projectRoot)))
  })
  handle(AGENT_IPC.getProjectMaps.channel, async (_event, projectRootValue: unknown) => {
    const projectRoot = requiredString(projectRootValue, 'projectRoot')
    const [codeMap, dashboard, chats, runs] = await Promise.all([
      codeMaps.ensure(projectRoot),
      getDashboard(managerDataRoot, projectRoot),
      chat.list(projectRoot),
      coordinator.listRuns(projectRoot),
    ])
    return projectMapsView(codeMap, dashboard, chats, runs)
  })
  handle(AGENT_IPC.getDiagnosticReport.channel, async (_event, inputValue: unknown) => {
    const input = inputValue as { projectRoot?: unknown; runId?: unknown }
    const projectRoot = requiredString(input?.projectRoot, 'projectRoot')
    const runs = await coordinator.listRuns(projectRoot)
    const runId = typeof input.runId === 'string' && input.runId.trim() ? input.runId : runs[0]?.runId
    const [codeMap, selectedRun, applicationEntries, modelEntries] = await Promise.all([
      codeMaps.ensure(projectRoot),
      runId ? coordinator.getRun(projectRoot, runId) : Promise.resolve(null),
      appDiagnostics.recent(100, projectRoot),
      diagnostics.recent(100, modelDiagnosticProjectKey(projectRoot)),
    ])
    return buildDiagnosticReport({
      projectKey: modelDiagnosticProjectKey(projectRoot), codeMap, runs, selectedRun,
      appDiagnostics: applicationEntries, modelDiagnostics: modelEntries, appVersion: app.getVersion(),
    })
  })
  handle(AGENT_IPC.listChats.channel, async (_event, projectRootValue: unknown) => chat.list(requiredString(projectRootValue, 'projectRoot')))
  handle(AGENT_IPC.sendChat.channel, async (_event, input: unknown) => chat.send(input as Parameters<typeof chat.send>[0]))
  handle(AGENT_IPC.updateOpenAIModel.channel, async (_event, input: unknown) => {
    return service.updateOpenAIModel(input as DesktopOpenAIModelSettingsPatch)
  })
  handle(AGENT_IPC.updateProjectModelRoute.channel, async (_event, inputValue: unknown) => {
    const input = inputValue as Omit<DesktopProjectModelRoutePatch, 'projectId'> & { projectRoot: string }
    const dashboard = await getDashboard(managerDataRoot, input.projectRoot)
    await service.updateProjectModelRoute({ ...input, projectId: dashboard.config.projectId })
    return settingsViewForProject(input.projectRoot)
  })
  handle(AGENT_IPC.listRuns.channel, async (_event, projectRootValue: unknown) => {
    return coordinator.listRuns(requiredString(projectRootValue, 'projectRoot'))
  })
  handle(AGENT_IPC.getRun.channel, async (_event, projectRootValue: unknown, runIdValue: unknown) => {
    return coordinator.getRun(requiredString(projectRootValue, 'projectRoot'), requiredString(runIdValue, 'runId'))
  })
  handle(AGENT_IPC.startTask.channel, async (_event, inputValue: unknown) => {
    const input = inputValue as Parameters<typeof coordinator.startTask>[0]
    return coordinator.startTask({
      ...input,
      verificationPlan: input.verificationPlan
        || (input.intent === 'analysis' ? { checks: [] } : await inferDesktopVerificationPlan(input.projectRoot)),
    })
  })
  handle(AGENT_IPC.advanceRun.channel, async (_event, input: unknown) => {
    return coordinator.advanceRun(input as Parameters<typeof coordinator.advanceRun>[0])
  })
  handle(AGENT_IPC.resolveApproval.channel, async (_event, input: unknown) => {
    return coordinator.resolveApproval(input as Parameters<typeof coordinator.resolveApproval>[0])
  })
  handle(AGENT_IPC.cancelRun.channel, async (_event, projectRootValue: unknown, runIdValue: unknown) => {
    return coordinator.cancelActiveRun(requiredString(runIdValue, 'runId'), requiredString(projectRootValue, 'projectRoot'))
  })
  handle(AGENT_IPC.readOutput.channel, async (_event, projectRootValue: unknown, refValue: unknown) => {
    return coordinator.readOutput(requiredString(projectRootValue, 'projectRoot'), requiredString(refValue, 'ref'))
  })

  return { service, credentials, diagnostics, appDiagnostics, config, coordinator, chat, codeMaps }
}

function projectRootFrom(args: unknown[]) {
  const first = args[0]
  if (typeof first === 'string' && first.trim()) return first
  if (first && typeof first === 'object' && 'projectRoot' in first && typeof first.projectRoot === 'string') return first.projectRoot
  return ''
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  return value
}
