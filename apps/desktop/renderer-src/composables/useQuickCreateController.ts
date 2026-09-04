import { computed, nextTick, onBeforeUnmount, reactive, ref, type Ref } from 'vue'
import type { AnyRecord } from '../utils/record-formatters'

export type QuickCreateMode = '' | 'task' | 'thought' | 'dialogue' | 'constraint'

type QuickCreateControllerOptions = {
  section: Readonly<Ref<string>>
  versions: Readonly<Ref<AnyRecord[]>>
  requireCreationVersion: (form?: { status: string }, requestedVersionId?: string) => string
  openCollaborationCreate: () => void
  hasActiveModal: () => boolean
}

type CloseQuickCreateOptions = {
  restoreFocus?: boolean
}

const modeBySection: Record<string, Exclude<QuickCreateMode, ''>> = {
  board: 'task',
  capture: 'thought',
  dialogues: 'dialogue',
  constraints: 'constraint',
}

export function useQuickCreateController(options: QuickCreateControllerOptions) {
  const {
    section,
    versions,
    requireCreationVersion,
    openCollaborationCreate,
    hasActiveModal,
  } = options

  const quickOpen = ref(false)
  const quickCreateMode = ref<QuickCreateMode>('')
  const quickCreateVersionId = ref('')
  let returnFocus: HTMLElement | null = null

  const taskForm = reactive({
    title: '',
    priority: 'medium',
    workLevel: 'light',
    depthReason: 'decision',
    detail: '',
    acceptance: '',
    constraints: '',
    planRollback: '',
    status: '',
  })
  const thoughtForm = reactive({ content: '', status: '' })
  const dialogueForm = reactive({
    content: '',
    acceptance: '',
    mode: 'breadth' as 'breadth' | 'depth',
    status: '',
  })
  const constraintForm = reactive({ title: '', content: '', status: '' })

  const quickCreateVersion = computed(() =>
    versions.value.find((version: AnyRecord) => version.shortId === quickCreateVersionId.value) || null)
  const quickCreateVersionLabel = computed(() => quickCreateVersion.value
    ? `${quickCreateVersion.value.shortId} · ${quickCreateVersion.value.label}`
    : '')

  function hasDraft() {
    return Boolean(
      taskForm.title.trim()
      || taskForm.detail.trim()
      || taskForm.acceptance.trim()
      || taskForm.constraints.trim()
      || taskForm.planRollback.trim()
      || thoughtForm.content.trim()
      || dialogueForm.content.trim()
      || dialogueForm.acceptance.trim()
      || constraintForm.title.trim()
      || constraintForm.content.trim(),
    )
  }

  function openPrimaryCreate() {
    if (quickOpen.value) {
      close()
      return
    }
    if (section.value === 'collaboration') {
      openCollaborationCreate()
      return
    }

    const versionId = requireCreationVersion()
    if (!versionId) return
    openCreate(versionId, modeBySection[section.value] || '')
  }

  function openCompanionCreate(versionId: string) {
    if (quickOpen.value) {
      close()
      return
    }
    const targetVersionId = requireCreationVersion(undefined, versionId)
    if (!targetVersionId) return
    openCreate(targetVersionId, '', true)
  }

  function openCreate(versionId: string, mode: QuickCreateMode, forceVersion = false) {
    if (forceVersion || !hasDraft() || !quickCreateVersionId.value) quickCreateVersionId.value = versionId
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    quickOpen.value = true
    quickCreateMode.value = mode
    nextTick(() => {
      document.querySelector<HTMLElement>(
        '.quick-task-panel input, .quick-task-panel textarea, .quick-create-option',
      )?.focus({ preventScroll: true })
    })
  }

  function selectMode(mode: Exclude<QuickCreateMode, ''>) {
    quickCreateMode.value = mode
    nextTick(() => {
      document.querySelector<HTMLElement>(
        '.quick-task-panel input, .quick-task-panel textarea',
      )?.focus({ preventScroll: true })
    })
  }

  function close({ restoreFocus = true }: CloseQuickCreateOptions = {}) {
    const shouldRestoreFocus = quickOpen.value && restoreFocus && !hasActiveModal()
    quickOpen.value = false
    quickCreateMode.value = ''
    if (!shouldRestoreFocus) {
      returnFocus = null
      return
    }

    nextTick(() => {
      const target = returnFocus?.isConnected
        ? returnFocus
        : document.querySelector<HTMLElement>('.companion-create, .topbar-create')
      target?.focus({ preventScroll: true })
      returnFocus = null
    })
  }

  onBeforeUnmount(() => {
    returnFocus = null
  })

  return {
    quickOpen,
    quickCreateMode,
    quickCreateVersionId,
    quickCreateVersion,
    quickCreateVersionLabel,
    taskForm,
    thoughtForm,
    dialogueForm,
    constraintForm,
    hasDraft,
    openPrimaryCreate,
    openCompanionCreate,
    selectMode,
    close,
  }
}
