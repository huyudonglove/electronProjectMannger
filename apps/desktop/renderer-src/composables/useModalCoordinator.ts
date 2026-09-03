import { computed, onBeforeUnmount, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'

export type ActiveModal =
  | 'projects'
  | 'task'
  | 'reply'
  | 'version'
  | 'question'
  | 'markdown'
  | 'thoughtResolve'
  | 'initialize'
  | ''

type ModalState = MaybeRefOrGetter<unknown>

export type ModalCoordinatorOptions = {
  projectOverlayOpen: ModalState
  selectedTask: ModalState
  replyItem: ModalState
  versionDialogOpen: ModalState
  questionDialogOpen: ModalState
  markdownDocument: ModalState
  thoughtResolveItem: ModalState
  projectRoot: ModalState
  initialized: ModalState
  closeQuickCreate: () => void
  versionMenuOpen: Ref<boolean>
}

export function useModalCoordinator(options: ModalCoordinatorOptions) {
  const activeModal = computed<ActiveModal>(() => {
    if (toValue(options.projectOverlayOpen)) return 'projects'
    if (toValue(options.selectedTask)) return 'task'
    if (toValue(options.replyItem)) return 'reply'
    if (toValue(options.versionDialogOpen)) return 'version'
    if (toValue(options.questionDialogOpen)) return 'question'
    if (toValue(options.markdownDocument)) return 'markdown'
    if (toValue(options.thoughtResolveItem)) return 'thoughtResolve'
    if (toValue(options.projectRoot) && !toValue(options.initialized)) return 'initialize'
    return ''
  })

  watch(
    activeModal,
    (nextModal, previousModal) => {
      if (nextModal && !previousModal) {
        options.closeQuickCreate()
        options.versionMenuOpen.value = false
      }
      document.body.classList.toggle('modal-open', Boolean(nextModal))
    },
    { flush: 'pre', immediate: true },
  )

  onBeforeUnmount(() => {
    document.body.classList.remove('modal-open')
  })

  return {
    activeModal,
  }
}
