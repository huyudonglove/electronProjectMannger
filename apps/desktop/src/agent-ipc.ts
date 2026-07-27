import { ipcMain } from 'electron'

import {
  EncryptedCredentialVault,
  credentialVaultPath,
} from '@electron-manager/agent-credential-vault'
import {
  DesktopAgentSettingsService,
  DesktopAgentSettingsStore,
  desktopAgentSettingsPath,
  type DesktopModelCredentialDeleteInput,
  type DesktopModelCredentialInput,
  type DesktopOpenAIModelSettingsPatch,
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

import { AGENT_IPC } from './agent-ipc-contract.js'
import { ElectronSafeStorageCipher } from './safe-storage-cipher.js'

export function registerAgentIpc(
  managerDataRoot: string,
  publishRunChange?: (notification: DesktopRunNotification) => void,
) {
  const credentials = new EncryptedCredentialVault(
    credentialVaultPath(managerDataRoot),
    new ElectronSafeStorageCipher(),
  )
  const store = new DesktopAgentSettingsStore(desktopAgentSettingsPath(managerDataRoot))
  const service = new DesktopAgentSettingsService({
    store,
    credentials,
  })
  const config = new DesktopAgentConfigService({
    managerDataRoot,
    store,
    providers: new DesktopModelProviderFactory({ credentials }),
  })
  const permissionPolicy = new DesktopAgentPermissionPolicy()
  const backend = createHeadlessDesktopAgentBackend({
    storageFor: (projectRoot) => config.storageFor(projectRoot),
    runnerOptionsFor: async ({ projectRoot }) => ({
      ...await config.resolve(projectRoot),
      permissionPolicy,
      runtimeOptions: { timeoutMs: 180_000 },
    }),
  })
  const coordinator = new DesktopAgentCoordinator({ managerDataRoot, backend })
  if (publishRunChange) coordinator.subscribe(publishRunChange)

  ipcMain.handle(AGENT_IPC.getSettings.channel, async () => service.getView())
  ipcMain.handle(AGENT_IPC.updateOpenAIModel.channel, async (_event, input: DesktopOpenAIModelSettingsPatch) => {
    return service.updateOpenAIModel(input)
  })
  ipcMain.handle(AGENT_IPC.setModelCredential.channel, async (_event, input: DesktopModelCredentialInput) => {
    return service.setModelCredential(input)
  })
  ipcMain.handle(AGENT_IPC.deleteModelCredential.channel, async (_event, input: DesktopModelCredentialDeleteInput) => {
    return service.deleteModelCredential(input)
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
      verificationPlan: input.verificationPlan || await inferDesktopVerificationPlan(input.projectRoot),
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

  return { service, credentials, config, coordinator }
}
