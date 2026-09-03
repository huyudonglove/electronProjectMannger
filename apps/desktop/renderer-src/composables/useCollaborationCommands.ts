import { reactive, ref, toValue, type MaybeRefOrGetter } from 'vue'
import type { AnyRecord } from '../utils/record-formatters'

type CollaborationApi = Pick<
  NonNullable<Window['electronManager']>,
  'replyOpenQuestion' | 'addQuestion' | 'updateQuestionStatus' | 'updateRiskStatus'
>

type StatusForm = { status: string }

export type ReplyForm = {
  answer: string
  status: string
}

export type QuestionForm = {
  title: string
  question: string
  background: string
  recommendation: string
  kind: string
  scope: string
  blocking: boolean
  status: string
}

export type CollaborationCommandOptions = {
  requireCreationVersion: (form?: StatusForm, requestedVersionId?: string) => string
  runAction: (message: string, action: () => Promise<void>) => Promise<unknown>
  ensureReady: () => CollaborationApi | null
  projectRoot: MaybeRefOrGetter<string>
  replaceDashboard: (dashboard: AnyRecord) => void
  showToast: (message: string) => void
  setStatus: (message: string) => void
  onReplySaved: () => void
  onQuestionSaved: () => void
}

export function useCollaborationCommands(options: CollaborationCommandOptions) {
  const replyItem = ref<AnyRecord | null>(null)
  const replyForm = reactive<ReplyForm>({ answer: '', status: '' })
  const questionDialogOpen = ref(false)
  const questionVersionId = ref('')
  const questionForm = reactive<QuestionForm>({
    title: '',
    question: '',
    background: '',
    recommendation: '',
    kind: 'decision',
    scope: 'version',
    blocking: false,
    status: '',
  })

  function openReplyDialog(item: AnyRecord) {
    replyItem.value = item
    resetReplyForm()
  }

  function closeReplyDialog() {
    replyItem.value = null
    resetReplyForm()
  }

  async function submitReply() {
    const item = replyItem.value
    if (!item) return

    await options.runAction('正在保存回复...', async () => {
      const api = options.ensureReady()
      if (!api) return
      const answer = replyForm.answer.trim()
      if (!answer) {
        replyForm.status = '先写回复'
        return
      }
      if (!String(item.question || '').trim()) {
        replyForm.status = '待确认内容不能为空'
        return
      }

      replyForm.status = '保存中...'
      options.replaceDashboard(await api.replyOpenQuestion(toValue(options.projectRoot), {
        questionId: item.id || item.shortId,
        answer,
      }))
      options.onReplySaved()
      closeReplyDialog()
      options.showToast('已发送，等待跟进')
      options.setStatus('')
    })
  }

  function openQuestionDialog(requestedVersionId?: string) {
    const versionId = options.requireCreationVersion(undefined, requestedVersionId)
    if (!versionId) return
    resetQuestionForm()
    questionVersionId.value = versionId
    questionDialogOpen.value = true
  }

  function closeQuestionDialog() {
    questionDialogOpen.value = false
    questionVersionId.value = ''
  }

  async function submitQuestion() {
    await options.runAction('正在保存问题...', async () => {
      const api = options.ensureReady()
      if (!api) return
      const versionId = options.requireCreationVersion(questionForm, questionVersionId.value)
      if (!versionId) return
      if (!questionForm.title.trim() || !questionForm.question.trim()) {
        questionForm.status = '请填写标题和问题'
        return
      }

      questionForm.status = '保存中...'
      options.replaceDashboard(await api.addQuestion(toValue(options.projectRoot), {
        title: questionForm.title,
        question: questionForm.question,
        background: questionForm.background,
        recommendation: questionForm.recommendation,
        kind: questionForm.kind,
        scope: questionForm.scope,
        blocking: questionForm.blocking,
        origin: 'user',
        versionId,
      }))
      options.onQuestionSaved()
      closeQuestionDialog()
      options.showToast('已提交，等待跟进')
      options.setStatus('')
    })
  }

  async function completeQuestion(item: AnyRecord) {
    await options.runAction('正在更新问题...', async () => {
      const api = options.ensureReady()
      if (!api) return
      options.replaceDashboard(await api.updateQuestionStatus(
        toValue(options.projectRoot),
        item.id || item.shortId,
        'resolved',
      ))
      options.showToast('线程已完成')
      options.setStatus('')
    })
  }

  async function resolveRisk(item: AnyRecord) {
    await options.runAction('正在更新风险...', async () => {
      const api = options.ensureReady()
      if (!api) return
      options.replaceDashboard(await api.updateRiskStatus(
        toValue(options.projectRoot),
        item.id || item.shortId,
        'resolved',
      ))
      options.showToast('已标记处理完成')
      options.setStatus('')
    })
  }

  function resetReplyForm() {
    replyForm.answer = ''
    replyForm.status = ''
  }

  function resetQuestionForm() {
    questionForm.title = ''
    questionForm.question = ''
    questionForm.background = ''
    questionForm.recommendation = ''
    questionForm.kind = 'decision'
    questionForm.scope = 'version'
    questionForm.blocking = false
    questionForm.status = ''
  }

  return {
    replyItem,
    replyForm,
    questionDialogOpen,
    questionForm,
    openReplyDialog,
    closeReplyDialog,
    submitReply,
    openQuestionDialog,
    closeQuestionDialog,
    submitQuestion,
    completeQuestion,
    resolveRisk,
  }
}
