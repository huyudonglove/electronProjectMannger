<script setup lang="ts">
import { ref } from 'vue'
import ModalLayer from '../overlays/ModalLayer.vue'
import UiIcon from '../ui/UiIcon.vue'
import UiIconButton from '../ui/UiIconButton.vue'
import UiTag from '../ui/UiTag.vue'
import type { AnyRecord } from './types'

const props = defineProps<{
  versions: AnyRecord[]
  currentVersion: AnyRecord | null
  selectedVersionId: string
  busy: boolean
}>()

const emit = defineEmits<{
  select: [versionId: string]
}>()

const open = ref(false)

function versionStatusText(status: string) {
  return ({ planned: '规划中', active: '进行中', paused: '已暂停', completed: '已完成' } as Record<string, string>)[status] || status
}

function statusTone(status: string): 'warning' | 'complete' | 'neutral' {
  if (status === 'active') return 'warning'
  if (status === 'completed') return 'complete'
  return 'neutral'
}

function show() {
  if (props.busy || props.versions.length < 2) return
  open.value = true
}

function close() {
  open.value = false
}

function select(versionId: string) {
  emit('select', versionId)
  close()
}

function handleOptionsKeydown(event: KeyboardEvent) {
  const options = [...(event.currentTarget as HTMLElement)
    .querySelectorAll<HTMLButtonElement>('.companion-version-option')]
  if (!options.length) return
  const currentIndex = Math.max(options.indexOf(document.activeElement as HTMLButtonElement), 0)
  let nextIndex = currentIndex
  if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % options.length
  else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + options.length) % options.length
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = options.length - 1
  else return
  event.preventDefault()
  options[nextIndex]?.focus({ preventScroll: true })
}
</script>

<template>
  <button
    class="companion-version-trigger"
    type="button"
    :disabled="props.busy || props.versions.length < 2"
    :title="props.versions.length < 2 ? '当前只有一个版本' : '切换版本'"
    aria-haspopup="dialog"
    :aria-expanded="open"
    @click="show"
  >
    <span>
      <small>当前版本 · {{ props.currentVersion?.shortId || '—' }}</small>
      <strong>{{ props.currentVersion?.label || props.currentVersion?.title || '暂无版本' }}</strong>
    </span>
    <UiIcon v-if="props.versions.length > 1" name="chevronDown" />
  </button>

  <ModalLayer
    :open="open"
    title-id="companion-version-dialog-title"
    overlay-class="companion-version-overlay"
    panel-class="companion-version-dialog"
    initial-focus-selector=".companion-version-option.active, .companion-version-option"
    @close="close"
  >
    <header>
      <div>
        <strong id="companion-version-dialog-title">切换版本</strong>
        <small>{{ props.versions.length }} 个版本</small>
      </div>
      <UiIconButton icon="x" label="关闭" variant="ghost" size="sm" @click="close" />
    </header>
    <div class="companion-version-options" role="listbox" aria-label="版本" @keydown="handleOptionsKeydown">
      <button
        v-for="version in props.versions"
        :key="version.shortId"
        class="companion-version-option"
        :class="{ active: props.selectedVersionId === version.shortId }"
        type="button"
        role="option"
        :aria-selected="props.selectedVersionId === version.shortId"
        @click="select(version.shortId)"
      >
        <span>
          <strong>{{ version.shortId }} · {{ version.label }}</strong>
          <small>{{ version.title || version.goal || '未填写说明' }}</small>
        </span>
        <UiTag :label="versionStatusText(version.status || 'planned')" :tone="statusTone(version.status || 'planned')" variant="status" icon-name="circleDot" />
        <UiIcon v-if="props.selectedVersionId === version.shortId" name="check" />
      </button>
    </div>
  </ModalLayer>
</template>
