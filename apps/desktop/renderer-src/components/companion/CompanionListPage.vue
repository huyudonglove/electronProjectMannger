<script setup lang="ts">
import UiEmptyState from '../ui/UiEmptyState.vue'
import UiIcon from '../ui/UiIcon.vue'
import UiStatusTag from '../ui/UiStatusTag.vue'
import type { CompanionPage, CompanionRecordKind } from '../../composables/useCompanionNavigation'
import { formatTime } from '../../utils/record-presentation'
import type { AnyRecord } from './types'

const props = defineProps<{
  page: Exclude<CompanionPage, 'home'>
  tasks: AnyRecord[]
  attentionItems: AnyRecord[]
  logs: AnyRecord[]
}>()

const emit = defineEmits<{
  openRecord: [kind: CompanionRecordKind, record: AnyRecord]
}>()

function attentionKind(item: AnyRecord): CompanionRecordKind {
  return item.companionTargetKind || (item.status === 'decided' ? 'decision' : 'question')
}
</script>

<template>
  <div v-if="props.page === 'tasks'" class="companion-content companion-list-page">
    <div v-if="props.tasks.length" class="companion-section companion-list">
      <button v-for="task in props.tasks" :key="task.id" class="companion-row" type="button" @click="emit('openRecord', 'task', task)">
        <span class="companion-row-main"><small>{{ task.shortId }}</small><strong>{{ task.title }}</strong></span>
        <UiStatusTag :status="task.status" />
      </button>
    </div>
    <UiEmptyState v-else message="暂无任务" compact />
  </div>

  <div v-else-if="props.page === 'collaboration'" class="companion-content companion-list-page">
    <div v-if="props.attentionItems.length" class="companion-section companion-list">
      <button v-for="item in props.attentionItems" :key="item.id" class="companion-row" type="button" @click="emit('openRecord', attentionKind(item), item)">
        <span class="companion-row-main"><small>{{ item.shortId }} · {{ item.companionKind }}</small><strong>{{ item.title }}</strong></span>
        <UiIcon name="chevronRight" />
      </button>
    </div>
    <UiEmptyState v-else message="暂无待处理协作" compact />
  </div>

  <div v-else class="companion-content companion-list-page">
    <div v-if="props.logs.length" class="companion-section companion-list">
      <button v-for="log in props.logs" :key="log.id || log.shortId" class="companion-log-row" type="button" @click="emit('openRecord', 'log', log)">
        <span><small>{{ log.shortId }} · {{ formatTime(log.created) }}</small><strong>{{ log.title }}</strong></span>
        <p v-if="log.result || log.userGoal">{{ log.result || log.userGoal }}</p>
      </button>
    </div>
    <UiEmptyState v-else message="暂无工作记录" compact />
  </div>
</template>
