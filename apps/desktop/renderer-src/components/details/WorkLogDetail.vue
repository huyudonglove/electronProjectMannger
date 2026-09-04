<script lang="ts">
export type WorkLogRecord = Record<string, any>
</script>

<script setup lang="ts">
import { renderInlineMarkdown, renderListTextBlock, renderTextBlock } from '../../utils/markdown'
import {
  formatTime,
  logLevelIcon,
  logLevelLabel,
} from '../../utils/record-presentation'
import UiStatusTag from '../ui/UiStatusTag.vue'
import UiTag from '../ui/UiTag.vue'

const props = withDefaults(defineProps<{
  log: WorkLogRecord
  tasks: WorkLogRecord[]
  highlighted?: boolean
}>(), {
  highlighted: false,
})

function resolveLogTasks(log: WorkLogRecord) {
  return (log.relatedTasks || []).map((task: WorkLogRecord) => {
    const matched = props.tasks.find((item) => item.shortId === task.shortId)
    return {
      shortId: task.shortId || matched?.shortId || '',
      id: task.id || matched?.id || '',
      title: task.title || matched?.title || '',
      status: task.status || matched?.status || '',
    }
  })
}
</script>

<template>
  <article
    class="card collab-log work-log-card active"
    :data-record-level="log.recordLevel || 'light'"
    :class="{ 'collab-log-highlight': highlighted }"
  >
    <div class="collab-card-head collab-card-head--meta">
      <div>
        <div class="log-badges">
          <span v-if="log.shortId" class="task-short-id">{{ log.shortId }}</span>
          <UiStatusTag :status="log.status || 'done'" />
          <UiTag :label="logLevelLabel(log.recordLevel)" :icon-name="logLevelIcon(log.recordLevel)" />
          <UiTag v-if="log.source" :label="log.source" icon-name="tag" />
        </div>
        <h3>{{ log.title }}</h3>
        <small v-if="formatTime(log.created)">{{ formatTime(log.created) }}</small>
      </div>
      <div class="log-task-relations">
        <span v-for="task in resolveLogTasks(log)" :key="task.shortId" class="task-short-id">{{ task.shortId }}</span>
      </div>
    </div>
    <section v-if="log.userGoal" class="user-goal"><strong>用户目标</strong><div v-html="renderTextBlock(log.userGoal)" /></section>
    <section v-if="log.result"><strong>结果</strong><div v-html="renderListTextBlock(log.result)" /></section>
    <section v-if="log.recordLevel === 'deep' && log.decisions?.length"><strong>关键判断</strong><ul><li v-for="item in log.decisions" :key="item" v-html="renderInlineMarkdown(item)" /></ul></section>
    <template v-for="[title, items] in [['修改文件', log.changedFiles], ['验证', log.verification]]" :key="title">
      <section v-if="items && items.length">
        <strong>{{ title }}</strong>
        <ul><li v-for="item in items" :key="item" v-html="renderInlineMarkdown(item)" /></ul>
      </section>
    </template>
  </article>
</template>
