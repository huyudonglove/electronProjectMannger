<script setup lang="ts">
import DialogHeader from '../ui/DialogHeader.vue'
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
    <DialogHeader class="markdown-dialog-head" title-id="markdownDialogTitle" :title="title" :subtitle="subtitle" initial-focus @close="$emit('close')" />
    <div class="markdown-dialog-meta">
      <UiTag :label="`出处：${origin}`" icon-name="fileText" />
      <UiTag v-for="label in badges" :key="label" :label="label" icon-name="tag" />
    </div>
    <div class="markdown-dialog-body rendered-markdown" v-html="contentHtml" />
  </ModalLayer>
</template>
