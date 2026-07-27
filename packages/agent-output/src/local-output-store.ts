import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { AgentCoreError } from '@electron-manager/agent-core'

import {
  OUTPUT_ARTIFACT_SCHEMA_VERSION,
  type OutputArtifact,
  type OutputStore,
  type PutOutputOptions,
  type StoredOutput,
} from './protocol.js'

const OUTPUT_REF_PREFIX = 'output:sha256:'
const SHA256_PATTERN = /^[a-f0-9]{64}$/
export const DEFAULT_MAX_OUTPUT_ARTIFACT_BYTES = 10 * 1024 * 1024

interface StoredOutputEnvelope {
  schemaVersion: typeof OUTPUT_ARTIFACT_SCHEMA_VERSION
  artifact: OutputArtifact
  content: string
}

export interface LocalOutputStoreOptions {
  maxArtifactBytes?: number
  clock?: () => string
}

export class LocalContentAddressedOutputStore implements OutputStore {
  readonly rootDirectory: string
  readonly maxArtifactBytes: number
  readonly #clock: () => string

  constructor(rootDirectory: string, options: LocalOutputStoreOptions = {}) {
    if (!rootDirectory.trim()) throw new AgentCoreError('INVALID_INPUT', 'Output store directory is required')
    this.rootDirectory = path.resolve(rootDirectory)
    this.maxArtifactBytes = positiveInteger(options.maxArtifactBytes ?? DEFAULT_MAX_OUTPUT_ARTIFACT_BYTES, 'maxArtifactBytes')
    this.#clock = options.clock || (() => new Date().toISOString())
  }

  async put(content: string, options: PutOutputOptions = {}): Promise<OutputArtifact> {
    const bytes = Buffer.byteLength(content, 'utf8')
    if (bytes > this.maxArtifactBytes) {
      throw new AgentCoreError('LIMIT_EXCEEDED', `Output artifact exceeds ${this.maxArtifactBytes} bytes`, {
        details: { bytes, maxArtifactBytes: this.maxArtifactBytes },
      })
    }
    const sha256 = digest(content)
    const ref = `${OUTPUT_REF_PREFIX}${sha256}`
    const artifact: OutputArtifact = {
      schemaVersion: OUTPUT_ARTIFACT_SCHEMA_VERSION,
      ref,
      sha256,
      mediaType: 'text/plain; charset=utf-8',
      bytes,
      characters: content.length,
      createdAt: options.createdAt || this.#clock(),
    }
    const target = this.#objectPath(sha256)
    await mkdir(path.dirname(target), { recursive: true })
    const envelope: StoredOutputEnvelope = {
      schemaVersion: OUTPUT_ARTIFACT_SCHEMA_VERSION,
      artifact,
      content,
    }
    await createFileAtomically(target, `${JSON.stringify(envelope)}\n`)
    return (await this.read(ref)).artifact
  }

  async read(ref: string): Promise<StoredOutput> {
    const sha256 = parseOutputRef(ref)
    const target = this.#objectPath(sha256)
    let raw: string
    try {
      raw = await readFile(target, 'utf8')
    } catch (error) {
      throw new AgentCoreError('CHECKPOINT_ERROR', `Output artifact could not be read: ${ref}`, {
        cause: error,
        details: { ref },
      })
    }
    let envelope: StoredOutputEnvelope
    try {
      envelope = JSON.parse(raw) as StoredOutputEnvelope
    } catch (error) {
      throw corrupted(ref, 'stored envelope is not valid JSON', error)
    }
    validateEnvelope(envelope, ref, sha256)
    return structuredClone({ artifact: envelope.artifact, content: envelope.content })
  }

  #objectPath(sha256: string) {
    return path.join(this.rootDirectory, 'objects', sha256.slice(0, 2), `${sha256}.json`)
  }
}

function digest(content: string) {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function parseOutputRef(ref: string) {
  if (!ref.startsWith(OUTPUT_REF_PREFIX)) throw new AgentCoreError('INVALID_INPUT', `Unsupported output reference: ${ref}`)
  const sha256 = ref.slice(OUTPUT_REF_PREFIX.length)
  if (!SHA256_PATTERN.test(sha256)) throw new AgentCoreError('INVALID_INPUT', `Invalid output reference: ${ref}`)
  return sha256
}

function validateEnvelope(envelope: StoredOutputEnvelope, ref: string, expectedSha256: string) {
  if (!envelope || envelope.schemaVersion !== OUTPUT_ARTIFACT_SCHEMA_VERSION || typeof envelope.content !== 'string') {
    throw corrupted(ref, 'stored envelope has an unsupported schema')
  }
  const artifact = envelope.artifact
  const actualSha256 = digest(envelope.content)
  const actualBytes = Buffer.byteLength(envelope.content, 'utf8')
  if (
    !artifact
    || artifact.schemaVersion !== OUTPUT_ARTIFACT_SCHEMA_VERSION
    || artifact.ref !== ref
    || artifact.sha256 !== expectedSha256
    || actualSha256 !== expectedSha256
    || artifact.bytes !== actualBytes
    || artifact.characters !== envelope.content.length
    || artifact.mediaType !== 'text/plain; charset=utf-8'
    || typeof artifact.createdAt !== 'string'
    || !artifact.createdAt
  ) {
    throw corrupted(ref, 'stored content or metadata does not match its reference')
  }
}

async function createFileAtomically(target: string, content: string) {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
  let wroteTemporary = false
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
    wroteTemporary = true
    try {
      await link(temporary, target)
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
    }
  } finally {
    if (wroteTemporary) await unlink(temporary).catch(() => undefined)
  }
}

function positiveInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new AgentCoreError('INVALID_INPUT', `${name} must be a positive integer`)
  return value
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

function corrupted(ref: string, reason: string, cause?: unknown) {
  return new AgentCoreError('CHECKPOINT_ERROR', `Output artifact is corrupted: ${ref}`, {
    ...(cause ? { cause } : {}),
    details: { ref, reason },
  })
}
