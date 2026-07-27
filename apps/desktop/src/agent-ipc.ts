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

import { AGENT_IPC } from './agent-ipc-contract.js'
import { ElectronSafeStorageCipher } from './safe-storage-cipher.js'

export function registerAgentIpc(managerDataRoot: string) {
  const credentials = new EncryptedCredentialVault(
    credentialVaultPath(managerDataRoot),
    new ElectronSafeStorageCipher(),
  )
  const service = new DesktopAgentSettingsService({
    store: new DesktopAgentSettingsStore(desktopAgentSettingsPath(managerDataRoot)),
    credentials,
  })

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

  return { service, credentials }
}
