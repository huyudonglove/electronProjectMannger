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
