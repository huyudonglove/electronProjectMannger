<script setup lang="ts">
import UiEmptyState from '../ui/UiEmptyState.vue'
import UiIconButton from '../ui/UiIconButton.vue'
import UiStatusTag from '../ui/UiStatusTag.vue'
import { formatTime } from '../../utils/record-presentation'
import { thoughtDisplayTitle } from '../../utils/record-formatters'

type ThoughtItem = Record<string, any>

defineProps<{
  thoughts: ThoughtItem[]
  highlightedThought: string
  setThoughtRef: (thoughtId: string, element: Element | null) => void
}>()

const emit = defineEmits<{
  deleteThought: [thoughtId: string]
}>()

</script>

<template>
  <section id="capture" class="section view active-view">
    <div class="thoughts">
      <UiEmptyState v-if="!thoughts.length" message="暂无想法" compact />
      <article
        v-for="thought in thoughts"
        :key="thought.id || thought.shortId"
        :ref="(element) => setThoughtRef(thought.id || thought.shortId || '', element as Element | null)"
        class="card thought"
        :class="{ 'thought-highlight': highlightedThought === (thought.id || thought.shortId) }"
      >
        <div class="thought-header">
          <div class="thought-title">
            <div class="thought-title-row">
              <span v-if="thought.shortId" class="thought-short-id">{{ thought.shortId }}</span>
              <strong v-if="thoughtDisplayTitle(thought)">{{ thoughtDisplayTitle(thought) }}</strong>
              <UiStatusTag :status="thought.status" />
            </div>
          </div>
          <UiIconButton class="delete-action" icon="trash" label="删除输入" size="sm" @click="emit('deleteThought', thought.id)" />
        </div>
        <p>{{ thought.content }}</p>
        <div v-if="thought.answer" class="answer"><span>摘要</span><p>{{ thought.answer }}</p></div>
        <small v-if="formatTime(thought.created)">{{ formatTime(thought.created) }}</small>
      </article>
    </div>
  </section>
</template>
