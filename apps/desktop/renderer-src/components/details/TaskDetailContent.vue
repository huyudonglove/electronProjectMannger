<script lang="ts">
export interface TaskDetailRecord {
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
</script>

<script setup lang="ts">
import { renderListTextBlock, renderTextBlock } from '../../utils/markdown'

defineProps<{
  task: TaskDetailRecord
}>()
</script>

<template>
  <div class="task-detail-body">
    <section v-if="task.userOriginal">
      <strong>用户原话</strong>
      <div v-html="renderTextBlock(task.userOriginal)" />
    </section>
    <section v-if="task.detail">
      <strong>执行定义</strong>
      <div v-html="renderTextBlock(task.detail)" />
    </section>
    <section v-if="task.acceptance">
      <strong>验收标准</strong>
      <div v-html="renderListTextBlock(task.acceptance)" />
    </section>
    <section v-if="task.workLevel === 'deep' && task.constraints">
      <strong>关键约束</strong>
      <div v-html="renderTextBlock(task.constraints)" />
    </section>
    <section v-if="task.workLevel === 'deep' && task.planRollback">
      <strong>方案与回退</strong>
      <div v-html="renderTextBlock(task.planRollback)" />
    </section>
  </div>
</template>
