<script setup lang="ts">
import { computed } from 'vue'
import type { ResourceViewItem } from '../../composables/resource-library/types'
import ResourceCard from '../resource-library/ResourceCard.vue'
import UiEmptyState from '../ui/UiEmptyState.vue'
import UiSearchField from '../ui/UiSearchField.vue'

const props = withDefaults(defineProps<{
  query?: string
  items: ResourceViewItem[]
  totalCount?: number
}>(), {
  query: '',
  totalCount: undefined,
})

const emit = defineEmits<{
  'update:query': [value: string]
  open: [item: ResourceViewItem]
  delete: [item: ResourceViewItem]
}>()

const countText = computed(() => `${props.items.length} / ${props.totalCount ?? props.items.length}`)
</script>

<template>
  <section id="knowledge" class="section view active-view">
    <div class="page-toolbar resource-page-toolbar">
      <UiSearchField
        :model-value="props.query"
        class="resource-search"
        placeholder="搜索知识"
        aria-label="搜索知识"
        @update:model-value="emit('update:query', $event)"
      />
      <span v-if="props.query.trim()">{{ countText }}</span>
    </div>

    <div class="library-shelf">
      <UiEmptyState
        v-if="!props.items.length"
        icon="bookOpen"
        :message="props.query ? '没有匹配的知识' : '暂无知识条目'"
      />
      <div v-else class="library-grid knowledge-card-grid">
        <ResourceCard
          v-for="item in props.items"
          :key="item.key"
          :item="item"
          icon="bookOpen"
          delete-label="删除知识"
          @open="emit('open', $event)"
          @delete="emit('delete', $event)"
        />
      </div>
    </div>
  </section>
</template>
