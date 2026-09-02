import { computed, type Ref } from 'vue'
import { renderReadableMarkdown } from '../../utils/markdown'
import {
  constraintStatusText,
  constraintSummary,
  documentDisplayTitle,
  knowledgeDisplayTitle,
  noteCardSummary,
  noteCategory,
  noteOriginProject,
  type AnyRecord,
} from '../../utils/record-formatters'
import type { ResourceKind, ResourceViewItem } from './types'

export function useResourceViewModels(options: {
  knowledge: Readonly<Ref<AnyRecord[]>>
  documents: Readonly<Ref<AnyRecord[]>>
  userConstraints: Readonly<Ref<AnyRecord[]>>
  systemConstraints: Readonly<Ref<AnyRecord[]>>
  knowledgeQuery: Readonly<Ref<string>>
  documentQuery: Readonly<Ref<string>>
  constraintQuery: Readonly<Ref<string>>
}) {
  const filteredKnowledge = computed(() => options.knowledge.value.filter(
    (item) => resourceMatchesQuery(item, options.knowledgeQuery.value, 'knowledge'),
  ))
  const filteredDocuments = computed(() => options.documents.value.filter(
    (item) => resourceMatchesQuery(item, options.documentQuery.value, 'document'),
  ))
  const filteredUserConstraints = computed(() => options.userConstraints.value.filter(
    (item) => resourceMatchesQuery(item, options.constraintQuery.value, 'constraint'),
  ))
  const filteredSystemConstraints = computed(() => options.systemConstraints.value.filter(
    (item) => resourceMatchesQuery(item, options.constraintQuery.value, 'constraint'),
  ))

  const knowledgeViewItems = computed<ResourceViewItem[]>(() => filteredKnowledge.value.map((note) => ({
    key: resourceKey(note),
    record: note,
    shortId: note.shortId || 'K000',
    title: knowledgeDisplayTitle(note),
    summary: noteCardSummary(note, 'knowledge'),
    rowMeta: knowledgeStatusText(note.status),
    origin: noteOriginProject(note, 'knowledge'),
    detailKicker: `${note.shortId || 'K000'} · ${knowledgeStatusText(note.status)}`,
    detailMeta: `出处：${noteOriginProject(note, 'knowledge')}`,
    contentHtml: renderReadableMarkdown(note.content || note.summary || ''),
  })))

  const documentViewItems = computed<ResourceViewItem[]>(() => filteredDocuments.value.map((note) => ({
    key: resourceKey(note),
    record: note,
    shortId: note.shortId || 'W000',
    title: documentDisplayTitle(note),
    summary: noteCardSummary(note, 'document'),
    rowMeta: `${noteCategory(note.path)} · ${note.version || '未标注'}`,
    folder: note.folder || '根目录',
    detailKicker: `${note.shortId || 'W000'} · ${noteCategory(note.path)}`,
    detailMeta: `${note.path} · ${note.version || '未标注版本'}`,
    contentHtml: renderReadableMarkdown(note.content || note.summary || ''),
  })))

  const constraintViewItems = computed<ResourceViewItem[]>(() => filteredUserConstraints.value.map((constraint) => ({
    key: resourceKey(constraint),
    record: constraint,
    shortId: constraint.shortId || 'C000',
    title: constraint.title,
    summary: constraintSummary(constraint),
    rowMeta: `${constraintStatusText(constraint.status)} · ${constraint.version || '未标注'}`,
    detailKicker: `${constraint.shortId || 'C000'} · ${constraintStatusText(constraint.status)}`,
    detailMeta: `${constraint.path || constraint.scope || '项目约束'} · ${constraint.version || '未标注版本'}`,
    contentHtml: renderReadableMarkdown(constraint.content || constraintSummary(constraint)),
  })))

  const systemConstraintViewItems = computed<ResourceViewItem[]>(() => filteredSystemConstraints.value.map((constraint) => ({
    key: resourceKey(constraint),
    record: constraint,
    shortId: constraint.shortId || 'C000',
    title: constraint.title,
    summary: constraintSummary(constraint),
    rowMeta: '只读',
    detailKicker: `${constraint.shortId || 'C000'} · 系统规则 · 只读`,
    detailMeta: `${constraint.path || constraint.scope || '项目约束'} · ${constraint.version || '未标注版本'}`,
    contentHtml: renderReadableMarkdown(constraint.content || constraintSummary(constraint)),
    deletable: false,
  })))

  return {
    filteredKnowledge,
    filteredDocuments,
    filteredUserConstraints,
    filteredSystemConstraints,
    knowledgeViewItems,
    documentViewItems,
    constraintViewItems,
    systemConstraintViewItems,
  }
}

export function resourceKey(item: AnyRecord) {
  return String(item?.path || item?.id || item?.shortId || item?.title || '')
}

function resourceMatchesQuery(item: AnyRecord, queryValue: string, kind: ResourceKind) {
  const query = queryValue.trim().toLocaleLowerCase()
  if (!query) return true
  const title = kind === 'knowledge'
    ? knowledgeDisplayTitle(item)
    : kind === 'document'
      ? documentDisplayTitle(item)
      : item.title
  return [item.shortId, title, item.summary, item.content, item.path, item.version, item.scope]
    .some((value) => String(value || '').toLocaleLowerCase().includes(query))
}

function knowledgeStatusText(status: string) {
  return ({
    active: '生效中',
    archived: '已归档',
    draft: '草稿',
  } as Record<string, string>)[status] || status || '生效中'
}
