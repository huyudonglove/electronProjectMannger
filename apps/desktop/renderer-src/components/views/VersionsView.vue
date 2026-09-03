<script setup lang="ts">
import UiIconButton from '../ui/UiIconButton.vue'
import UiSelect from '../ui/UiSelect.vue'
import UiTag from '../ui/UiTag.vue'

type VersionItem = Record<string, any>
type RecordItem = Record<string, any>
type SelectOption = { label: string; value: string; disabled?: boolean }

defineProps<{
  versions: VersionItem[]
  selectedVersionId: string
  allTasks: RecordItem[]
  allThoughts: RecordItem[]
  allLogs: RecordItem[]
  questions: RecordItem[]
  versionStatusOptions: SelectOption[]
  busy: boolean
}>()

const emit = defineEmits<{
  openVersionDialog: []
  changeVersionStatus: [version: VersionItem, status: string]
}>()

function versionRecordCount(versionId: string, records: RecordItem[]) {
  return records.filter((item) => item.version === versionId).length
}
</script>

<template>
  <section id="versions" class="section view active-view">
    <div class="page-toolbar version-page-toolbar">
      <UiIconButton icon="plus" label="新版本" variant="primary" size="sm" @click="emit('openVersionDialog')" />
    </div>
    <div class="version-list-surface">
      <article v-for="version in versions" :key="version.shortId" class="version-row" :class="[`is-${version.status || 'planned'}`, { 'is-selected': version.shortId === selectedVersionId }]">
        <span class="version-rail" aria-hidden="true"><span></span></span>
        <div class="version-row-main">
          <div class="version-row-title">
            <span class="task-short-id">{{ version.shortId }}</span>
            <UiTag :label="version.label" icon-name="tag" />
            <strong>{{ version.title }}</strong>
            <span v-if="version.shortId === selectedVersionId" class="version-current-label">当前查看</span>
          </div>
          <p>{{ version.goal }}</p>
          <small v-if="version.summary">{{ version.summary }}</small>
        </div>
        <div class="version-metrics">
          <span><strong>{{ versionRecordCount(version.shortId, allTasks) }}</strong><small>任务</small></span>
          <span><strong>{{ versionRecordCount(version.shortId, allThoughts) }}</strong><small>想法</small></span>
          <span><strong>{{ versionRecordCount(version.shortId, allLogs) }}</strong><small>记录</small></span>
          <span><strong>{{ versionRecordCount(version.shortId, questions) }}</strong><small>问题</small></span>
        </div>
        <div class="version-status-control" :class="`is-${version.status || 'planned'}`">
          <UiSelect
            :model-value="version.status || 'planned'"
            :options="versionStatusOptions"
            :disabled="busy"
            :aria-label="`${version.label} 状态`"
            compact
            @update:model-value="emit('changeVersionStatus', version, $event)"
          />
        </div>
      </article>
    </div>
  </section>
</template>
