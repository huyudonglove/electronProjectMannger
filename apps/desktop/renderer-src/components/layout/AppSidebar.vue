<script setup lang="ts">
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
  theme: 'dark' | 'light'
  activeThemeIcon: string
  disabled: boolean
  icon: (name: string) => string
}>()

const emit = defineEmits<{
  selectSection: [key: string]
  toggleTheme: []
}>()
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <span class="mark">E</span>
      <div>
        <strong>Electron Manager</strong>
        <small>Project Collaboration</small>
      </div>
    </div>

    <nav class="navigation-groups">
      <div v-for="group in props.navigationGroups" :key="group.label" class="navigation-group">
        <span class="navigation-group-label">{{ group.label }}</span>
        <a
          v-for="[key, label, iconName] in group.items"
          :key="key"
          :href="`#${key}`"
          :class="{ active: props.activeSection === key }"
          @click.prevent="emit('selectSection', key)"
        >
          <span class="nav-icon" v-html="props.icon(iconName)" />
          <span>{{ label }}</span>
          <span v-if="key === 'collaboration' && props.collabAttentionCount" class="nav-count">{{ props.collabAttentionCount }}</span>
        </a>
      </div>
    </nav>

    <div class="sidebar-footer">
      <a
        class="sidebar-knowledge-link"
        :href="`#${props.knowledgeItem[0]}`"
        :class="{ active: props.activeSection === props.knowledgeItem[0] }"
        @click.prevent="emit('selectSection', props.knowledgeItem[0])"
      >
        <span class="nav-icon" v-html="props.icon(props.knowledgeItem[2])" />
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
        <span class="theme-toggle-icon" v-html="props.icon(props.activeThemeIcon)" />
        <span class="theme-toggle-label">{{ props.theme === 'dark' ? '暗色' : '亮色' }}</span>
      </button>
    </div>
  </aside>
</template>
