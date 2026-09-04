import path from 'node:path'

import {
  CONSTRAINTS_PATH,
  DATA_SPEC_PATH,
  DOCUMENTS_DIR,
  GLOBAL_KNOWLEDGE_DIR,
} from '../paths.js'
import {
  compareShortIdDesc,
  firstContentSummary,
  normalizeVersionId,
  parseDisplayTimeKey,
  parseFields,
  parseUserConstraints,
  readSection,
  splitRefs,
} from '../parsers.js'
import { constraintsTemplate } from '../templates.js'
import type {
  ProjectConstraint,
  ProjectDocumentNote,
  ProjectKnowledgeNote,
} from '../types.js'
import { localTime } from '../utils.js'
import {
  listMarkdownFiles,
  readExistingProjectFile,
  readExistingRootFile,
  readProjectFile,
} from './storage.js'

export async function readConstraintsRecordsFile(dataRoot: string) {
  const current = await readExistingProjectFile(dataRoot, CONSTRAINTS_PATH)
  return current || constraintsTemplate()
}

export async function listProjectDocuments(dataRoot: string): Promise<ProjectDocumentNote[]> {
  const files = await listMarkdownFiles(dataRoot, DOCUMENTS_DIR)
  const notes = await Promise.all(files.map(async (relativePath) => parseDocumentNote(relativePath, await readProjectFile(dataRoot, relativePath))))
  return notes.sort((a, b) => compareShortIdDesc(a.shortId, b.shortId, 'W') || a.path.localeCompare(b.path, 'zh-Hans-CN'))
}

export async function listGlobalKnowledgeDocuments(managerDataRoot: string): Promise<ProjectDocumentNote[]> {
  const files = await listMarkdownFiles(managerDataRoot, GLOBAL_KNOWLEDGE_DIR)
  const notes = await Promise.all(files.map(async (relativePath) => parseDocumentNote(relativePath, await readExistingRootFile(managerDataRoot, relativePath))))
  return notes.sort((a, b) => compareShortIdDesc(a.shortId, b.shortId, 'K') || a.path.localeCompare(b.path, 'zh-Hans-CN'))
}

export async function listProjectConstraints(dataRoot: string, currentVersionId: string): Promise<ProjectConstraint[]> {
  const userConstraints = parseUserConstraints(await readConstraintsRecordsFile(dataRoot))
  const systemConstraints = await listSystemConstraints(dataRoot, currentVersionId)
  return [...userConstraints, ...systemConstraints]
}

async function listSystemConstraints(dataRoot: string, currentVersionId: string): Promise<ProjectConstraint[]> {
  const now = localTime()
  const sources = [
    { id: 'system-data-spec', shortId: 'SYS-数据规范', title: '数据层规范', path: DATA_SPEC_PATH },
  ]

  return Promise.all(sources.map(async (source) => {
    const content = await readExistingProjectFile(dataRoot, source.path)
    return {
      id: source.id,
      shortId: source.shortId,
      title: source.title,
      status: 'readonly',
      scope: 'system',
      version: currentVersionId,
      source: 'system' as const,
      created: now,
      updated: now,
      path: source.path,
      summary: firstContentSummary(content) || source.title,
      content: content.trim(),
    }
  }))
}

export function normalizeKnowledgeShortId(value: string | undefined) {
  const match = String(value || '').trim().match(/^K(\d{1,4})$/i)
  return match ? `K${match[1].padStart(3, '0')}` : ''
}

export function normalizeDocumentShortId(value: string | undefined) {
  const match = String(value || '').trim().match(/^W(\d{1,4})$/i)
  return match ? `W${match[1].padStart(3, '0')}` : ''
}

function parseDocumentNote(relativePath: string, content: string): ProjectDocumentNote {
  const fields = parseFields(content)
  const type = fields.type || noteTypeFromPath(relativePath)
  return {
    path: relativePath,
    folder: path.dirname(relativePath) === '.' ? '' : path.dirname(relativePath),
    title: noteTitle(content, relativePath),
    type,
    status: fields.status || 'active',
    shortId: fields.short_id || '',
    updated: fields.updated || fields.created || '',
    version: normalizeVersionId(fields.version),
    tags: splitRefs(fields.tags),
    summary: fields.summary || readSection(content, ['摘要']) || firstContentSummary(content),
    content: content.trim(),
  }
}

export function parseKnowledgeNotes(notes: ProjectDocumentNote[]): ProjectKnowledgeNote[] {
  return notes
    .filter((note) => note.type === 'knowledge' || note.path.startsWith(`${GLOBAL_KNOWLEDGE_DIR}/`))
    .map((note) => {
      const fields = parseFields(note.content)
      return {
        ...note,
        id: fields.id || '',
        aliases: splitRefs(fields.aliases),
        sourceProject: fields.source_project || '未标注项目',
        source: fields.source || '无',
        relatedRecords: splitRefs(fields.related_records),
        relatedTasks: splitRefs(fields.related_tasks),
        relatedNotes: splitRefs(fields.related_notes),
      }
    })
    .sort((a, b) => compareShortIdDesc(a.shortId, b.shortId, 'K') || a.title.localeCompare(b.title, 'zh-Hans-CN') || knowledgeSortKey(b).localeCompare(knowledgeSortKey(a)))
}

function knowledgeSortKey(note: Pick<ProjectKnowledgeNote, 'updated' | 'shortId' | 'title'>) {
  return [
    note.updated ? parseDisplayTimeKey(note.updated) : '000000000000',
    note.shortId,
    note.title,
  ].join('\u0000')
}

function noteTypeFromPath(relativePath: string) {
  if (relativePath.startsWith('tasks/')) return 'task'
  if (relativePath.startsWith('thoughts/')) return 'thought'
  if (relativePath.startsWith('research/')) return 'research'
  if (relativePath.startsWith('metadata/')) return 'metadata'
  if (relativePath.startsWith('constraints/')) return 'constraint'
  if (relativePath.startsWith('work-logs/')) return 'work-log'
  if (relativePath.startsWith('documents/')) return 'document'
  if (relativePath.startsWith(`${GLOBAL_KNOWLEDGE_DIR}/`)) return 'knowledge'
  return 'note'
}

function noteTitle(content: string, relativePath: string) {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim()
    || content.match(/^##\s+(.+)$/m)?.[1]?.trim()
    || path.basename(relativePath, '.md')
}
