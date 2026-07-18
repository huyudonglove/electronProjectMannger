<script setup lang="ts">
type AnyRecord = Record<string, any>

const props = defineProps<{
  status: string
  initialized: boolean
  busy: boolean
  versions: AnyRecord[]
  selectedVersionId: string
  selectedVersion: AnyRecord | null
  versionMenuOpen: boolean
  icon: (name: string) => string
}>()

const emit = defineEmits<{
  toggleVersionMenu: []
  closeVersionMenu: [event: FocusEvent]
  selectVersion: [versionId: string]
  openProjects: []
  refresh: []
}>()
</script>

<template>
  <header class="topbar">
    <div>
      <p class="eyebrow" aria-hidden="true"></p>
      <small>{{ props.status }}</small>
    </div>
    <div class="topbar-actions">
      <div v-if="props.initialized && props.versions.length" class="version-switcher" @focusout="emit('closeVersionMenu', $event)">
        <button
          class="version-switcher-trigger"
          :class="{ 'is-open': props.versionMenuOpen }"
          type="button"
          aria-haspopup="listbox"
          :aria-expanded="props.versionMenuOpen"
          aria-label="选择版本"
          @click="emit('toggleVersionMenu')"
        >
          <span class="version-switcher-icon" v-html="props.icon('layers')" />
          <span class="version-switcher-label">{{ props.selectedVersionId === 'all' ? '全部版本' : `${props.selectedVersion?.shortId || ''} · ${props.selectedVersion?.label || ''}` }}</span>
          <span class="version-switcher-chevron" v-html="props.icon('chevronDown')" />
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
            <span v-if="version.status === 'active'" class="version-menu-current">当前</span>
            <span v-if="props.selectedVersionId === version.shortId" class="version-menu-check" v-html="props.icon('check')" />
          </button>
          <button
            class="version-menu-item"
            :class="{ active: props.selectedVersionId === 'all' }"
            type="button"
            role="option"
            :aria-selected="props.selectedVersionId === 'all'"
            @click="emit('selectVersion', 'all')"
          >
            <span class="version-menu-copy"><strong>全部版本</strong><small>查看当前与历史记录</small></span>
            <span v-if="props.selectedVersionId === 'all'" class="version-menu-check" v-html="props.icon('check')" />
          </button>
        </div>
      </div>
      <button class="btn icon-button btn-outline-primary" type="button" title="打开项目" aria-label="打开项目" :disabled="props.busy" @click="emit('openProjects')" v-html="props.icon('history')" />
      <button class="btn icon-button btn-ghost" type="button" title="手动刷新" aria-label="手动刷新" :disabled="props.busy || !props.initialized" @click="emit('refresh')" v-html="props.icon('refresh')" />
    </div>
  </header>
</template>
