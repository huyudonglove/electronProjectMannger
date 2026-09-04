import { reactive, ref, toValue, type MaybeRefOrGetter } from 'vue'
import type { AnyRecord } from '../utils/record-formatters'

export type EditableRecordKind = 'task' | 'thought' | 'research' | 'constraint' | 'version' | 'question'

export type RecordEditForm = {
  title: string
  content: string
  answer: string
  acceptance: string
  mode: 'breadth' | 'depth'
  priority: string
  workLevel: 'light' | 'standard' | 'deep'
  depthReason: string
  userOriginal: string
  detail: string
  constraints: string
  planRollback: string
  label: string
  goal: string
  summary: string
  question: string
  background: string
  recommendation: string
  kind: string
  scope: string
  blocking: boolean
  feedback: string
}

type RecordUpdateApi = {
  updateRecord: (
    projectRoot: string,
    kind: EditableRecordKind,
    target: string,
    patch: Record<string, unknown>,
  ) => Promise<AnyRecord>
}

export type RecordEditControllerOptions = {
  projectRoot: MaybeRefOrGetter<string>
  runAction: (message: string, action: () => Promise<void>) => Promise<unknown>
  ensureReady: () => RecordUpdateApi | null
  replaceDashboard: (dashboard: AnyRecord) => void
  showToast: (message: string) => void
  setStatus?: (message: string) => void
  getStatus?: () => string
}

export function useRecordEditController(options: RecordEditControllerOptions) {
  const editKind = ref<EditableRecordKind | null>(null)
  const editTarget = ref<AnyRecord | null>(null)
  const editForm = reactive<RecordEditForm>(emptyEditForm())

  function openRecordEdit(kind: EditableRecordKind, record: AnyRecord) {
    editKind.value = kind
    editTarget.value = record
    Object.assign(editForm, formFromRecord(kind, record), { feedback: '' })
  }

  function closeRecordEdit() {
    editKind.value = null
    editTarget.value = null
    Object.assign(editForm, emptyEditForm())
  }

  async function saveRecordEdit() {
    const kind = editKind.value
    const record = editTarget.value
    if (!kind || !record) return

    const validationError = validateEditForm(kind, editForm, record)
    if (validationError) {
      editForm.feedback = validationError
      return
    }

    const target = recordTarget(kind, record)
    if (!target) {
      editForm.feedback = '记录 ID 不能为空。'
      return
    }

    const completed = await options.runAction(`正在保存${recordKindLabel(kind)}...`, async () => {
      const api = options.ensureReady()
      if (!api) {
        editForm.feedback = '项目尚未就绪。'
        return
      }
      editForm.feedback = '保存中...'
      const dashboard = await api.updateRecord(
        toValue(options.projectRoot),
        kind,
        target,
        patchFromForm(kind, editForm),
      )
      options.replaceDashboard(dashboard)
      closeRecordEdit()
      options.showToast('修改已保存')
      options.setStatus?.('')
    })
    if (completed === false && editForm.feedback === '保存中...') {
      editForm.feedback = options.getStatus?.() || '保存失败，请重试。'
    }
  }

  return {
    editKind,
    editTarget,
    editForm,
    openRecordEdit,
    closeRecordEdit,
    saveRecordEdit,
  }
}

function emptyEditForm(): RecordEditForm {
  return {
    title: '',
    content: '',
    answer: '',
    acceptance: '',
    mode: 'breadth',
    priority: 'medium',
    workLevel: 'light',
    depthReason: 'decision',
    userOriginal: '',
    detail: '',
    constraints: '',
    planRollback: '',
    label: '',
    goal: '',
    summary: '',
    question: '',
    background: '',
    recommendation: '',
    kind: 'decision',
    scope: 'version',
    blocking: false,
    feedback: '',
  }
}

function formFromRecord(kind: EditableRecordKind, record: AnyRecord): Partial<RecordEditForm> {
  if (kind === 'task') {
    return {
      title: text(record.title),
      priority: text(record.priority) || 'medium',
      workLevel: normalizeWorkLevel(record.workLevel),
      depthReason: text(record.depthReason) || 'decision',
      userOriginal: text(record.userOriginal),
      detail: text(record.detail || record.executionDefinition),
      acceptance: text(record.acceptance),
      constraints: text(record.constraints),
      planRollback: text(record.planRollback),
    }
  }
  if (kind === 'thought') {
    return {
      content: text(record.content),
      answer: normalizePlaceholder(text(record.answer), ['暂无。', '暂无']),
    }
  }
  if (kind === 'research') {
    return {
      content: text(record.recordContent || record.content),
      answer: normalizePlaceholder(text(record.answer), ['待研究。', '待研究', '暂无。', '暂无']),
      acceptance: text(record.acceptance),
      mode: record.mode === 'depth' ? 'depth' : 'breadth',
    }
  }
  if (kind === 'constraint') {
    return { title: text(record.title), content: text(record.content) }
  }
  if (kind === 'version') {
    return {
      label: text(record.label),
      title: text(record.title),
      goal: text(record.goal),
      summary: text(record.summary),
    }
  }
  return {
    title: text(record.title),
    question: text(record.question),
    background: normalizePlaceholder(text(record.background), ['无。', '无']),
    recommendation: normalizePlaceholder(text(record.recommendation), ['无。', '无']),
    kind: text(record.kind) || 'decision',
    scope: text(record.scope) || 'version',
    blocking: Boolean(record.blocking),
  }
}

function validateEditForm(kind: EditableRecordKind, form: RecordEditForm, record: AnyRecord) {
  if (kind === 'task') {
    if (!form.title.trim()) return '请填写任务标题。'
    if (!form.userOriginal.trim()) return '请填写用户原话。'
    if (!form.detail.trim()) return '请填写执行定义。'
    if (!form.acceptance.trim()) return '请填写验收标准。'
    if (form.workLevel === 'deep' && !form.depthReason.trim()) return '请选择深度原因。'
    if (form.workLevel === 'deep' && !form.constraints.trim()) return '深度任务需填写关键约束。'
    if (form.workLevel === 'deep' && !form.planRollback.trim()) return '深度任务需填写方案与回退。'
  } else if (kind === 'thought') {
    if (!form.content.trim()) return '请填写想法内容。'
    if (record.status === 'handled' && !form.answer.trim()) return '已处理想法必须保留处理说明。'
  } else if (kind === 'research') {
    if (!form.content.trim()) return '请填写研究内容。'
  } else if (kind === 'constraint') {
    if (!form.title.trim()) return '请填写约束标题。'
    if (!form.content.trim()) return '请填写约束内容。'
  } else if (kind === 'version') {
    if (!form.label.trim() || !form.title.trim() || !form.goal.trim()) return '请填写版本号、标题和目标。'
  } else if (kind === 'question') {
    if (!form.title.trim() || !form.question.trim()) return '请填写标题和内容。'
  }
  return ''
}

function patchFromForm(kind: EditableRecordKind, form: RecordEditForm): Record<string, unknown> {
  if (kind === 'task') {
    const deep = form.workLevel === 'deep'
    return {
      title: form.title.trim(),
      priority: form.priority,
      workLevel: form.workLevel,
      depthReason: deep ? form.depthReason : '',
      userOriginal: form.userOriginal.trim(),
      executionDefinition: form.detail.trim(),
      acceptance: form.acceptance.trim(),
      constraints: deep ? form.constraints.trim() : '',
      planRollback: deep ? form.planRollback.trim() : '',
    }
  }
  if (kind === 'thought') {
    return { content: form.content.trim(), answer: form.answer.trim() }
  }
  if (kind === 'research') {
    return {
      content: form.content.trim(),
      answer: form.answer.trim(),
      acceptance: form.acceptance.trim(),
      mode: form.mode,
    }
  }
  if (kind === 'constraint') {
    return { title: form.title.trim(), content: form.content.trim() }
  }
  if (kind === 'version') {
    return {
      label: form.label.trim(),
      title: form.title.trim(),
      goal: form.goal.trim(),
      summary: form.summary.trim(),
    }
  }
  return {
    title: form.title.trim(),
    question: form.question.trim(),
    background: form.background.trim(),
    recommendation: form.recommendation.trim(),
    kind: form.kind,
    scope: form.scope,
    blocking: form.blocking,
  }
}

function recordTarget(kind: EditableRecordKind, record: AnyRecord) {
  if (kind === 'version') return text(record.shortId || record.id)
  return text(record.id || record.shortId)
}

function recordKindLabel(kind: EditableRecordKind) {
  return ({
    task: '任务',
    thought: '想法',
    research: '研究',
    constraint: '约束',
    version: '版本',
    question: '协作记录',
  } as Record<EditableRecordKind, string>)[kind]
}

function text(value: unknown) {
  return String(value || '').trim()
}

function normalizePlaceholder(value: string, placeholders: string[]) {
  return placeholders.includes(value) ? '' : value
}

function normalizeWorkLevel(value: unknown): RecordEditForm['workLevel'] {
  if (value === 'standard' || value === 'deep') return value
  return 'light'
}
