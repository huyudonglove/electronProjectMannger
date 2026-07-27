export interface CredentialCipher {
  readonly id: string
  isAvailable(): boolean
  encrypt(value: string): Uint8Array | Promise<Uint8Array>
  decrypt(value: Uint8Array): string | Promise<string>
}

export interface CredentialSummary {
  ref: string
  configured: boolean
  updatedAt?: string
}

export interface CredentialVaultSnapshot {
  revision: string
  credentials: CredentialSummary[]
}

export interface CredentialVault {
  resolveCredential(ref: string): Promise<string | null>
  inspect(refs?: string[]): Promise<CredentialVaultSnapshot>
  setCredential(ref: string, value: string, expectedRevision?: string): Promise<CredentialVaultSnapshot>
  deleteCredential(ref: string, expectedRevision?: string): Promise<CredentialVaultSnapshot>
}
