<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch, type HTMLAttributes } from 'vue'

const props = withDefaults(defineProps<{
  open: boolean
  titleId: string
  as?: 'div' | 'section' | 'form'
  panelClass?: HTMLAttributes['class']
  overlayClass?: HTMLAttributes['class']
  describedBy?: string
  dismissible?: boolean
  busy?: boolean
  initialFocusSelector?: string
}>(), {
  as: 'section',
  panelClass: '',
  overlayClass: '',
  describedBy: undefined,
  dismissible: true,
  busy: false,
  initialFocusSelector: '[data-dialog-initial]',
})

const emit = defineEmits<{
  close: []
  submit: []
}>()

const dialog = ref<HTMLElement | null>(null)
let returnFocus: HTMLElement | null = null
let lastExternalFocus: HTMLElement | null = null

onMounted(() => {
  document.addEventListener('focusin', rememberExternalFocus)
})

watch(
  () => props.open,
  async (open, wasOpen) => {
    if (open && !wasOpen) {
      returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : lastExternalFocus
    }

    if (open && !props.busy) await focusDialog()
    if (!open && wasOpen) restoreFocus()
  },
  { flush: 'pre', immediate: true },
)

watch(
  () => props.busy,
  async (busy, wasBusy) => {
    if (props.open && wasBusy && !busy) await focusDialog()
  },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  document.removeEventListener('focusin', rememberExternalFocus)
  if (props.open) restoreFocus()
})

function rememberExternalFocus(event: FocusEvent) {
  const target = event.target
  if (target instanceof HTMLElement && !dialog.value?.contains(target)) lastExternalFocus = target
}

async function focusDialog() {
  await nextTick()
  const target = dialog.value?.querySelector<HTMLElement>(props.initialFocusSelector) || dialog.value
  target?.focus({ preventScroll: true })
}

function restoreFocus() {
  const target = returnFocus?.isConnected
    ? returnFocus
    : document.querySelector<HTMLElement>('.topbar-create, .project-switcher')
  target?.focus({ preventScroll: true })
  returnFocus = null
}

function requestClose() {
  if (props.dismissible) emit('close')
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (!props.dismissible) return
    event.preventDefault()
    event.stopPropagation()
    emit('close')
    return
  }

  if (event.key !== 'Tab' || !dialog.value) return
  const focusable = [...dialog.value.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.getClientRects().length > 0)

  if (!focusable.length) {
    event.preventDefault()
    dialog.value.focus()
    return
  }

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!focusable.includes(document.activeElement as HTMLElement)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
    return
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function handleSubmit() {
  emit('submit')
}
</script>

<template>
  <div
    v-if="open"
    class="modal-overlay"
    :class="overlayClass"
    @click.self="requestClose"
    @keydown="handleKeydown"
  >
    <component
      :is="as"
      ref="dialog"
      class="card"
      :class="panelClass"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-describedby="describedBy"
      tabindex="-1"
      @submit.prevent="handleSubmit"
    >
      <slot />
    </component>
  </div>
</template>
