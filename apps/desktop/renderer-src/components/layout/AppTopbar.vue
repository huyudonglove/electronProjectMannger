<script setup lang="ts">
import { nextTick } from 'vue'
import UiIcon from '../ui/UiIcon.vue'
import UiIconButton from '../ui/UiIconButton.vue'

type AnyRecord = Record<string, any>

const props = defineProps<{
  status: string
  pageTitle: string
  pageDescription: string
  showVersionSwitcher: boolean
  showCreate: boolean
  createLabel: string
  createDisabledReason: string
  quickOpen: boolean
  initialized: boolean
  busy: boolean
  versions: AnyRecord[]
  selectedVersionId: string
  selectedVersion: AnyRecord | null
  versionMenuOpen: boolean
}>()

const emit = defineEmits<{
  toggleVersionMenu: []
  closeVersionMenu: [event: FocusEvent]
  selectVersion: [versionId: string]
  create: []
  refresh: []
}>()

function versionStatusText(status: string) {
  return ({ planned: '规划中', active: '进行中', paused: '已暂停', completed: '已完成' } as Record<string, string>)[status] || status
}

function toggleVersionMenu() {
  const opening = !props.versionMenuOpen
  emit('toggleVersionMenu')
  if (opening) {
    nextTick(() => {
      document.querySelector<HTMLElement>('.version-menu-item.active, .version-menu-item')?.focus({ preventScroll: true })
    })
  }
}

function handleVersionMenuKeydown(event: KeyboardEvent) {
  if (!props.versionMenuOpen) return
  const container = event.currentTarget as HTMLElement
  const items = [...container.querySelectorAll<HTMLButtonElement>('.version-menu-item')]
  if (!items.length) return
  const currentIndex = Math.max(items.indexOf(document.activeElement as HTMLButtonElement), 0)
  let nextIndex = currentIndex
  if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length
  else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = items.length - 1
  else if (event.key === 'Escape') {
    event.preventDefault()
    emit('closeVersionMenu', event as unknown as FocusEvent)
    nextTick(() => container.querySelector<HTMLButtonElement>('.version-switcher-trigger')?.focus())
    return
  } else return
  event.preventDefault()
  items[nextIndex]?.focus()
}
</script>

<template>
  <header class="topbar">
    <div class="topbar-context">
      <div class="topbar-title-row">
        <h1>{{ props.pageTitle }}</h1>
        <span v-if="props.status || props.initialized" class="sync-status" :title="props.status || '项目记录已同步'">
          <span class="sync-status-dot" :class="{ busy: props.busy, ready: props.initialized && !props.busy }"></span>
          {{ props.busy ? props.status : (props.initialized ? '已同步' : '等待项目') }}
        </span>
      </div>
      <p>{{ props.pageDescription }}</p>
    </div>
    <div class="topbar-actions">
      <div v-if="props.showVersionSwitcher && props.initialized && props.versions.length" class="version-switcher" @focusout="emit('closeVersionMenu', $event)" @keydown="handleVersionMenuKeydown">
        <button
          class="version-switcher-trigger"
          :class="{ 'is-open': props.versionMenuOpen }"
          type="button"
          aria-haspopup="listbox"
          :aria-expanded="props.versionMenuOpen"
          aria-label="选择版本"
          @click="toggleVersionMenu"
        >
          <UiIcon class="version-switcher-icon" name="layers" />
          <span class="version-switcher-label">{{ props.selectedVersionId === 'all' ? '全部版本' : `${props.selectedVersion?.shortId || ''} · ${props.selectedVersion?.label || ''}` }}</span>
          <UiIcon class="version-switcher-chevron" name="chevronDown" />
        </button>
        <div v-if="props.versionMenuOpen" class="version-menu" role="listbox" aria-label="版本">
          <button
            v-for="version in props.versions"
            :key="version.shortId"
            class="version-menu-item"
            :class="{ active: props.selectedVersionId === version.shortId }"
            type="button"
            role="option"
            :aria-selected="props.selectedVersionId === version.shortId"
            @click="emit('selectVersion', version.shortId)"
          >
            <span class="version-menu-copy"><strong>{{ version.shortId }} · {{ version.label }}</strong><small>{{ version.title }}</small></span>
            <span class="version-menu-current" :class="`is-${version.status || 'planned'}`">{{ versionStatusText(version.status || 'planned') }}</span>
            <UiIcon v-if="props.selectedVersionId === version.shortId" class="version-menu-check" name="check" />
          </button>
          <button
            class="version-menu-item"
            :class="{ active: props.selectedVersionId === 'all' }"
            type="button"
            role="option"
            :aria-selected="props.selectedVersionId === 'all'"
            @click="emit('selectVersion', 'all')"
          >
            <span class="version-menu-copy"><strong>全部版本</strong><small>仅查看，不作为新记录目标</small></span>
            <UiIcon v-if="props.selectedVersionId === 'all'" class="version-menu-check" name="check" />
          </button>
        </div>
      </div>
      <UiIconButton icon="refresh" label="手动刷新" variant="ghost" :disabled="props.busy || !props.initialized" @click="emit('refresh')" />
      <button
        v-if="props.showCreate"
        class="btn btn-primary topbar-create"
        :class="{ active: props.quickOpen }"
        type="button"
        :title="props.createDisabledReason || props.createLabel"
        :disabled="props.busy || Boolean(props.createDisabledReason)"
        :aria-expanded="props.quickOpen"
        @click="emit('create')"
      >
        <UiIcon name="plus" />
        <span>{{ props.createLabel }}</span>
        <UiIcon v-if="props.createLabel === '新建'" class="topbar-create-chevron" name="chevronDown" />
      </button>
    </div>
  </header>
</template>
