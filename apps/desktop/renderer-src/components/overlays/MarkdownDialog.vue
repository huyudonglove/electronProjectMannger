<script setup lang="ts">
import UiIcon from '../ui/UiIcon.vue'
import UiTag from '../ui/UiTag.vue'
import ModalLayer from './ModalLayer.vue'

withDefaults(defineProps<{
  open: boolean
  title: string
  subtitle: string
  origin: string
  badges: readonly string[]
  contentHtml: string
  busy?: boolean
}>(), {
  busy: false,
})

defineEmits<{
  close: []
}>()
</script>

<template>
  <ModalLayer
    :open="open"
    :busy="busy"
    title-id="markdownDialogTitle"
    panel-class="markdown-dialog"
    overlay-class="markdown-modal-overlay"
    @close="$emit('close')"
  >
    <div class="project-dialog-head markdown-dialog-head">
      <div>
        <h2 id="markdownDialogTitle" tabindex="-1" data-dialog-initial>{{ title }}</h2>
        <p>{{ subtitle }}</p>
      </div>
      <button class="btn icon-button btn-outline-secondary btn-sm" type="button" title="关闭" aria-label="关闭" @click="$emit('close')"><UiIcon name="x" /></button>
    </div>
    <div class="markdown-dialog-meta">
      <UiTag :label="`出处：${origin}`" icon-name="fileText" />
      <UiTag v-for="label in badges" :key="label" :label="label" icon-name="tag" />
    </div>
    <div class="markdown-dialog-body rendered-markdown" v-html="contentHtml" />
  </ModalLayer>
</template>
