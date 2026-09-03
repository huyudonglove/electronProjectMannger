<script setup lang="ts">
import ModalLayer from './ModalLayer.vue'
import UiIconButton from '../ui/UiIconButton.vue'

defineProps<{
  open: boolean
  busy: boolean
  canInitialize: boolean
}>()

defineEmits<{
  initialize: []
  chooseProject: []
}>()
</script>

<template>
  <ModalLayer
    :open="open"
    :busy="busy"
    :dismissible="false"
    title-id="initDialogTitle"
    panel-class="init-dialog"
  >
    <h2 id="initDialogTitle">初始化项目</h2>
    <div class="init-dialog-actions">
      <UiIconButton
        icon="plus"
        label="初始化"
        variant="primary"
        data-dialog-initial
        :disabled="busy || !canInitialize"
        @click="$emit('initialize')"
      />
      <UiIconButton
        icon="folderOpen"
        label="选择其他项目"
        :disabled="busy"
        @click="$emit('chooseProject')"
      />
    </div>
  </ModalLayer>
</template>
