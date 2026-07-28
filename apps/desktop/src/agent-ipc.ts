import { ipcMain } from 'electron'

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

import { AGENT_IPC } from './agent-ipc-contract.js'
import { AgentChatService } from './agent-chat-service.js'
import { AgentChatStore } from './agent-chat-store.js'
import { withProjectMemoryStatus } from './agent-memory-view.js'
import { ElectronSafeStorageCipher } from './safe-storage-cipher.js'
import { ModelDiagnosticLog, modelDiagnosticProjectKey } from './model-diagnostics.js'

export function registerAgentIpc(
  managerDataRoot: string,
  publishRunChange?: (notification: DesktopRunNotification) => void,
) {
  const credentials = new EncryptedCredentialVault(
    credentialVaultPath(managerDataRoot),
    new ElectronSafeStorageCipher(),
  )
  const store = new DesktopAgentSettingsStore(desktopAgentSettingsPath(managerDataRoot))
  const diagnostics = new ModelDiagnosticLog(managerDataRoot)
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
  const backend = createHeadlessDesktopAgentBackend({
    storageFor: (projectRoot) => config.storageFor(projectRoot),
    runnerOptionsFor: async ({ projectRoot }) => ({
      ...await config.resolve(projectRoot),
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
  if (publishRunChange) coordinator.subscribe(publishRunChange)

  const settingsViewForProject = async (projectRoot: string) => {
    const projectId = (await getDashboard(managerDataRoot, projectRoot)).config.projectId
    return withProjectMemoryStatus(
      await service.getView(projectId),
      await config.getProjectMemoryStatus(projectRoot),
    )
  }

  ipcMain.handle(AGENT_IPC.getSettings.channel, async (_event, projectRoot?: string) => {
    return projectRoot ? settingsViewForProject(projectRoot) : service.getView()
  })
  ipcMain.handle(AGENT_IPC.getModelDiagnostics.channel, async (_event, projectRoot?: string) => {
    if (!String(projectRoot || '').trim()) return []
    return diagnostics.recent(80, modelDiagnosticProjectKey(projectRoot!))
  })
  ipcMain.handle(AGENT_IPC.listChats.channel, async (_event, projectRoot: string) => chat.list(projectRoot))
  ipcMain.handle(AGENT_IPC.sendChat.channel, async (_event, input) => chat.send(input))
  ipcMain.handle(AGENT_IPC.updateOpenAIModel.channel, async (_event, input: DesktopOpenAIModelSettingsPatch) => {
    return service.updateOpenAIModel(input)
  })
  ipcMain.handle(AGENT_IPC.updateProjectModelRoute.channel, async (_event, input: Omit<DesktopProjectModelRoutePatch, 'projectId'> & { projectRoot: string }) => {
    const dashboard = await getDashboard(managerDataRoot, input.projectRoot)
    await service.updateProjectModelRoute({ ...input, projectId: dashboard.config.projectId })
    return settingsViewForProject(input.projectRoot)
  })
  ipcMain.handle(AGENT_IPC.listRuns.channel, async (_event, projectRoot: string) => {
    return coordinator.listRuns(projectRoot)
  })
  ipcMain.handle(AGENT_IPC.getRun.channel, async (_event, projectRoot: string, runId: string) => {
    return coordinator.getRun(projectRoot, runId)
  })
  ipcMain.handle(AGENT_IPC.startTask.channel, async (_event, input) => {
    return coordinator.startTask({
      ...input,
      verificationPlan: input.verificationPlan
        || (input.intent === 'analysis' ? { checks: [] } : await inferDesktopVerificationPlan(input.projectRoot)),
    })
  })
  ipcMain.handle(AGENT_IPC.advanceRun.channel, async (_event, input) => {
    return coordinator.advanceRun(input)
  })
  ipcMain.handle(AGENT_IPC.resolveApproval.channel, async (_event, input) => {
    return coordinator.resolveApproval(input)
  })
  ipcMain.handle(AGENT_IPC.cancelRun.channel, async (_event, projectRoot: string, runId: string) => {
    return coordinator.cancelActiveRun(runId, projectRoot)
  })
  ipcMain.handle(AGENT_IPC.readOutput.channel, async (_event, projectRoot: string, ref: string) => {
    return coordinator.readOutput(projectRoot, ref)
  })

  return { service, credentials, diagnostics, config, coordinator, chat }
}
