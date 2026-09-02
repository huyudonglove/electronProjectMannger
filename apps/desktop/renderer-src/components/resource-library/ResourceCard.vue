<script setup lang="ts">
import type { ResourceViewItem } from '../../composables/resource-library/types'
import UiIcon from '../ui/UiIcon.vue'
import UiIconButton from '../ui/UiIconButton.vue'

const props = withDefaults(defineProps<{
  item: ResourceViewItem
  icon: string
  deleteLabel?: string
}>(), {
  deleteLabel: '',
})

const emit = defineEmits<{
  open: [item: ResourceViewItem]
  delete: [item: ResourceViewItem]
}>()
</script>

<template>
  <article
    class="library-card library-card-frame"
  >
    <button class="library-card-main" type="button" @click="emit('open', props.item)">
      <span class="library-card-icon"><UiIcon :name="props.icon" /></span>
      <span class="library-card-kicker">
        <span>{{ props.item.shortId }}</span>
        <span>{{ props.item.rowMeta }}</span>
      </span>
      <strong>{{ props.item.title }}</strong>
      <small v-if="props.item.summary">{{ props.item.summary }}</small>
      <span v-if="props.item.detailMeta || props.item.origin" class="library-card-origin">
        {{ props.item.detailMeta || props.item.origin }}
      </span>
    </button>
    <UiIconButton
      v-if="props.deleteLabel && props.item.deletable !== false"
      class="library-card-delete"
      icon="trash"
      size="sm"
      :label="props.deleteLabel"
      @click="emit('delete', props.item)"
    />
  </article>
</template>
