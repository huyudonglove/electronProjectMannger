import { safeStorage } from 'electron'

import type { CredentialCipher } from '@electron-manager/agent-credential-vault'

export class ElectronSafeStorageCipher implements CredentialCipher {
  readonly id = 'electron.safeStorage.v1'

  isAvailable() {
    return safeStorage.isEncryptionAvailable()
  }

  encrypt(value: string) {
    return safeStorage.encryptString(value)
  }

  decrypt(value: Uint8Array) {
    return safeStorage.decryptString(Buffer.from(value))
  }
}
