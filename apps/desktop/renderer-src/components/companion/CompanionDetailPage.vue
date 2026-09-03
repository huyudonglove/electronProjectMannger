<script setup lang="ts">
import { computed } from 'vue'
import CollaborationRecordDetail, { type CollaborationRecordMode } from '../details/CollaborationRecordDetail.vue'
import TaskDetailContent from '../details/TaskDetailContent.vue'
import ThoughtDetailContent from '../details/ThoughtDetailContent.vue'
import WorkLogDetail from '../details/WorkLogDetail.vue'
import UiIcon from '../ui/UiIcon.vue'
import UiStatusTag from '../ui/UiStatusTag.vue'
import type { CompanionRecordKind } from '../../composables/useCompanionNavigation'
import { thoughtDisplayTitle } from '../../utils/record-formatters'
import { formatTime } from '../../utils/record-presentation'
import type { AnyRecord } from './types'

const props = defineProps<{
  kind: CompanionRecordKind | null
  record: AnyRecord
  tasks: AnyRecord[]
  busy: boolean
}>()

const emit = defineEmits<{
  updateTaskStatus: [task: AnyRecord, status: 'doing' | 'done']
  openQuestionTarget: [item: AnyRecord]
  reply: [item: AnyRecord]
  completeQuestion: [item: AnyRecord]
  resolveRisk: [item: AnyRecord]
}>()

const collaborationMode = computed<CollaborationRecordMode>(() => props.kind === 'risk'
  ? 'risks'
  : props.kind === 'decision'
    ? 'decided'
    : 'open')

function nextTaskStatus(task: AnyRecord): 'doing' | 'done' | null {
  if (task.status === 'todo') return 'doing'
  if (task.status === 'doing') return 'done'
  return null
}
</script>

<template>
  <div class="companion-content companion-detail-page">
    <template v-if="props.kind === 'task'">
      <section class="companion-detail-heading">
        <div><span class="task-short-id">{{ props.record.shortId }}</span><UiStatusTag :status="props.record.status" /></div>
        <h2>{{ props.record.title }}</h2>
        <button v-if="nextTaskStatus(props.record)" class="btn btn-primary btn-sm" type="button" :disabled="props.busy" @click="emit('updateTaskStatus', props.record, nextTaskStatus(props.record)!)">
          <UiIcon :name="props.record.status === 'todo' ? 'play' : 'circleCheck'" />
          {{ props.record.status === 'todo' ? '开始任务' : '完成任务' }}
        </button>
      </section>
      <TaskDetailContent :task="props.record" />
    </template>

    <template v-else-if="props.kind === 'thought'">
      <section class="companion-detail-heading">
        <div><span class="task-short-id">{{ props.record.shortId }}</span></div>
        <h2 v-if="thoughtDisplayTitle(props.record)">{{ thoughtDisplayTitle(props.record) }}</h2>
        <small v-if="props.record.created">{{ formatTime(props.record.created) }}</small>
      </section>
      <ThoughtDetailContent :thought="props.record" />
    </template>

    <CollaborationRecordDetail
      v-else-if="['question', 'decision', 'risk'].includes(props.kind || '')"
      :item="props.record"
      :mode="collaborationMode"
      @open-question-target="emit('openQuestionTarget', $event)"
      @open-reply-dialog="emit('reply', $event)"
      @complete-question="emit('completeQuestion', $event)"
      @resolve-risk="emit('resolveRisk', $event)"
    />

    <WorkLogDetail v-else-if="props.kind === 'log'" :log="props.record" :tasks="props.tasks" />
  </div>
</template>
