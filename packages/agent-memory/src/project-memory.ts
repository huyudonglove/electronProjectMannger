import { createHash } from 'node:crypto'

import { AgentCoreError } from '@electron-manager/agent-core'

export type ProjectMemoryScope = 'project' | 'user'
export type ProjectMemoryTrust = 'trusted_project' | 'untrusted'

export interface ProjectMemoryDocument {
  id: string
  path: string
  title?: string
  summary?: string
  tags: string[]
  scope: ProjectMemoryScope
  trust: ProjectMemoryTrust
  updatedAt?: string
  content: string
  sourceRefs?: string[]
}

export interface ProjectMemoryQuery {
  text?: string
  paths?: string[]
  tags?: string[]
  scopes?: ProjectMemoryScope[]
  trust?: ProjectMemoryTrust
  limit?: number
}

export interface ProjectMemoryMatch {
  document: ProjectMemoryDocument
  score: number
  matchedBy: Array<'metadata' | 'path' | 'tag' | 'full_text'>
  matchedTerms: string[]
}

export const LEGACY_PROJECT_MEMORY_RETRIEVAL_REVISION = 'lexical-v1'
export const PROJECT_MEMORY_RETRIEVAL_REVISION = 'cjk-bigram-v1'
export type ProjectMemoryRetrievalRevision =
  | typeof LEGACY_PROJECT_MEMORY_RETRIEVAL_REVISION
  | typeof PROJECT_MEMORY_RETRIEVAL_REVISION

const MAX_QUERY_CHARACTERS = 16_000
const MAX_QUERY_TERM_CHARACTERS = 256
const MAX_QUERY_TERMS = 64

export class ProjectMemoryIndex {
  readonly revision: string
  readonly retrievalRevision: ProjectMemoryRetrievalRevision
  readonly #documents: ProjectMemoryDocument[]

  constructor(
    documents: ProjectMemoryDocument[],
    options: { retrievalRevision?: ProjectMemoryRetrievalRevision } = {},
  ) {
    this.retrievalRevision = options.retrievalRevision ?? PROJECT_MEMORY_RETRIEVAL_REVISION
    if (this.retrievalRevision !== LEGACY_PROJECT_MEMORY_RETRIEVAL_REVISION
      && this.retrievalRevision !== PROJECT_MEMORY_RETRIEVAL_REVISION) {
      throw new AgentCoreError('INVALID_INPUT', `Unsupported Project Memory retrieval revision: ${String(this.retrievalRevision)}`)
    }
    const ids = new Set<string>()
    this.#documents = documents.map((document) => {
      validateDocument(document)
      if (ids.has(document.id)) throw new AgentCoreError('INVALID_INPUT', `Duplicate project memory id: ${document.id}`)
      ids.add(document.id)
      return normalizeDocument(document)
    })
    this.revision = hash(canonicalJson(this.#documents.map(documentIdentity)))
  }

  search(query: ProjectMemoryQuery): ProjectMemoryMatch[] {
    const limit = query.limit ?? 8
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new AgentCoreError('INVALID_INPUT', 'Project memory search limit must be a positive integer')
    const terms = this.retrievalRevision === LEGACY_PROJECT_MEMORY_RETRIEVAL_REVISION
      ? tokens(query.text || '')
      : queryTerms(query.text || '')
    const requestedPaths = uniqueNormalized(query.paths ?? [], normalizePath)
    const requestedTags = uniqueNormalized(query.tags ?? [], normalizeTerm)
    const scopes = new Set(query.scopes ?? ['project'])

    return this.#documents
      .filter((document) => scopes.has(document.scope) && (!query.trust || document.trust === query.trust))
      .map((document) => scoreDocument(document, terms, requestedPaths, requestedTags))
      .filter((match) => match.score > 0)
      .sort(compareMatches)
      .slice(0, limit)
      .map((match) => structuredClone(match))
  }
}

function scoreDocument(
  document: ProjectMemoryDocument,
  terms: string[],
  requestedPaths: string[],
  requestedTags: string[],
): ProjectMemoryMatch {
  const matchedBy = new Set<ProjectMemoryMatch['matchedBy'][number]>()
  const matchedTerms = new Set<string>()
  const pathValue = normalizePath(document.path)
  const tagSet = new Set(document.tags.map(normalizeTerm))
  const metadata = tokens(`${document.title || ''} ${document.summary || ''}`)
  const content = tokens(document.content)
  let score = 0

  for (const requestedPath of requestedPaths) {
    if (pathValue === requestedPath) {
      score += 80
      matchedBy.add('path')
    } else if (pathValue.includes(requestedPath) || requestedPath.includes(pathValue)) {
      score += 35
      matchedBy.add('path')
    }
  }
  for (const requestedTag of requestedTags) {
    if (tagSet.has(requestedTag)) {
      score += 45
      matchedBy.add('tag')
    }
  }
  for (const term of terms) {
    let matched = false
    if (pathValue.includes(term)) {
      score += 12
      matchedBy.add('path')
      matched = true
    }
    if (tagSet.has(term)) {
      score += 18
      matchedBy.add('tag')
      matched = true
    }
    const metadataHits = count(metadata, term)
    if (metadataHits) {
      score += Math.min(24, metadataHits * 8)
      matchedBy.add('metadata')
      matched = true
    }
    const contentHits = count(content, term)
    if (contentHits) {
      score += Math.min(12, contentHits * 2)
      matchedBy.add('full_text')
      matched = true
    }
    if (matched) matchedTerms.add(term)
  }
  return { document, score, matchedBy: [...matchedBy].sort(), matchedTerms: [...matchedTerms].sort() }
}

function compareMatches(left: ProjectMemoryMatch, right: ProjectMemoryMatch) {
  return right.score - left.score
    || timestamp(right.document.updatedAt) - timestamp(left.document.updatedAt)
    || scopeRank(left.document.scope) - scopeRank(right.document.scope)
    || trustRank(left.document.trust) - trustRank(right.document.trust)
    || left.document.path.localeCompare(right.document.path)
    || left.document.id.localeCompare(right.document.id)
}

function scopeRank(scope: ProjectMemoryScope) {
  return scope === 'project' ? 0 : 1
}

function trustRank(trust: ProjectMemoryTrust) {
  return trust === 'trusted_project' ? 0 : 1
}

function timestamp(value: string | undefined) {
  const parsed = value ? Date.parse(value) : 0
  return Number.isFinite(parsed) ? parsed : 0
}

function validateDocument(document: ProjectMemoryDocument) {
  if (!document.id.trim() || !document.path.trim() || !document.content.trim()) {
    throw new AgentCoreError('INVALID_INPUT', 'Project memory id, path and content are required')
  }
  if (!['project', 'user'].includes(document.scope)) throw new AgentCoreError('INVALID_INPUT', `Invalid project memory scope: ${document.scope}`)
  if (!['trusted_project', 'untrusted'].includes(document.trust)) throw new AgentCoreError('INVALID_INPUT', `Invalid project memory trust: ${document.trust}`)
  if (!Array.isArray(document.tags) || document.tags.some((tag) => !String(tag).trim())) {
    throw new AgentCoreError('INVALID_INPUT', `Invalid project memory tags: ${document.id}`)
  }
}

function normalizeDocument(document: ProjectMemoryDocument): ProjectMemoryDocument {
  return {
    ...structuredClone(document),
    id: document.id.trim(),
    path: canonicalPath(document.path),
    tags: uniqueNormalized(document.tags, normalizeTerm),
    sourceRefs: uniqueNormalized(document.sourceRefs ?? [], (value) => value.trim()),
  }
}

function documentIdentity(document: ProjectMemoryDocument) {
  return {
    id: document.id,
    path: document.path,
    title: document.title,
    summary: document.summary,
    tags: document.tags,
    scope: document.scope,
    trust: document.trust,
    updatedAt: document.updatedAt,
    content: document.content,
    sourceRefs: document.sourceRefs,
  }
}

function normalizePath(value: string) {
  return canonicalPath(value).toLocaleLowerCase()
}

function canonicalPath(value: string) {
  return value.trim().replaceAll('\\', '/').replace(/^\.\//, '')
}

function normalizeTerm(value: string) {
  return value.trim().toLocaleLowerCase()
}

function tokens(value: string) {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}_./-]+/gu) ?? []
}

function queryTerms(value: string) {
  const lexical = tokens(value.slice(0, MAX_QUERY_CHARACTERS))
  const terms = new Set<string>()
  for (const lexicalTerm of lexical) {
    addTerm(lexicalTerm)
    for (const match of lexicalTerm.matchAll(/\p{Script=Han}+/gu)) {
      const characters = [...match[0]]
      for (let index = 0; index < characters.length - 1; index += 1) {
        addTerm(characters.slice(index, index + 2).join(''))
        if (terms.size >= MAX_QUERY_TERMS) return [...terms]
      }
    }
    if (terms.size >= MAX_QUERY_TERMS) break
  }
  return [...terms]

  function addTerm(term: string) {
    const bounded = [...term].slice(0, MAX_QUERY_TERM_CHARACTERS).join('')
    if (bounded) terms.add(bounded)
  }
}

function count(values: string[], term: string) {
  return values.reduce((total, value) => total + (value === term || value.includes(term) ? 1 : 0), 0)
}

function uniqueNormalized(values: string[], normalize: (value: string) => string) {
  return [...new Set(values.map(normalize).filter(Boolean))].sort()
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

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}
