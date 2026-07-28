import { AgentCoreError } from '@electron-manager/agent-core'
import { ProjectMemoryIndex, type ProjectMemoryDocument } from '@electron-manager/agent-memory'

export const PROJECT_MEMORY_SNAPSHOT_SCHEMA_VERSION = 1 as const
export const MAX_PROJECT_MEMORY_SNAPSHOT_BYTES = 2 * 1024 * 1024

export function encodeProjectMemorySnapshot(documents: ProjectMemoryDocument[]) {
  const index = new ProjectMemoryIndex(documents)
  const content = canonicalJson({
    schemaVersion: PROJECT_MEMORY_SNAPSHOT_SCHEMA_VERSION,
    revision: index.revision,
    documents,
  })
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > MAX_PROJECT_MEMORY_SNAPSHOT_BYTES) {
    throw new AgentCoreError('LIMIT_EXCEEDED', 'Project memory snapshot exceeds its byte limit', {
      details: { bytes, maxBytes: MAX_PROJECT_MEMORY_SNAPSHOT_BYTES },
    })
  }
  return { content, revision: index.revision, bytes }
}

export function decodeProjectMemorySnapshot(content: string, expectedRevision: string): ProjectMemoryDocument[] {
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes > MAX_PROJECT_MEMORY_SNAPSHOT_BYTES) {
    throw new AgentCoreError('CHECKPOINT_ERROR', 'Stored Project Memory snapshot exceeds its byte limit')
  }
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch (error) {
    throw new AgentCoreError('CHECKPOINT_ERROR', 'Stored Project Memory snapshot is not valid JSON', { cause: error })
  }
  const record = objectValue(value)
  if (record?.schemaVersion !== PROJECT_MEMORY_SNAPSHOT_SCHEMA_VERSION
    || typeof record.revision !== 'string'
    || !Array.isArray(record.documents)) {
    throw new AgentCoreError('CHECKPOINT_ERROR', 'Stored Project Memory snapshot has an invalid schema')
  }
  if (!expectedRevision.trim() || record.revision !== expectedRevision) {
    throw new AgentCoreError('CHECKPOINT_ERROR', 'Stored Project Memory snapshot revision does not match the checkpoint')
  }
  const documents = record.documents.map(validateStoredDocument)
  let actualRevision: string
  try {
    actualRevision = new ProjectMemoryIndex(documents).revision
  } catch (error) {
    throw new AgentCoreError('CHECKPOINT_ERROR', 'Stored Project Memory documents are invalid', { cause: error })
  }
  if (actualRevision !== expectedRevision) {
    throw new AgentCoreError('CHECKPOINT_ERROR', 'Stored Project Memory document content does not match its revision')
  }
  return structuredClone(documents)
}

function validateStoredDocument(value: unknown): ProjectMemoryDocument {
  const document = objectValue(value)
  const path = typeof document?.path === 'string' ? document.path : ''
  if (!document
    || typeof document.id !== 'string'
    || typeof document.content !== 'string'
    || !Array.isArray(document.tags)
    || document.tags.some((tag) => typeof tag !== 'string')
    || document.scope !== 'project'
    || !['trusted_project', 'untrusted'].includes(String(document.trust))
    || !safeRelativePath(path)
    || (document.sourceRefs !== undefined && (!Array.isArray(document.sourceRefs) || document.sourceRefs.some((ref) => typeof ref !== 'string')))
    || ['title', 'summary', 'updatedAt'].some((key) => document[key] !== undefined && typeof document[key] !== 'string')) {
    throw new AgentCoreError('CHECKPOINT_ERROR', 'Stored Project Memory document has an invalid schema or path')
  }
  return structuredClone(document) as unknown as ProjectMemoryDocument
}

function safeRelativePath(value: string) {
  return Boolean(value.trim())
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.includes('\0')
    && !/^[A-Za-z]:\//.test(value)
    && !value.split('/').some((segment) => segment === '..' || segment === '.' || !segment)
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
