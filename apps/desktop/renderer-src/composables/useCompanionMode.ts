import { onMounted, ref } from 'vue'

export function useCompanionMode(options: {
  beforeEnter: () => void
  showToast: (message: string) => void
}) {
  const companionMode = ref(false)
  const companionPinned = ref(true)
  const companionSwitching = ref(false)
  const companionStateReady = ref(false)

  function applyState(state?: { enabled?: boolean; alwaysOnTop?: boolean }) {
    companionMode.value = Boolean(state?.enabled)
    companionPinned.value = state?.alwaysOnTop !== false
  }

  async function loadCompanionState() {
    if (!window.electronManager?.getCompanionWindowState) {
      companionStateReady.value = true
      return
    }
    try {
      applyState(await window.electronManager.getCompanionWindowState())
    } catch (error) {
      console.error(error)
    } finally {
      companionStateReady.value = true
    }
  }

  async function setCompanionMode(enabled: boolean) {
    if (companionSwitching.value || companionMode.value === enabled) return
    if (enabled) options.beforeEnter()
    companionSwitching.value = true
    try {
      if (window.electronManager?.setCompanionMode) {
        applyState(await window.electronManager.setCompanionMode(enabled))
      } else {
        companionMode.value = enabled
      }
    } catch (error: any) {
      console.error(error)
      options.showToast(error?.message || '切换陪伴模式失败')
    } finally {
      companionSwitching.value = false
    }
  }

  async function toggleCompanionPinned() {
    if (companionSwitching.value) return
    companionSwitching.value = true
    try {
      if (window.electronManager?.setCompanionAlwaysOnTop) {
        applyState(await window.electronManager.setCompanionAlwaysOnTop(!companionPinned.value))
      } else {
        companionPinned.value = !companionPinned.value
      }
    } catch (error: any) {
      console.error(error)
      options.showToast(error?.message || '切换窗口置顶失败')
    } finally {
      companionSwitching.value = false
    }
  }

  onMounted(loadCompanionState)

  return {
    companionMode,
    companionPinned,
    companionSwitching,
    companionStateReady,
    setCompanionMode,
    toggleCompanionPinned,
  }
}
