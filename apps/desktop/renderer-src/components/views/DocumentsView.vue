<script setup lang="ts">
import { computed } from 'vue'
import type { ResourceViewItem } from '../../composables/resource-library/types'
import ResourceCard from '../resource-library/ResourceCard.vue'
import UiEmptyState from '../ui/UiEmptyState.vue'
import UiSearchField from '../ui/UiSearchField.vue'

type DocumentGroup = {
  folder: string
  items: ResourceViewItem[]
}

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

const groups = computed<DocumentGroup[]>(() => {
  const grouped = new Map<string, ResourceViewItem[]>()
  props.items.forEach((item) => {
    const folder = item.folder || '根目录'
    const items = grouped.get(folder) || []
    items.push(item)
    grouped.set(folder, items)
  })
  return [...grouped.entries()].map(([folder, items]) => ({ folder, items }))
})

const countText = computed(() => `${props.items.length} / ${props.totalCount ?? props.items.length} 条`)
</script>

<template>
  <section id="documents" class="section view active-view">
    <div class="page-toolbar resource-page-toolbar">
      <UiSearchField
        :model-value="props.query"
        class="resource-search"
        placeholder="搜索文档"
        aria-label="搜索文档"
        @update:model-value="emit('update:query', $event)"
      />
      <span>{{ countText }}</span>
    </div>

    <div class="library-shelf">
      <UiEmptyState
        v-if="!props.items.length"
        class="documents-empty-state"
        icon="fileText"
        :message="props.query ? '没有匹配的文档' : '暂无文档'"
      />
      <section v-for="group in groups" :key="group.folder" class="document-group">
        <div class="knowledge-group-head">
          <strong>{{ group.folder }}</strong>
          <span>{{ group.items.length }} 条</span>
        </div>
        <div class="library-grid document-card-grid">
          <ResourceCard
            v-for="item in group.items"
            :key="item.key"
            class="document-card"
            :item="item"
            icon="fileText"
            delete-label="删除文档"
            @open="emit('open', $event)"
            @delete="emit('delete', $event)"
          />
        </div>
      </section>
    </div>
  </section>
</template>
