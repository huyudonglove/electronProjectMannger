import { createHash } from 'node:crypto'

import { AgentCoreError } from '@electron-manager/agent-core'
import type { ContextSource } from '@electron-manager/agent-context'

import {
  ProjectMemoryIndex,
  type ProjectMemoryTrust,
} from './project-memory.js'

export interface ProjectMemoryContextOptions {
  maxTokens: number
  maxResults?: number
  maxExcerptCharacters?: number
}

export function createProjectMemoryContextSources(
  index: ProjectMemoryIndex,
  options: ProjectMemoryContextOptions,
): ContextSource[] {
  if (!Number.isSafeInteger(options.maxTokens) || options.maxTokens <= 0) {
    throw new AgentCoreError('INVALID_INPUT', 'Project memory context maxTokens must be a positive integer')
  }
  const maxResults = options.maxResults ?? 8
  const maxExcerptCharacters = options.maxExcerptCharacters ?? 1_200
  if (!Number.isSafeInteger(maxResults) || maxResults <= 0 || !Number.isSafeInteger(maxExcerptCharacters) || maxExcerptCharacters < 80) {
    throw new AgentCoreError('INVALID_INPUT', 'Project memory context limits are invalid')
  }
  return [memorySource('trusted_project'), memorySource('untrusted')]

  function memorySource(trust: ProjectMemoryTrust): ContextSource {
    return {
      descriptor: {
        id: `project.memory.${trust}`,
        revision: hash(`${index.retrievalRevision}:${index.revision}:${trust}:${maxResults}:${maxExcerptCharacters}`),
        region: 'recent_dynamic_context',
        scope: 'project',
        trust,
        priority: trust === 'trusted_project' ? 75 : 55,
        required: false,
        compressible: true,
        maxTokens: options.maxTokens,
      },
      collect: ({ ledger }) => index.search({
        text: [ledger.objective, ...ledger.constraints, ledger.nextAction || ''].join('\n'),
        paths: [
          ...ledger.inspectedFiles.map((item) => item.path),
          ...ledger.changes.map((item) => item.path),
        ],
        scopes: ['project'],
        trust,
        limit: maxResults,
      }).map((match, rank) => ({
        id: `project-memory-${trust}-${safeId(match.document.id)}-step-${ledger.stepCount}`,
        role: 'user' as const,
        content: canonicalJson({
          kind: 'project_memory_result',
          id: match.document.id,
          path: match.document.path,
          title: match.document.title,
          summary: match.document.summary,
          tags: match.document.tags,
          updatedAt: match.document.updatedAt,
          matchedBy: match.matchedBy,
          matchedTerms: match.matchedTerms,
          excerpt: excerpt(match.document.content, maxExcerptCharacters),
        }),
        sourceRefs: unique([
          `project-memory:${match.document.id}`,
          `project-path:${match.document.path}`,
          ...(match.document.sourceRefs ?? []),
        ]),
        sequence: ledger.stepCount * 1_000 + 170 + rank,
      })),
    }
  }
}

function excerpt(value: string, maxCharacters: number) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= maxCharacters ? normalized : `${normalized.slice(0, maxCharacters - 1)}…`
}

function safeId(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function unique(values: string[]) {
  return [...new Set(values)].sort()
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
