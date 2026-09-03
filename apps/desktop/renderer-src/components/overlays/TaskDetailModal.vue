<script setup lang="ts">
import {
  formatTime,
  priorityIcon,
  priorityTone,
  workLevelIcon,
  workLevelLabelWithReason,
} from '../../utils/record-presentation'
import TaskDetailContent, { type TaskDetailRecord } from '../details/TaskDetailContent.vue'
import DialogHeader from '../ui/DialogHeader.vue'
import UiStatusTag from '../ui/UiStatusTag.vue'
import UiTag from '../ui/UiTag.vue'
import ModalLayer from './ModalLayer.vue'

defineProps<{
  task: TaskDetailRecord | null
}>()

defineEmits<{
  close: []
}>()

</script>

<template>
  <ModalLayer
    :open="Boolean(task)"
    title-id="taskDetailTitle"
    panel-class="task-detail-dialog"
    @close="$emit('close')"
  >
    <template v-if="task">
      <DialogHeader
        title-id="taskDetailTitle"
        :title="task.title || '未命名任务'"
        :subtitle="task.updated ? `更新于 ${formatTime(task.updated)}` : ''"
        initial-focus
        @close="$emit('close')"
      >
        <template #badges>
          <div class="task-detail-badges">
            <span v-if="task.shortId" class="task-short-id">{{ task.shortId }}</span>
            <UiTag :label="task.priority || 'medium'" :tone="priorityTone(task.priority)" :icon-name="priorityIcon(task.priority)" />
            <UiTag :label="workLevelLabelWithReason(task.workLevel, task.depthReason)" :icon-name="workLevelIcon(task.workLevel)" />
            <UiStatusTag :status="task.status" />
          </div>
        </template>
      </DialogHeader>
      <TaskDetailContent :task="task" />
    </template>
  </ModalLayer>
</template>
