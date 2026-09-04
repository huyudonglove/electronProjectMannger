<script setup lang="ts">
import { hasThoughtAnswer } from '../../utils/record-formatters'
import { renderTextBlock } from '../../utils/markdown'

defineProps<{
  thought: Record<string, any>
}>()
</script>

<template>
  <div class="task-detail-body">
    <section v-if="thought.content">
      <strong>内容</strong>
      <div v-html="renderTextBlock(thought.content)" />
    </section>
    <section v-if="hasThoughtAnswer(thought.answer)">
      <strong>处理说明</strong>
      <div v-html="renderTextBlock(thought.answer)" />
    </section>
  </div>
</template>
