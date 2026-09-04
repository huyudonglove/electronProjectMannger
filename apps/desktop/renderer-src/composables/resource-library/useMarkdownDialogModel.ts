import { computed, type Ref } from 'vue'
import { renderReadableMarkdown } from '../../utils/markdown'
import {
  constraintStatusText,
  documentDisplayTitle,
  knowledgeDisplayTitle,
  noteOriginProject,
  projectDisplayName,
  validRefs,
  type AnyRecord,
} from '../../utils/record-formatters'
import type { ResourceKind } from './types'

export function useMarkdownDialogModel(options: {
  dashboard: Readonly<Ref<AnyRecord | null>>
  projectRoot: Readonly<Ref<string>>
  markdownDocument: Ref<AnyRecord | null>
}) {
  const { dashboard, projectRoot, markdownDocument } = options

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

  function openMarkdownDocument(note: AnyRecord, kind: ResourceKind) {
    markdownDocument.value = { ...note, kind }
  }

  function closeMarkdownDocument() {
    markdownDocument.value = null
  }

  return {
    openMarkdownDocument,
    closeMarkdownDocument,
    markdownDialogTitle,
    markdownDialogSubtitle,
    markdownDialogOrigin,
    markdownDialogBadges,
    markdownDialogContentHtml,
  }
}
