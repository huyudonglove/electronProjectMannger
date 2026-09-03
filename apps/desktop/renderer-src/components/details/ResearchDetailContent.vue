<script setup lang="ts">
import { renderTextBlock } from '../../utils/markdown'

const props = defineProps<{
  research: Record<string, any>
}>()

function hasResult(value: unknown) {
  const answer = String(value || '').trim()
  return Boolean(answer && !['待研究。', '待研究', '暂无。', '暂无'].includes(answer))
}
</script>

<template>
  <div class="task-detail-body">
    <section v-if="props.research.recordContent">
      <strong>研究内容</strong>
      <div v-html="renderTextBlock(props.research.recordContent)" />
    </section>
    <section v-if="hasResult(props.research.answer)">
      <strong>研究结果</strong>
      <div v-html="renderTextBlock(props.research.answer)" />
    </section>
    <section v-if="props.research.acceptance">
      <strong>验收标准</strong>
      <div v-html="renderTextBlock(props.research.acceptance)" />
    </section>
  </div>
</template>
