<script setup lang="ts">
import UiIcon from '../ui/UiIcon.vue'

type NavItem = readonly [string, string, string]
type NavGroup = {
  label: string
  items: readonly NavItem[]
}

const props = defineProps<{
  navigationGroups: readonly NavGroup[]
  activeSection: string
  collabAttentionCount: number
  projectName: string
  initialized: boolean
  theme: 'dark' | 'light'
  activeThemeIcon: string
  disabled: boolean
}>()

const emit = defineEmits<{
  selectSection: [key: string]
  openProjects: []
  toggleTheme: []
}>()
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <span class="mark">T</span>
      <strong>Telance Records</strong>
    </div>

    <button class="project-switcher" type="button" :disabled="props.disabled" @click="emit('openProjects')">
      <span class="project-switcher-mark"><UiIcon name="folderOpen" /></span>
      <span class="project-switcher-copy">
        <small>当前项目</small>
        <strong>{{ props.projectName || '选择项目' }}</strong>
      </span>
      <span v-if="props.initialized" class="project-switcher-status" title="项目已就绪"></span>
      <UiIcon v-else class="project-switcher-chevron" name="chevronDown" />
    </button>

    <nav class="navigation-groups">
      <div v-for="group in props.navigationGroups" :key="group.label" class="navigation-group">
        <span class="navigation-group-label">{{ group.label }}</span>
        <a
          v-for="[key, label, iconName] in group.items"
          :key="key"
          :href="`#${key}`"
          :class="{ active: props.activeSection === key }"
          :aria-current="props.activeSection === key ? 'page' : undefined"
          :title="label"
          @click.prevent="emit('selectSection', key)"
        >
          <UiIcon class="nav-icon" :name="iconName" />
          <span>{{ label }}</span>
          <span v-if="key === 'collaboration' && props.collabAttentionCount" class="nav-count">{{ props.collabAttentionCount }}</span>
        </a>
      </div>
    </nav>

    <div class="sidebar-footer">
      <button
        class="theme-toggle"
        type="button"
        :aria-pressed="props.theme === 'dark'"
        :title="props.theme === 'dark' ? '切换亮色模式' : '切换暗色模式'"
        :disabled="props.disabled"
        @click="emit('toggleTheme')"
      >
        <UiIcon class="theme-toggle-icon" :name="props.activeThemeIcon" />
        <span class="theme-toggle-label">{{ props.theme === 'dark' ? '暗色' : '亮色' }}</span>
      </button>
    </div>
  </aside>
</template>
