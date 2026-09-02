<script setup lang="ts">
import { renderListTextBlock, renderTextBlock } from '../../utils/markdown'
import {
  formatTime,
  priorityIcon,
  priorityTone,
  statusIcon,
  statusLabel,
  statusTone,
  workLevelIcon,
  workLevelLabel,
  workLevelLabelWithReason,
} from '../../utils/record-presentation'
import DialogHeader from '../ui/DialogHeader.vue'
import UiTag from '../ui/UiTag.vue'
import ModalLayer from './ModalLayer.vue'

interface TaskDetailRecord {
  id?: string
  shortId?: string
  title?: string
  priority?: string
  workLevel?: string
  depthReason?: string
  status?: string
  updated?: string
  userOriginal?: string
  detail?: string
  acceptance?: string
  constraints?: string
  planRollback?: string
  [key: string]: unknown
}

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
        :subtitle="task.updated ? `更新于 ${formatTime(task.updated)} · ${workLevelLabel(task.workLevel)}` : `未标注更新时间 · ${workLevelLabel(task.workLevel)}`"
        initial-focus
        @close="$emit('close')"
      >
        <template #badges>
          <div class="task-detail-badges">
            <span v-if="task.shortId" class="task-short-id">{{ task.shortId }}</span>
            <UiTag :label="task.priority || 'medium'" :tone="priorityTone(task.priority)" :icon-name="priorityIcon(task.priority)" />
            <UiTag :label="workLevelLabelWithReason(task.workLevel, task.depthReason)" :icon-name="workLevelIcon(task.workLevel)" />
            <UiTag :label="statusLabel(task.status)" :tone="statusTone(task.status)" variant="status" :icon-name="statusIcon(task.status)" />
          </div>
        </template>
      </DialogHeader>
      <div class="task-detail-body">
        <section>
          <strong>用户原话</strong>
          <div v-if="task.userOriginal" v-html="renderTextBlock(task.userOriginal)" />
          <p v-else>暂无记录</p>
        </section>
        <section>
          <strong>执行定义</strong>
          <div v-if="task.detail" v-html="renderTextBlock(task.detail)" />
          <p v-else>暂无执行定义</p>
        </section>
        <section>
          <strong>验收标准</strong>
          <div v-if="task.acceptance" v-html="renderListTextBlock(task.acceptance)" />
          <p v-else>暂无验收标准</p>
        </section>
        <section v-if="task.workLevel === 'deep'">
          <strong>关键约束</strong>
          <div v-if="task.constraints" v-html="renderTextBlock(task.constraints)" />
          <p v-else>暂无关键约束</p>
        </section>
        <section v-if="task.workLevel === 'deep'">
          <strong>方案与回退</strong>
          <div v-if="task.planRollback" v-html="renderTextBlock(task.planRollback)" />
          <p v-else>暂无方案与回退</p>
        </section>
      </div>
    </template>
  </ModalLayer>
</template>
