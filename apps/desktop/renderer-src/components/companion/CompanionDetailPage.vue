<script setup lang="ts">
import { computed } from 'vue'
import CollaborationRecordDetail, { type CollaborationRecordMode } from '../details/CollaborationRecordDetail.vue'
import TaskDetailContent from '../details/TaskDetailContent.vue'
import ThoughtDetailContent from '../details/ThoughtDetailContent.vue'
import ResearchDetailContent from '../details/ResearchDetailContent.vue'
import WorkLogDetail from '../details/WorkLogDetail.vue'
import UiIcon from '../ui/UiIcon.vue'
import UiStatusTag from '../ui/UiStatusTag.vue'
import type { CompanionRecordKind } from '../../composables/useCompanionNavigation'
import { dialogueDisplayTitle, thoughtDisplayTitle } from '../../utils/record-formatters'
import { formatTime } from '../../utils/record-presentation'
import type { AnyRecord } from './types'

const props = defineProps<{
  kind: CompanionRecordKind | null
  record: AnyRecord
  tasks: AnyRecord[]
  busy: boolean
}>()

const emit = defineEmits<{
  updateTaskStatus: [task: AnyRecord, status: 'todo' | 'doing' | 'done']
  resolveThought: [thought: AnyRecord]
  reopenThought: [thought: AnyRecord]
  updateDialogueStatus: [dialogue: AnyRecord, status: 'pending' | 'doing' | 'done' | 'archived']
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

function nextTaskStatus(task: AnyRecord): 'todo' | 'doing' | 'done' | null {
  if (task.status === 'backlog') return 'todo'
  if (task.status === 'todo') return 'doing'
  if (task.status === 'doing') return 'done'
  return null
}

function taskActionLabel(status: string) {
  if (status === 'backlog') return '移入待处理'
  if (status === 'todo') return '开始任务'
  return '完成任务'
}

function nextDialogueStatus(status: string): 'pending' | 'doing' | 'done' | null {
  if (status === 'pending') return 'doing'
  if (status === 'doing') return 'done'
  if (status === 'done') return 'doing'
  if (status === 'archived') return 'pending'
  return null
}

function dialogueActionLabel(status: string) {
  if (status === 'pending') return '开始研究'
  if (status === 'doing') return '完成研究'
  if (status === 'done') return '继续研究'
  return '恢复研究'
}
</script>

<template>
  <div class="companion-content companion-detail-page">
    <template v-if="props.kind === 'task'">
      <section class="companion-detail-heading">
        <div><span class="task-short-id">{{ props.record.shortId }}</span><UiStatusTag :status="props.record.status" /></div>
        <h2>{{ props.record.title }}</h2>
        <button v-if="nextTaskStatus(props.record)" class="btn btn-primary btn-sm" type="button" :disabled="props.busy" @click="emit('updateTaskStatus', props.record, nextTaskStatus(props.record)!)">
          <UiIcon :name="props.record.status === 'doing' ? 'circleCheck' : 'play'" />
          {{ taskActionLabel(props.record.status) }}
        </button>
      </section>
      <TaskDetailContent :task="props.record" />
    </template>

    <template v-else-if="props.kind === 'thought'">
      <section class="companion-detail-heading">
        <div><span class="task-short-id">{{ props.record.shortId }}</span><UiStatusTag :status="props.record.status" /></div>
        <h2 v-if="thoughtDisplayTitle(props.record)">{{ thoughtDisplayTitle(props.record) }}</h2>
        <small v-if="props.record.created">{{ formatTime(props.record.created) }}</small>
        <button
          v-if="props.record.status === 'handled'"
          class="btn btn-outline-primary btn-sm"
          type="button"
          :disabled="props.busy"
          @click="emit('reopenThought', props.record)"
        ><UiIcon name="rotateLeft" />重新打开</button>
        <button
          v-else
          class="btn btn-primary btn-sm"
          type="button"
          :disabled="props.busy"
          @click="emit('resolveThought', props.record)"
        ><UiIcon name="circleCheck" />标记已处理</button>
      </section>
      <ThoughtDetailContent :thought="props.record" />
    </template>

    <template v-else-if="props.kind === 'research'">
      <section class="companion-detail-heading">
        <div><span class="task-short-id">{{ props.record.shortId }}</span><UiStatusTag :status="props.record.status" domain="research" /></div>
        <h2>{{ dialogueDisplayTitle(props.record) }}</h2>
        <small v-if="props.record.updated || props.record.created">{{ formatTime(props.record.updated || props.record.created) }}</small>
        <button v-if="nextDialogueStatus(props.record.status)" class="btn btn-primary btn-sm" type="button" :disabled="props.busy" @click="emit('updateDialogueStatus', props.record, nextDialogueStatus(props.record.status)!)">
          <UiIcon :name="props.record.status === 'doing' ? 'circleCheck' : props.record.status === 'done' ? 'rotateLeft' : 'play'" />
          {{ dialogueActionLabel(props.record.status) }}
        </button>
      </section>
      <ResearchDetailContent :research="props.record" />
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
