import {
  dialogueDisplayTitle,
  documentDisplayTitle,
  knowledgeDisplayTitle,
  type AnyRecord,
} from '../../utils/record-formatters'
import type { RecordCommandRuntime } from './runtime'

export function createRecordMutationCommands(runtime: RecordCommandRuntime) {
  const { state, closeTaskDetail, closeMarkdownDocument } = runtime.options

  async function deleteConstraintRecord(constraint: AnyRecord) {
    if (constraint.source === 'system') return
    if (!String(constraint.id || '').trim()) return runtime.setStatus('约束 ID 不能为空。')
    if (!confirm(`删除这条项目约束？\n\n${constraint.shortId || ''} ${constraint.title || ''}`.trim())) return
    await runtime.mutate('正在删除约束...', (api) => api.deleteConstraint(state.projectRoot, constraint.id))
  }

  async function deleteThought(thoughtId: string) {
    if (!String(thoughtId || '').trim()) return runtime.setStatus('输入 ID 不能为空。')
    if (!confirm('删除这条输入/想法？')) return
    await runtime.mutate('正在删除输入...', (api) => api.deleteThought(state.projectRoot, thoughtId))
  }

  async function deleteTask(taskId: string) {
    if (!String(taskId || '').trim()) return runtime.setStatus('任务 ID 不能为空。')
    if (!confirm('删除这张任务卡？')) return
    await runtime.mutate('正在删除任务...', (api) => api.deleteTask(state.projectRoot, taskId), false, () => {
      if (state.selectedTask?.id === taskId) closeTaskDetail()
    })
  }

  async function deleteDialogueRecord(dialogue: AnyRecord) {
    const dialogueId = String(dialogue.id || dialogue.shortId || '').trim()
    if (!dialogueId) return runtime.setStatus('研究 ID 不能为空。')
    if (!confirm(`删除这条研究？删除操作不级联，关联文档会保留。\n\n${dialogue.shortId || ''} ${dialogueDisplayTitle(dialogue)}`.trim())) return
    await runtime.mutate('正在删除研究...', (api) => api.deleteDialogue(state.projectRoot, dialogueId), true)
  }

  async function deleteDocumentNote(note: AnyRecord) {
    const target = String(note.path || note.shortId || '').trim()
    if (!target) return runtime.setStatus('文档 ID 不能为空。')
    if (!confirm(`删除这份文档？删除操作不级联，研究引用会保留。\n\n${note.shortId || ''} ${documentDisplayTitle(note)}`.trim())) return
    await runtime.mutate('正在删除文档...', (api) => api.deleteDocument(state.projectRoot, target), true, () => {
      if (state.markdownDocument?.kind === 'document' && state.markdownDocument.path === note.path) closeMarkdownDocument()
    })
  }

  async function deleteKnowledgeNote(note: AnyRecord) {
    const target = String(note.path || note.id || note.shortId || '').trim()
    if (!target) return runtime.setStatus('知识 ID 不能为空。')
    if (!confirm(`删除这条知识？\n\n${note.shortId || ''} ${knowledgeDisplayTitle(note)}`.trim())) return
    await runtime.mutate('正在删除知识...', (api) => api.deleteKnowledge(state.projectRoot, target), true, () => {
      if (state.markdownDocument?.kind === 'knowledge' && state.markdownDocument.path === note.path) closeMarkdownDocument()
    })
  }

  async function updateTaskStatus(taskId: string, status: string) {
    if (!String(taskId || '').trim()) return runtime.setStatus('任务 ID 不能为空。')
    if (!String(status || '').trim()) return runtime.setStatus('任务状态不能为空。')
    await runtime.mutate('正在更新任务状态...', (api) => api.updateTaskStatus(state.projectRoot, taskId, status))
  }

  async function updateThoughtStatus(thoughtId: string, status: 'inbox' | 'handled', answer?: string) {
    if (!String(thoughtId || '').trim()) return runtime.setStatus('想法 ID 不能为空。')
    if (status === 'handled' && !String(answer || '').trim()) return runtime.setStatus('请填写处理说明。')
    await runtime.mutate('正在更新想法状态...', (api) => api.updateThoughtStatus(
      state.projectRoot,
      thoughtId,
      status,
      answer,
    ))
  }

  async function updateDialogueStatus(dialogueId: string, status: 'pending' | 'doing' | 'done' | 'archived') {
    if (!String(dialogueId || '').trim()) return runtime.setStatus('研究 ID 不能为空。')
    await runtime.mutate('正在更新研究状态...', (api) => api.updateDialogueStatus(state.projectRoot, dialogueId, status))
  }

  return {
    deleteConstraintRecord,
    deleteThought,
    deleteTask,
    deleteDialogueRecord,
    deleteDocumentNote,
    deleteKnowledgeNote,
    updateTaskStatus,
    updateThoughtStatus,
    updateDialogueStatus,
  }
}
