<script setup lang="ts">
import { computed } from 'vue'
import UiEmptyState from '../ui/UiEmptyState.vue'
import UiIcon from '../ui/UiIcon.vue'
import UiIconButton from '../ui/UiIconButton.vue'

type ResourceKind = 'knowledge' | 'document' | 'constraint'
type ResourceRecord = Record<string, any>

type ResourceViewItem = {
  key: string
  record: ResourceRecord
  shortId?: string
  title: string
  summary?: string
  rowMeta?: string
  origin?: string
  folder?: string
  detailKicker?: string
  detailMeta?: string
  contentHtml?: string
  deletable?: boolean
}

type ResourceGroup = {
  key: string
  label: string
  items: ResourceViewItem[]
  showHeader: boolean
}

const props = withDefaults(defineProps<{
  kind: ResourceKind
  query?: string
  items: ResourceViewItem[]
  systemItems?: ResourceViewItem[]
  selectedKey?: string
  totalCount?: number
}>(), {
  query: '',
  systemItems: () => [],
  selectedKey: '',
  totalCount: undefined,
})

const emit = defineEmits<{
  'update:query': [value: string]
  select: [item: ResourceViewItem]
  delete: [item: ResourceViewItem]
}>()

const copy = computed(() => ({
  knowledge: {
    searchPlaceholder: '搜索知识',
    searchLabel: '搜索知识',
    emptyIcon: 'bookOpen',
    empty: '暂无知识条目',
    emptySearch: '没有匹配的知识',
    detailEmpty: '选择一条知识查看详情。',
    deleteLabel: '删除知识',
  },
  document: {
    searchPlaceholder: '搜索文档',
    searchLabel: '搜索文档',
    emptyIcon: 'fileText',
    empty: '暂无文档',
    emptySearch: '没有匹配的文档',
    detailEmpty: '选择一份文档查看详情。',
    deleteLabel: '删除文档',
  },
  constraint: {
    searchPlaceholder: '搜索约束',
    searchLabel: '搜索约束',
    emptyIcon: 'shield',
    empty: '暂无项目约束。',
    emptySearch: '没有匹配的项目约束。',
    detailEmpty: '选择一条约束查看详情。',
    deleteLabel: '删除约束',
  },
})[props.kind])

const countText = computed(() => {
  if (props.kind === 'constraint') {
    return `${props.items.length} 项目约束 · ${props.systemItems.length} 系统规则`
  }
  return `${props.items.length} / ${props.totalCount ?? props.items.length} 条`
})

const primaryGroups = computed<ResourceGroup[]>(() => {
  if (props.kind === 'constraint') {
    return [{ key: 'project-constraints', label: '项目约束', items: props.items, showHeader: true }]
  }
  if (props.kind !== 'document') {
    return [{ key: props.kind, label: '', items: props.items, showHeader: false }]
  }

  const groups = new Map<string, ResourceViewItem[]>()
  props.items.forEach((item) => {
    const folder = item.folder || '根目录'
    const group = groups.get(folder) || []
    group.push(item)
    groups.set(folder, group)
  })
  return [...groups.entries()].map(([folder, items]) => ({
    key: folder,
    label: folder,
    items,
    showHeader: true,
  }))
})

const selectedItem = computed(() => {
  const allItems = [...props.items, ...props.systemItems]
  return allItems.find((item) => item.key === props.selectedKey) || allItems[0] || null
})

function updateQuery(event: Event) {
  emit('update:query', (event.target as HTMLInputElement).value)
}

function isSelected(item: ResourceViewItem) {
  return selectedItem.value?.key === item.key
}

function itemKicker(item: ResourceViewItem) {
  return item.detailKicker || [item.shortId, item.rowMeta].filter(Boolean).join(' · ')
}
</script>

<template>
  <section :id="props.kind === 'document' ? 'documents' : props.kind" class="section view active-view">
    <div class="page-toolbar resource-page-toolbar">
      <label class="resource-search">
        <UiIcon name="search" />
        <input
          :value="props.query"
          type="search"
          :placeholder="copy.searchPlaceholder"
          :aria-label="copy.searchLabel"
          @input="updateQuery"
        />
      </label>
      <span>{{ countText }}</span>
    </div>

    <div class="resource-workspace">
      <aside class="resource-index">
        <div class="resource-index-list">
          <UiEmptyState
            v-if="props.kind !== 'constraint' && !props.items.length"
            :icon="copy.emptyIcon"
            :message="props.query ? copy.emptySearch : copy.empty"
          />

          <section v-for="group in primaryGroups" :key="group.key" class="resource-index-group">
            <div v-if="group.showHeader" class="resource-index-group-head">
              <strong>{{ group.label }}</strong>
              <span>{{ group.items.length }}</span>
            </div>
            <UiEmptyState
              v-if="props.kind === 'constraint' && !group.items.length"
              class="resource-index-empty"
              :message="props.query ? copy.emptySearch : copy.empty"
              compact
            />
            <article
              v-for="item in group.items"
              :key="item.key"
              class="resource-row"
              :class="{ active: isSelected(item) }"
            >
              <button
                class="resource-row-main"
                type="button"
                :aria-current="isSelected(item) ? 'true' : undefined"
                @click="emit('select', item)"
              >
                <span class="resource-row-meta">
                  <span v-if="item.shortId" class="task-short-id">{{ item.shortId }}</span>
                  <span v-if="item.rowMeta">{{ item.rowMeta }}</span>
                </span>
                <strong>{{ item.title }}</strong>
                <small v-if="item.summary">{{ item.summary }}</small>
                <span v-if="item.origin" class="resource-row-origin">{{ item.origin }}</span>
              </button>
              <UiIconButton
                v-if="item.deletable !== false"
                class="resource-row-delete delete-action"
                icon="trash"
                size="sm"
                :label="copy.deleteLabel"
                @click="emit('delete', item)"
              />
            </article>
          </section>

          <details v-if="props.kind === 'constraint'" class="resource-system-group">
            <summary class="resource-index-group-head">
              <strong>系统规则</strong>
              <span>{{ props.systemItems.length }} · 只读</span>
            </summary>
            <div class="resource-system-list">
              <article
                v-for="item in props.systemItems"
                :key="item.key"
                class="resource-row system-resource-row"
                :class="{ active: isSelected(item) }"
              >
                <button
                  class="resource-row-main"
                  type="button"
                  :aria-current="isSelected(item) ? 'true' : undefined"
                  @click="emit('select', item)"
                >
                  <span class="resource-row-meta">
                    <span v-if="item.shortId" class="task-short-id">{{ item.shortId }}</span>
                    <span>{{ item.rowMeta || '只读' }}</span>
                  </span>
                  <strong>{{ item.title }}</strong>
                  <small v-if="item.summary">{{ item.summary }}</small>
                </button>
              </article>
            </div>
          </details>
        </div>
      </aside>

      <article v-if="selectedItem" class="resource-detail">
        <div class="resource-detail-head">
          <div>
            <span v-if="itemKicker(selectedItem)" class="resource-detail-kicker">{{ itemKicker(selectedItem) }}</span>
            <h2>{{ selectedItem.title }}</h2>
            <p v-if="selectedItem.detailMeta">{{ selectedItem.detailMeta }}</p>
          </div>
        </div>
        <div class="resource-detail-body rendered-markdown" v-html="selectedItem.contentHtml || ''" />
      </article>
      <UiEmptyState v-else class="resource-detail-empty" :message="copy.detailEmpty" compact />
    </div>
  </section>
</template>
