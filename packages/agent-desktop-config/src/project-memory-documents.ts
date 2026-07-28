import type { ProjectMemoryDocument } from '@electron-manager/agent-memory'
import type { Dashboard, ProjectConstraint, ProjectDocumentNote, ProjectKnowledgeNote } from '@electron-manager/project-core'

export const DESKTOP_PROJECT_MEMORY_MAX_DOCUMENTS = 128
export const DESKTOP_PROJECT_MEMORY_MAX_DOCUMENT_CHARACTERS = 32_000
export const DESKTOP_PROJECT_MEMORY_MAX_TOTAL_CHARACTERS = 512_000

type Candidate = ProjectMemoryDocument & { categoryRank: number }

export function projectMemoryDocumentsFromDashboard(dashboard: Dashboard): ProjectMemoryDocument[] {
  const candidates = [
    ...dashboard.constraints
      .filter((constraint) => ['active', 'readonly'].includes(constraint.status))
      .map(constraintCandidate),
    ...dashboard.documents
      .filter((document) => ['active', 'readonly'].includes(document.status) && /^W\d{3,4}$/i.test(document.shortId))
      .map(documentCandidate),
    ...dashboard.knowledge
      .filter((note) => ['active', 'readonly'].includes(note.status)
        && /^K\d{3,4}$/i.test(note.shortId)
        && belongsToProject(note.sourceProject, dashboard))
      .map(knowledgeCandidate),
  ].sort(candidateOrder)

  const selected: ProjectMemoryDocument[] = []
  const seen = new Set<string>()
  let totalCharacters = 0
  for (const candidate of candidates) {
    if (selected.length >= DESKTOP_PROJECT_MEMORY_MAX_DOCUMENTS || seen.has(candidate.id)) continue
    const remaining = DESKTOP_PROJECT_MEMORY_MAX_TOTAL_CHARACTERS - totalCharacters
    if (remaining < 80) break
    const content = boundedContent(candidate.content, Math.min(DESKTOP_PROJECT_MEMORY_MAX_DOCUMENT_CHARACTERS, remaining))
    if (!content) continue
    const { categoryRank: _categoryRank, ...document } = candidate
    selected.push({ ...document, content })
    seen.add(candidate.id)
    totalCharacters += content.length
  }
  return selected
}

function belongsToProject(sourceProject: string, dashboard: Dashboard) {
  const source = String(sourceProject || '').trim().toLocaleLowerCase()
  if (!source) return false
  return [dashboard.config.name, dashboard.config.projectId]
    .map((value) => String(value || '').trim().toLocaleLowerCase())
    .includes(source)
}

function constraintCandidate(constraint: ProjectConstraint): Candidate {
  const path = safeRelativePath(constraint.path, ['constraints/', 'collaboration/', 'skills/'])
  return {
    id: `constraint:${constraint.id || constraint.shortId || path}`,
    path,
    title: constraint.title,
    summary: constraint.summary,
    tags: unique(['constraint', constraint.scope, constraint.source]),
    scope: 'project',
    trust: 'trusted_project',
    ...(constraint.source === 'user' && constraint.updated ? { updatedAt: constraint.updated } : {}),
    content: constraint.content,
    sourceRefs: unique([
      `constraint:${constraint.shortId || constraint.id}`,
      `project-path:${path}`,
    ]),
    categoryRank: 0,
  }
}

function documentCandidate(document: ProjectDocumentNote): Candidate {
  const path = safeRelativePath(document.path, ['documents/'])
  return {
    id: `document:${document.shortId || path}`,
    path,
    title: document.title,
    summary: document.summary,
    tags: unique(['document', document.type, ...document.tags]),
    scope: 'project',
    trust: 'untrusted',
    ...(document.updated ? { updatedAt: document.updated } : {}),
    content: document.content,
    sourceRefs: unique([`document:${document.shortId}`, `project-path:${path}`]),
    categoryRank: 1,
  }
}

function knowledgeCandidate(note: ProjectKnowledgeNote): Candidate {
  const path = safeRelativePath(note.path, ['knowledge/'])
  return {
    id: `knowledge:${note.id || note.shortId || path}`,
    path,
    title: note.title,
    summary: note.summary,
    tags: unique(['knowledge', ...note.tags]),
    scope: 'project',
    trust: 'untrusted',
    ...(note.updated ? { updatedAt: note.updated } : {}),
    content: note.content,
    sourceRefs: unique([
      `knowledge:${note.shortId || note.id}`,
      `project-path:${path}`,
      ...(note.source ? [`knowledge-source:${note.source}`] : []),
    ]),
    categoryRank: 2,
  }
}

function candidateOrder(left: Candidate, right: Candidate) {
  const updated = (right.updatedAt || '').localeCompare(left.updatedAt || '')
  return left.categoryRank - right.categoryRank
    || updated
    || left.path.localeCompare(right.path)
    || left.id.localeCompare(right.id)
}

function safeRelativePath(value: string, prefixes: string[]) {
  const normalized = String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '')
  if (!normalized
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.includes('\0')
    || normalized.split('/').some((segment) => segment === '..' || segment === '.')
    || !prefixes.some((prefix) => normalized.startsWith(prefix))) {
    throw new Error(`Project memory path is unsafe: ${value || 'empty'}`)
  }
  return normalized
}

function boundedContent(value: string, maxCharacters: number) {
  const normalized = String(value || '').replace(/\r\n/g, '\n').trim()
  if (!normalized) return ''
  return normalized.length <= maxCharacters ? normalized : `${normalized.slice(0, Math.max(0, maxCharacters - 1))}…`
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].sort()
}
