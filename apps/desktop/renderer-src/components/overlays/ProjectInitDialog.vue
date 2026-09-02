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
    <h2 id="initDialogTitle">初始化项目管理数据</h2>
    <p>为当前项目创建本地管理数据和记录目录。</p>
    <div class="init-dialog-actions">
      <UiIconButton
        icon="archive"
        label="初始化"
        variant="primary"
        data-dialog-initial
        :disabled="busy || !canInitialize"
        @click="$emit('initialize')"
      />
      <UiIconButton
        icon="history"
        label="重新选择项目"
        :disabled="busy"
        @click="$emit('chooseProject')"
      />
    </div>
  </ModalLayer>
</template>
