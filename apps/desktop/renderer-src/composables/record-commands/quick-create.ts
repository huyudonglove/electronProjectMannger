import { toValue } from 'vue'
import type { RecordCommandRuntime } from './runtime'

export function createQuickCreateCommands(runtime: RecordCommandRuntime) {
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
  } = runtime.options

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
      runtime.finishQuickCreate()
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
      runtime.finishQuickCreate()
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
      runtime.finishQuickCreate()
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
      runtime.finishQuickCreate()
    })
    if (!completed && constraintForm.status === '保存中...') constraintForm.status = ''
  }

  return {
    createTask,
    saveThought,
    saveDialogue,
    saveConstraint,
  }
}
