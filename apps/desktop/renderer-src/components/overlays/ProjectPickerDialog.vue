<script setup lang="ts">
import { formatTime, projectDisplayName, type AnyRecord } from '../../utils/record-formatters'
import DialogHeader from '../ui/DialogHeader.vue'
import UiEmptyState from '../ui/UiEmptyState.vue'
import UiIcon from '../ui/UiIcon.vue'
import UiIconButton from '../ui/UiIconButton.vue'
import ModalLayer from './ModalLayer.vue'

defineProps<{
  open: boolean
  busy: boolean
  projects: readonly AnyRecord[]
}>()

defineEmits<{
  close: []
  openProject: [projectRoot: string]
  removeProject: [projectId: string]
  browse: []
}>()
</script>

<template>
  <ModalLayer
    :open="open"
    :busy="busy"
    title-id="projectDialogTitle"
    panel-class="project-dialog"
    @close="$emit('close')"
  >
    <DialogHeader title-id="projectDialogTitle" title="打开项目" subtitle="选择最近项目，或打开其他项目文件夹。" :close-disabled="busy" @close="$emit('close')" />
    <div class="recent-project-list">
      <UiEmptyState v-if="!projects.length" message="暂无最近项目。" compact />
      <div v-for="(project, index) in projects" :key="project.projectId" class="recent-project-row">
        <button
          class="recent-project-item"
          type="button"
          :data-dialog-initial="index === 0 ? '' : null"
          :disabled="busy"
          @click="$emit('openProject', project.projectRoot)"
        >
          <UiIcon class="recent-project-mark" name="folderOpen" />
          <span>
            <strong>{{ project.projectName || projectDisplayName(project.projectRoot) }}</strong>
            <small :title="project.projectRoot">{{ project.projectRoot }} · {{ formatTime(project.lastOpenedAt) }}</small>
          </span>
        </button>
        <UiIconButton
          class="delete-action"
          icon="trash"
          label="从最近项目中移除"
          size="sm"
          :disabled="busy"
          @click.stop="$emit('removeProject', project.projectId)"
        />
      </div>
    </div>
    <div class="init-dialog-actions">
      <button
        class="btn btn-primary"
        type="button"
        :data-dialog-initial="!projects.length ? '' : null"
        @click="$emit('browse')"
      >
        <UiIcon name="folderOpen" />
        <span>打开其他项目</span>
      </button>
    </div>
  </ModalLayer>
</template>
