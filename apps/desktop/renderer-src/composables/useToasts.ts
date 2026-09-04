import { onBeforeUnmount, readonly, ref } from 'vue'

export type ToastMessage = {
  id: number
  message: string
  leaving: boolean
}

const LEAVE_DELAY = 1800
const REMOVE_DELAY = 2200

export function useToasts() {
  const toasts = ref<ToastMessage[]>([])
  const timers = new Set<number>()

  function schedule(callback: () => void, delay: number) {
    const timer = window.setTimeout(() => {
      timers.delete(timer)
      callback()
    }, delay)
    timers.add(timer)
  }

  function showToast(message: string) {
    if (!message) return

    const toast: ToastMessage = {
      id: Date.now() + Math.random(),
      message,
      leaving: false,
    }
    toasts.value.push(toast)

    schedule(() => {
      toast.leaving = true
    }, LEAVE_DELAY)
    schedule(() => {
      toasts.value = toasts.value.filter((item) => item.id !== toast.id)
    }, REMOVE_DELAY)
  }

  function clearToasts() {
    for (const timer of timers) window.clearTimeout(timer)
    timers.clear()
    toasts.value = []
  }

  onBeforeUnmount(clearToasts)

  return {
    toasts: readonly(toasts),
    showToast,
    clearToasts,
  }
}
