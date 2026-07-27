import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  CredentialCipher,
  CredentialSummary,
  CredentialVault,
  CredentialVaultSnapshot,
} from './types.js'

const SCHEMA_VERSION = 1
const MAX_CREDENTIAL_BYTES = 64 * 1024

interface StoredCredential {
  ciphertext: string
  updatedAt: string
}

interface StoredCredentialVault {
  schemaVersion: typeof SCHEMA_VERSION
  cipher: string
  revision: string
  credentials: Record<string, StoredCredential>
}

export class EncryptedCredentialVault implements CredentialVault {
  readonly filePath: string
  readonly #cipher: CredentialCipher
  readonly #clock: () => string
  #queue: Promise<void> = Promise.resolve()

  constructor(filePath: string, cipher: CredentialCipher, options: { clock?: () => string } = {}) {
    if (!String(filePath || '').trim()) throw new Error('Credential vault path is required')
    if (!String(cipher?.id || '').trim()) throw new Error('Credential cipher id is required')
    this.filePath = path.resolve(filePath)
    this.#cipher = cipher
    this.#clock = options.clock || (() => new Date().toISOString())
  }

  async resolveCredential(ref: string): Promise<string | null> {
    validateCredentialRef(ref)
    const stored = await this.#load()
    const credential = stored.credentials[ref]
    if (!credential) return null
    this.#requireCipher(stored)
    return await this.#cipher.decrypt(Buffer.from(credential.ciphertext, 'base64'))
  }

  async inspect(refs?: string[]): Promise<CredentialVaultSnapshot> {
    const stored = await this.#load()
    const selectedRefs = refs ? [...new Set(refs)] : Object.keys(stored.credentials)
    for (const ref of selectedRefs) validateCredentialRef(ref)
    return snapshotOf(stored, selectedRefs)
  }

  async setCredential(ref: string, value: string, expectedRevision?: string): Promise<CredentialVaultSnapshot> {
    validateCredentialRef(ref)
    if (!String(value || '').trim()) throw new Error(`Credential value is empty: ${ref}`)
    if (Buffer.byteLength(value, 'utf8') > MAX_CREDENTIAL_BYTES) throw new Error(`Credential value is too large: ${ref}`)
    return await this.#exclusive(async () => {
      const stored = await this.#load()
      assertExpectedRevision(stored.revision, expectedRevision)
      this.#requireCipher(stored)
      const encrypted = await this.#cipher.encrypt(value)
      stored.credentials[ref] = {
        ciphertext: Buffer.from(encrypted).toString('base64'),
        updatedAt: this.#clock(),
      }
      await this.#write(stored)
      return snapshotOf(stored, Object.keys(stored.credentials))
    })
  }

  async deleteCredential(ref: string, expectedRevision?: string): Promise<CredentialVaultSnapshot> {
    validateCredentialRef(ref)
    return await this.#exclusive(async () => {
      const stored = await this.#load()
      assertExpectedRevision(stored.revision, expectedRevision)
      if (stored.credentials[ref]) {
        delete stored.credentials[ref]
        await this.#write(stored)
      }
      return snapshotOf(stored, Object.keys(stored.credentials))
    })
  }

  async #load(): Promise<StoredCredentialVault> {
    let raw: string
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (isNotFound(error)) return emptyVault(this.#cipher.id)
      throw error
    }
    let parsed: StoredCredentialVault
    try {
      parsed = JSON.parse(raw) as StoredCredentialVault
    } catch (error) {
      throw new Error(`Credential vault is not valid JSON: ${this.filePath}`, { cause: error })
    }
    validateStoredVault(parsed)
    return parsed
  }

  async #write(stored: StoredCredentialVault) {
    stored.revision = revisionOf(stored.credentials, stored.cipher)
    await atomicWrite(this.filePath, `${JSON.stringify(stored, null, 2)}\n`)
  }

  #requireCipher(stored: StoredCredentialVault) {
    if (stored.cipher !== this.#cipher.id) {
      throw new Error(`Credential vault cipher mismatch: expected ${this.#cipher.id}, actual ${stored.cipher}`)
    }
    if (!this.#cipher.isAvailable()) throw new Error(`Credential encryption is unavailable: ${this.#cipher.id}`)
  }

  async #exclusive<T>(operation: () => Promise<T>) {
    const previous = this.#queue
    let release!: () => void
    this.#queue = new Promise<void>((resolve) => { release = resolve })
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

export function credentialVaultPath(managerDataRoot: string) {
  if (!String(managerDataRoot || '').trim()) throw new Error('Manager data root is required')
  return path.join(path.resolve(managerDataRoot), 'agent', 'credentials.json')
}

export function validateCredentialRef(ref: string) {
  if (!/^credential\.[A-Za-z0-9._-]+$/.test(String(ref || ''))) {
    throw new Error(`Credential reference is invalid: ${ref || 'empty'}`)
  }
}

function emptyVault(cipher: string): StoredCredentialVault {
  const credentials = {}
  return {
    schemaVersion: SCHEMA_VERSION,
    cipher,
    revision: revisionOf(credentials, cipher),
    credentials,
  }
}

function validateStoredVault(stored: StoredCredentialVault) {
  if (!stored || stored.schemaVersion !== SCHEMA_VERSION || !stored.cipher || !stored.credentials) {
    throw new Error(`Unsupported credential vault schema: ${stored?.schemaVersion}`)
  }
  for (const [ref, credential] of Object.entries(stored.credentials)) {
    validateCredentialRef(ref)
    if (!credential?.ciphertext || !credential.updatedAt) throw new Error(`Stored credential is invalid: ${ref}`)
  }
  if (stored.revision !== revisionOf(stored.credentials, stored.cipher)) {
    throw new Error('Credential vault revision does not match its content')
  }
}

function snapshotOf(stored: StoredCredentialVault, refs: string[]): CredentialVaultSnapshot {
  const credentials: CredentialSummary[] = refs.sort().map((ref) => ({
    ref,
    configured: Boolean(stored.credentials[ref]),
    ...(stored.credentials[ref]?.updatedAt ? { updatedAt: stored.credentials[ref].updatedAt } : {}),
  }))
  return { revision: stored.revision, credentials }
}

function assertExpectedRevision(actual: string, expected?: string) {
  if (expected !== undefined && actual !== expected) {
    throw new Error(`Credential vault revision conflict: expected ${expected}, actual ${actual}`)
  }
}

function revisionOf(credentials: Record<string, StoredCredential>, cipher: string) {
  return createHash('sha256').update(canonicalJson({ cipher, credentials })).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

async function atomicWrite(target: string, content: string) {
  await mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
