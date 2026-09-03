<script setup lang="ts">
import type { ResourceViewItem } from '../../composables/resource-library/types'
import ResourceCard from '../resource-library/ResourceCard.vue'
import UiEmptyState from '../ui/UiEmptyState.vue'
import UiSearchField from '../ui/UiSearchField.vue'

const props = withDefaults(defineProps<{
  query?: string
  items: ResourceViewItem[]
  systemItems?: ResourceViewItem[]
}>(), {
  query: '',
  systemItems: () => [],
})

const emit = defineEmits<{
  'update:query': [value: string]
  open: [item: ResourceViewItem]
  delete: [item: ResourceViewItem]
}>()
</script>

<template>
  <section id="constraints" class="section view active-view">
    <div class="page-toolbar resource-page-toolbar">
      <UiSearchField
        :model-value="props.query"
        class="resource-search"
        placeholder="搜索约束"
        aria-label="搜索约束"
        @update:model-value="emit('update:query', $event)"
      />
    </div>

    <div class="constraint-shelf library-shelf">
      <section class="constraint-group">
        <div class="knowledge-group-head">
          <strong>项目约束</strong>
          <span>{{ props.items.length }} 条</span>
        </div>
        <UiEmptyState
          v-if="!props.items.length"
          icon="shield"
          :message="props.query ? '没有匹配的项目约束' : '暂无项目约束'"
        />
        <div v-else class="library-grid constraint-grid">
          <ResourceCard
            v-for="item in props.items"
            :key="item.key"
            class="constraint-card"
            :item="item"
            icon="shield"
            delete-label="删除约束"
            @open="emit('open', $event)"
            @delete="emit('delete', $event)"
          />
        </div>
      </section>

      <section class="constraint-group">
        <div class="knowledge-group-head">
          <strong>系统规则</strong>
          <span>只读 · {{ props.systemItems.length }}</span>
        </div>
        <UiEmptyState
          v-if="!props.systemItems.length"
          icon="braces"
          :message="props.query ? '没有匹配的系统规则' : '暂无系统规则'"
        />
        <div v-else class="library-grid constraint-grid system-constraint-grid">
          <ResourceCard
            v-for="item in props.systemItems"
            :key="item.key"
            class="constraint-card system-constraint-card"
            :item="item"
            icon="braces"
            @open="emit('open', $event)"
          />
        </div>
      </section>
    </div>
  </section>
</template>
