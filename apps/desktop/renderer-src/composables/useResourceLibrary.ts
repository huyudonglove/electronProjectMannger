import { computed, type Ref } from 'vue'
import { renderReadableMarkdown } from '../utils/markdown'
import {
  constraintStatusText,
  constraintSummary,
  documentDisplayTitle,
  knowledgeDisplayTitle,
  noteCardSummary,
  noteCategory,
  noteOriginProject,
  projectDisplayName,
  validRefs,
  type AnyRecord,
} from '../utils/record-formatters'

export type ResourceKind = 'knowledge' | 'document' | 'constraint'

export type ResourceViewItem = {
  key: string
  record: AnyRecord
  shortId?: string
  title: string
  summary?: string
  rowMeta?: string
  origin?: string
  folder?: string
  detailKicker?: string
  detailMeta?: string
  contentHtml?: string
  deletable?: boolean
}

type DeleteResource = (record: AnyRecord) => void | Promise<void>

type ResourceLibraryOptions = {
  dashboard: Readonly<Ref<AnyRecord | null>>
  projectRoot: Readonly<Ref<string>>
  knowledge: Readonly<Ref<AnyRecord[]>>
  documents: Readonly<Ref<AnyRecord[]>>
  userConstraints: Readonly<Ref<AnyRecord[]>>
  systemConstraints: Readonly<Ref<AnyRecord[]>>
  knowledgeQuery: Readonly<Ref<string>>
  documentQuery: Readonly<Ref<string>>
  constraintQuery: Readonly<Ref<string>>
  selectedKnowledgeKey: Ref<string>
  selectedDocumentKey: Ref<string>
  selectedConstraintKey: Ref<string>
  markdownDocument: Ref<AnyRecord | null>
  deleteKnowledgeNote: DeleteResource
  deleteDocumentNote: DeleteResource
  deleteConstraintRecord: DeleteResource
}

export function useResourceLibrary(options: ResourceLibraryOptions) {
  const {
    dashboard,
    projectRoot,
    knowledge,
    documents,
    userConstraints,
    systemConstraints,
    knowledgeQuery,
    documentQuery,
    constraintQuery,
    selectedKnowledgeKey,
    selectedDocumentKey,
    selectedConstraintKey,
    markdownDocument,
    deleteKnowledgeNote,
    deleteDocumentNote,
    deleteConstraintRecord,
  } = options

  const filteredKnowledge = computed(() => knowledge.value.filter(
    (item) => resourceMatchesQuery(item, knowledgeQuery.value, 'knowledge'),
  ))
  const filteredDocuments = computed(() => documents.value.filter(
    (item) => resourceMatchesQuery(item, documentQuery.value, 'document'),
  ))
  const filteredUserConstraints = computed(() => userConstraints.value.filter(
    (item) => resourceMatchesQuery(item, constraintQuery.value, 'constraint'),
  ))
  const filteredSystemConstraints = computed(() => systemConstraints.value.filter(
    (item) => resourceMatchesQuery(item, constraintQuery.value, 'constraint'),
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

  const markdownDialogTitle = computed(() => {
    const note = markdownDocument.value
    if (!note) return ''
    if (note.kind === 'constraint') return note.title || '项目约束'
    return note.kind === 'knowledge' ? knowledgeDisplayTitle(note) : documentDisplayTitle(note)
  })

  const markdownDialogSubtitle = computed(() => {
    const note = markdownDocument.value
    if (!note) return ''
    if (note.kind === 'constraint') return `约束 · ${note.path || '未标注路径'}`
    return `${note.kind === 'knowledge' ? '知识库' : '文档'} · ${note.path || '未标注路径'}`
  })

  const markdownDialogOrigin = computed(() => {
    const note = markdownDocument.value
    if (!note) return ''
    if (note.kind === 'constraint') {
      return note.source === 'system'
        ? '系统规则'
        : dashboard.value?.config?.name || projectDisplayName(projectRoot.value) || '当前项目'
    }
    return noteOriginProject(note, note.kind, dashboard.value?.config?.name || '', projectRoot.value)
  })

  const markdownDialogBadges = computed(() => {
    const note = markdownDocument.value
    if (!note) return []
    if (note.kind === 'constraint') {
      return validRefs([
        note.shortId,
        constraintStatusText(note.status),
        note.scope,
        note.source === 'system' ? '只读' : '可编辑',
      ])
    }
    const refs = note.kind === 'knowledge'
      ? [note.shortId, note.status, note.source, ...(note.relatedRecords || []), ...(note.relatedTasks || []), ...(note.relatedNotes || [])]
      : [note.shortId, note.type, note.status]
    return validRefs(refs)
  })

  const markdownDialogContentHtml = computed(() => renderReadableMarkdown(markdownDocument.value?.content || ''))

  function resourceKey(item: AnyRecord) {
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

  function selectResource(kind: ResourceKind, item: AnyRecord) {
    const key = resourceKey(item)
    if (kind === 'knowledge') selectedKnowledgeKey.value = key
    else if (kind === 'document') selectedDocumentKey.value = key
    else selectedConstraintKey.value = key
  }

  function selectResourceViewItem(kind: ResourceKind, item: ResourceViewItem) {
    selectResource(kind, item.record)
  }

  function deleteResourceViewItem(kind: ResourceKind, item: ResourceViewItem) {
    if (kind === 'knowledge') return deleteKnowledgeNote(item.record)
    if (kind === 'document') return deleteDocumentNote(item.record)
    return deleteConstraintRecord(item.record)
  }

  function openMarkdownDocument(note: AnyRecord, kind: ResourceKind) {
    markdownDocument.value = { ...note, kind }
  }

  function closeMarkdownDocument() {
    markdownDocument.value = null
  }

  function knowledgeBodyContent(content: string) {
    const lines = String(content || '').split(/\r?\n/)
    const firstSectionIndex = lines.findIndex((line) => /^##\s+/.test(line.trim()))
    if (firstSectionIndex >= 0) return lines.slice(firstSectionIndex).join('\n').trim()
    return lines
      .filter((line) => !/^#\s+/.test(line.trim()) && !/^[A-Za-z0-9_-]+::\s*/.test(line.trim()))
      .join('\n')
      .trim()
  }

  function knowledgeStatusText(status: string) {
    return ({
      active: '生效中',
      archived: '已归档',
      draft: '草稿',
    } as Record<string, string>)[status] || status || '生效中'
  }

  return {
    filteredKnowledge,
    filteredDocuments,
    filteredUserConstraints,
    filteredSystemConstraints,
    knowledgeViewItems,
    documentViewItems,
    constraintViewItems,
    systemConstraintViewItems,
    selectResourceViewItem,
    deleteResourceViewItem,
    openMarkdownDocument,
    closeMarkdownDocument,
    markdownDialogTitle,
    markdownDialogSubtitle,
    markdownDialogOrigin,
    markdownDialogBadges,
    markdownDialogContentHtml,
    knowledgeBodyContent,
    knowledgeStatusText,
  }
}
