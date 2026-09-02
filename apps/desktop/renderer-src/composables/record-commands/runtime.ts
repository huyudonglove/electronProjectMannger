import type { MaybeRefOrGetter } from 'vue'
import type { ElectronManagerApi } from '../../types/electron-api'
import type { AnyRecord } from '../../utils/record-formatters'

export type StatusForm = { status: string }

export type QuickTaskForm = StatusForm & {
  title: string
  priority: string
  workLevel: string
  depthReason: string
  detail: string
  acceptance: string
  constraints: string
  planRollback: string
}

export type QuickThoughtForm = StatusForm & { content: string }
export type QuickDialogueForm = StatusForm & {
  content: string
  acceptance: string
  mode: 'breadth' | 'depth'
}
export type QuickConstraintForm = StatusForm & { title: string; content: string }

export type RecordCommandsOptions = {
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
}

export function createRecordCommandRuntime(options: RecordCommandsOptions) {
  let mutationInFlight = false

  function finishQuickCreate() {
    options.closeQuickCreate()
    options.showToast('已保存')
    options.state.status = ''
  }

  async function mutate(
    message: string,
    action: (api: ElectronManagerApi) => Promise<AnyRecord>,
    notify = false,
    after?: () => void,
  ) {
    await options.runAction(message, async () => {
      const api = options.ensureReady()
      if (!api) return
      options.replaceDashboard(await action(api))
      after?.()
      if (notify) options.showToast('已删除')
      options.state.status = ''
    })
  }

  function setStatus(message: string) {
    options.state.status = message
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
    options,
    finishQuickCreate,
    mutate,
    setStatus,
    withMutationGuard,
  }
}

export type RecordCommandRuntime = ReturnType<typeof createRecordCommandRuntime>
