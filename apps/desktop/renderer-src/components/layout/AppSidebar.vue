<script setup lang="ts">
import BrandMark from '../ui/BrandMark.vue'
import UiIcon from '../ui/UiIcon.vue'

type NavItem = readonly [string, string, string]
type NavGroup = {
  label: string
  items: readonly NavItem[]
}

const props = defineProps<{
  navigationGroups: readonly NavGroup[]
  knowledgeItem: NavItem
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
  enterCompanionMode: []
}>()
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <BrandMark />
      <strong>Telance Records</strong>
    </div>

    <button class="project-switcher" type="button" :disabled="props.disabled" @click="emit('openProjects')">
      <span class="project-switcher-mark"><UiIcon name="folderOpen" /></span>
      <span class="project-switcher-copy">
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
        class="theme-toggle sidebar-companion-toggle"
        type="button"
        title="切换到陪伴模式"
        :disabled="props.disabled"
        @click="emit('enterCompanionMode')"
      >
        <UiIcon class="theme-toggle-icon" name="minimize" />
        <span class="theme-toggle-label">陪伴模式</span>
      </button>
      <a
        class="sidebar-knowledge-link"
        :href="`#${props.knowledgeItem[0]}`"
        :class="{ active: props.activeSection === props.knowledgeItem[0] }"
        :aria-current="props.activeSection === props.knowledgeItem[0] ? 'page' : undefined"
        :title="props.knowledgeItem[1]"
        @click.prevent="emit('selectSection', props.knowledgeItem[0])"
      >
        <UiIcon class="nav-icon" :name="props.knowledgeItem[2]" />
        <span>{{ props.knowledgeItem[1] }}</span>
      </a>
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
