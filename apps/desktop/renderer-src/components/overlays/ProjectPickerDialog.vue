<script setup lang="ts">
import { formatTime, projectDisplayName, type AnyRecord } from '../../utils/record-formatters'
import UiIcon from '../ui/UiIcon.vue'
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
    <div class="project-dialog-head">
      <div>
        <h2 id="projectDialogTitle">打开项目</h2>
        <p>选择最近项目，或打开其他项目文件夹。</p>
      </div>
      <button
        class="btn icon-button btn-outline-secondary btn-sm"
        type="button"
        title="关闭"
        aria-label="关闭"
        :disabled="busy"
        @click="$emit('close')"
      >
        <UiIcon name="x" />
      </button>
    </div>
    <div class="recent-project-list">
      <p v-if="!projects.length" class="empty-panel">暂无最近项目。</p>
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
        <button
          class="btn icon-button btn-outline-secondary btn-sm delete-action"
          type="button"
          title="从最近项目中移除"
          aria-label="从最近项目中移除"
          :disabled="busy"
          @click.stop="$emit('removeProject', project.projectId)"
        >
          <UiIcon name="trash" />
        </button>
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
