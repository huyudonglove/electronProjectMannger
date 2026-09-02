import {
  dialogueDisplayTitle,
  documentDisplayTitle,
  knowledgeDisplayTitle,
  type AnyRecord,
} from '../utils/record-formatters'
import type { ElectronManagerApi } from '../types/electron-api'
import { toValue, type MaybeRefOrGetter } from 'vue'

type StatusForm = { status: string }
type QuickTaskForm = StatusForm & {
  title: string
  priority: string
  workLevel: string
  depthReason: string
  detail: string
  acceptance: string
  constraints: string
  planRollback: string
}
type QuickThoughtForm = StatusForm & { content: string }
type QuickDialogueForm = StatusForm & { content: string; acceptance: string; mode: 'breadth' | 'depth' }
type QuickConstraintForm = StatusForm & { title: string; content: string }

export function useRecordCommands(options: {
  state: {
    projectRoot: string
    status: string
    selectedTask: AnyRecord | null
    markdownDocument: AnyRecord | null
  }
  quickCreateVersionId: MaybeRefOrGetter<string>
  taskForm: QuickTaskForm
  thoughtForm: QuickThoughtForm
  dialogueForm: QuickDialogueForm
  constraintForm: QuickConstraintForm
  runAction: (message: string, action: () => Promise<void>) => Promise<boolean>
  ensureReady: () => ElectronManagerApi | null
  requireCreationVersion: (form?: StatusForm, requestedVersionId?: string) => string
  replaceDashboard: (dashboard: AnyRecord) => void
  closeQuickCreate: () => void
  closeTaskDetail: () => void
  closeMarkdownDocument: () => void
  showToast: (message: string) => void
}) {
  const {
    state,
    quickCreateVersionId,
    taskForm,
    thoughtForm,
    dialogueForm,
    constraintForm,
    runAction,
    ensureReady,
    requireCreationVersion,
    replaceDashboard,
    closeQuickCreate,
    closeTaskDetail,
    closeMarkdownDocument,
    showToast,
  } = options
  let mutationInFlight = false

  async function createTask() {
    const completed = await runAction('正在新增任务...', async () => {
      const api = ensureReady()
      if (!api) return
      const versionId = requireCreationVersion(taskForm, toValue(quickCreateVersionId))
      if (!versionId) return
      const normalizedTitle = taskForm.title.trim()
      if (!normalizedTitle) {
        taskForm.status = '先写任务标题'
        return
      }
      if (taskForm.workLevel === 'deep' && (!taskForm.constraints.trim() || !taskForm.planRollback.trim())) {
        taskForm.status = '深度任务需填写关键约束和方案与回退'
        return
      }
      taskForm.status = '保存中...'
      replaceDashboard(await api.addTask(state.projectRoot, {
        title: normalizedTitle,
        status: 'todo',
        priority: taskForm.priority,
        workLevel: taskForm.workLevel,
        depthReason: taskForm.workLevel === 'deep' ? taskForm.depthReason : undefined,
        area: 'tool',
        userOriginal: normalizedTitle,
        executionDefinition: taskForm.detail.trim() || '待补充。',
        acceptance: taskForm.acceptance.trim() || '待补充。',
        constraints: taskForm.workLevel === 'deep' ? taskForm.constraints.trim() : undefined,
        planRollback: taskForm.workLevel === 'deep' ? taskForm.planRollback.trim() : undefined,
        versionId,
      }))
      Object.assign(taskForm, {
        title: '',
        detail: '',
        acceptance: '',
        priority: 'medium',
        workLevel: 'light',
        depthReason: 'decision',
        constraints: '',
        planRollback: '',
        status: '',
      })
      finishQuickCreate()
    })
    if (!completed && taskForm.status === '保存中...') taskForm.status = ''
  }

  async function saveThought() {
    const completed = await runAction('正在保存输入...', async () => {
      const api = ensureReady()
      if (!api) return
      const versionId = requireCreationVersion(thoughtForm, toValue(quickCreateVersionId))
      if (!versionId) return
      const content = thoughtForm.content.trim()
      if (!content) {
        thoughtForm.status = '先写一点内容'
        return
      }
      thoughtForm.status = '保存中...'
      replaceDashboard(await api.addThought(state.projectRoot, { content, versionId }))
      Object.assign(thoughtForm, { content: '', status: '' })
      finishQuickCreate()
    })
    if (!completed && thoughtForm.status === '保存中...') thoughtForm.status = ''
  }

  async function saveDialogue() {
    const completed = await runAction('正在记录研究...', async () => {
      const api = ensureReady()
      if (!api) return
      const versionId = requireCreationVersion(dialogueForm, toValue(quickCreateVersionId))
      if (!versionId) return
      const content = dialogueForm.content.trim()
      if (!content) {
        dialogueForm.status = '先写一点内容'
        return
      }
      dialogueForm.status = '保存中...'
      replaceDashboard(await api.addDialogue(state.projectRoot, {
        content,
        acceptance: dialogueForm.acceptance,
        mode: dialogueForm.mode,
        versionId,
      }))
      Object.assign(dialogueForm, { content: '', acceptance: '', mode: 'breadth', status: '' })
      finishQuickCreate()
    })
    if (!completed && dialogueForm.status === '保存中...') dialogueForm.status = ''
  }

  async function saveConstraint() {
    const completed = await runAction('正在保存约束...', async () => {
      const api = ensureReady()
      if (!api) return
      const versionId = requireCreationVersion(constraintForm, toValue(quickCreateVersionId))
      if (!versionId) return
      const title = constraintForm.title.trim()
      const content = constraintForm.content.trim()
      if (!title) {
        constraintForm.status = '先写约束标题'
        return
      }
      if (!content) {
        constraintForm.status = '先写约束内容'
        return
      }
      constraintForm.status = '保存中...'
      replaceDashboard(await api.addConstraint(state.projectRoot, {
        title,
        content,
        scope: 'project',
        status: 'active',
        versionId,
      }))
      Object.assign(constraintForm, { title: '', content: '', status: '' })
      finishQuickCreate()
    })
    if (!completed && constraintForm.status === '保存中...') constraintForm.status = ''
  }

  function finishQuickCreate() {
    closeQuickCreate()
    showToast('已保存')
    state.status = ''
  }

  async function deleteConstraintRecord(constraint: AnyRecord) {
    if (constraint.source === 'system') return
    if (!String(constraint.id || '').trim()) return setStatus('约束 ID 不能为空。')
    if (!confirm(`删除这条项目约束？\n\n${constraint.shortId || ''} ${constraint.title || ''}`.trim())) return
    await mutate('正在删除约束...', (api) => api.deleteConstraint(state.projectRoot, constraint.id))
  }

  async function deleteThought(thoughtId: string) {
    if (!String(thoughtId || '').trim()) return setStatus('输入 ID 不能为空。')
    if (!confirm('删除这条输入/想法？')) return
    await mutate('正在删除输入...', (api) => api.deleteThought(state.projectRoot, thoughtId))
  }

  async function deleteTask(taskId: string) {
    if (!String(taskId || '').trim()) return setStatus('任务 ID 不能为空。')
    if (!confirm('删除这张任务卡？')) return
    await mutate('正在删除任务...', (api) => api.deleteTask(state.projectRoot, taskId), false, () => {
      if (state.selectedTask?.id === taskId) closeTaskDetail()
    })
  }

  async function deleteDialogueRecord(dialogue: AnyRecord) {
    const dialogueId = String(dialogue.id || dialogue.shortId || '').trim()
    if (!dialogueId) return setStatus('研究 ID 不能为空。')
    if (!confirm(`删除这条研究？删除操作不级联，关联文档会保留。\n\n${dialogue.shortId || ''} ${dialogueDisplayTitle(dialogue)}`.trim())) return
    await mutate('正在删除研究...', (api) => api.deleteDialogue(state.projectRoot, dialogueId), true)
  }

  async function deleteDocumentNote(note: AnyRecord) {
    const target = String(note.path || note.shortId || '').trim()
    if (!target) return setStatus('文档 ID 不能为空。')
    if (!confirm(`删除这份文档？删除操作不级联，研究引用会保留。\n\n${note.shortId || ''} ${documentDisplayTitle(note)}`.trim())) return
    await mutate('正在删除文档...', (api) => api.deleteDocument(state.projectRoot, target), true, () => {
      if (state.markdownDocument?.kind === 'document' && state.markdownDocument.path === note.path) closeMarkdownDocument()
    })
  }

  async function deleteKnowledgeNote(note: AnyRecord) {
    const target = String(note.path || note.id || note.shortId || '').trim()
    if (!target) return setStatus('知识 ID 不能为空。')
    if (!confirm(`删除这条知识？\n\n${note.shortId || ''} ${knowledgeDisplayTitle(note)}`.trim())) return
    await mutate('正在删除知识...', (api) => api.deleteKnowledge(state.projectRoot, target), true, () => {
      if (state.markdownDocument?.kind === 'knowledge' && state.markdownDocument.path === note.path) closeMarkdownDocument()
    })
  }

  async function updateTaskStatus(taskId: string, status: string) {
    if (!String(taskId || '').trim()) return setStatus('任务 ID 不能为空。')
    if (!String(status || '').trim()) return setStatus('任务状态不能为空。')
    await mutate('正在更新任务状态...', (api) => api.updateTaskStatus(state.projectRoot, taskId, status))
  }

  async function mutate(
    message: string,
    action: (api: ElectronManagerApi) => Promise<AnyRecord>,
    notify = false,
    after?: () => void,
  ) {
    await runAction(message, async () => {
      const api = ensureReady()
      if (!api) return
      replaceDashboard(await action(api))
      after?.()
      if (notify) showToast('已删除')
      state.status = ''
    })
  }

  function setStatus(message: string) {
    state.status = message
  }

  function withMutationGuard<Args extends unknown[]>(action: (...args: Args) => Promise<void>) {
    return async (...args: Args) => {
      if (mutationInFlight) return
      mutationInFlight = true
      try {
        await action(...args)
      } finally {
        mutationInFlight = false
      }
    }
  }

  return {
    createTask: withMutationGuard(createTask),
    saveThought: withMutationGuard(saveThought),
    saveDialogue: withMutationGuard(saveDialogue),
    saveConstraint: withMutationGuard(saveConstraint),
    deleteConstraintRecord: withMutationGuard(deleteConstraintRecord),
    deleteThought: withMutationGuard(deleteThought),
    deleteTask: withMutationGuard(deleteTask),
    deleteDialogueRecord: withMutationGuard(deleteDialogueRecord),
    deleteDocumentNote: withMutationGuard(deleteDocumentNote),
    deleteKnowledgeNote: withMutationGuard(deleteKnowledgeNote),
    updateTaskStatus: withMutationGuard(updateTaskStatus),
  }
}
