import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import type { ActiveModal } from './useModalCoordinator'

type GlobalDismissOptions = {
  activeModal: Readonly<Ref<ActiveModal>>
  quickOpen: Readonly<Ref<boolean>>
  closeQuickCreate: () => void
  versionMenuOpen: Ref<boolean>
}

export function useGlobalDismiss(options: GlobalDismissOptions) {
  const {
    activeModal,
    quickOpen,
    closeQuickCreate,
    versionMenuOpen,
  } = options

  function handleDocumentKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    const modal = activeModal.value
    if (modal) return
    if (quickOpen.value) {
      event.preventDefault()
      closeQuickCreate()
    } else if (versionMenuOpen.value) {
      event.preventDefault()
      versionMenuOpen.value = false
    }
  }

  function handleDocumentPointerDown(event: PointerEvent) {
    const target = event.target as Element | null
    if (!target) return
    if (quickOpen.value && !target.closest('.quick-task, .topbar-create')) closeQuickCreate()
    if (versionMenuOpen.value && !target.closest('.version-switcher')) versionMenuOpen.value = false
  }

  function closeVersionMenu(event: FocusEvent) {
    const container = event.currentTarget as HTMLElement
    const nextTarget = event.relatedTarget as Node | null
    if (!nextTarget || !container.contains(nextTarget)) versionMenuOpen.value = false
  }

  onMounted(() => {
    document.addEventListener('keydown', handleDocumentKeydown)
    document.addEventListener('pointerdown', handleDocumentPointerDown, true)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', handleDocumentKeydown)
    document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
  })

  return {
    closeVersionMenu,
  }
}
