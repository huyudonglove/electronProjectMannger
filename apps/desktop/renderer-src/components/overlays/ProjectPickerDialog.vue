<script setup lang="ts">
import { ref, watch } from 'vue'
import { formatTime, projectDisplayName, type AnyRecord } from '../../utils/record-formatters'
import DialogHeader from '../ui/DialogHeader.vue'
import UiEmptyState from '../ui/UiEmptyState.vue'
import UiIcon from '../ui/UiIcon.vue'
import UiIconButton from '../ui/UiIconButton.vue'
import ModalLayer from './ModalLayer.vue'

const props = defineProps<{
  open: boolean
  busy: boolean
  projects: readonly AnyRecord[]
  currentProjectRoot: string
}>()

const emit = defineEmits<{
  close: []
  openProject: [projectRoot: string]
  removeProject: [projectId: string]
  browse: []
}>()

const pendingRemovalId = ref('')

watch(() => props.open, (open) => {
  if (!open) pendingRemovalId.value = ''
})

function projectName(project: AnyRecord) {
  return project.projectName || projectDisplayName(project.projectRoot)
}

function projectPathLabel(projectRoot: string) {
  return String(projectRoot || '').replace(/^\/Users\/[^/]+(?=\/)/, '~')
}

function confirmRemoval(project: AnyRecord) {
  pendingRemovalId.value = ''
  emit('removeProject', project.projectId)
}
</script>

<template>
  <ModalLayer
    :open="open"
    :busy="busy"
    title-id="projectDialogTitle"
    panel-class="project-dialog"
    @close="emit('close')"
  >
    <DialogHeader title-id="projectDialogTitle" title="打开项目" :close-disabled="busy" @close="emit('close')" />
    <section class="recent-project-section" aria-labelledby="recentProjectsTitle">
      <div class="recent-project-list-head">
        <strong id="recentProjectsTitle">最近项目</strong>
        <small>{{ projects.length }}</small>
      </div>
      <div class="recent-project-list">
        <UiEmptyState v-if="!projects.length" message="暂无最近项目" compact />
        <div
          v-for="(project, index) in projects"
          :key="project.projectId"
          class="recent-project-row"
          :class="{ 'is-current': project.projectRoot === currentProjectRoot, 'is-confirming': pendingRemovalId === project.projectId }"
        >
          <button
            class="recent-project-item"
            type="button"
            :data-dialog-initial="index === 0 ? '' : null"
            :disabled="busy || pendingRemovalId === project.projectId"
            :aria-current="project.projectRoot === currentProjectRoot ? 'location' : undefined"
            @click="emit('openProject', project.projectRoot)"
          >
            <UiIcon class="recent-project-mark" name="folderOpen" />
            <span class="recent-project-copy">
              <span class="recent-project-name">
                <strong>{{ projectName(project) }}</strong>
                <small v-if="project.projectRoot === currentProjectRoot" class="recent-project-current">当前</small>
              </span>
              <span class="recent-project-meta">
                <small :title="project.projectRoot">{{ projectPathLabel(project.projectRoot) }}</small>
                <time :datetime="project.lastOpenedAt">{{ formatTime(project.lastOpenedAt) }}</time>
              </span>
            </span>
          </button>
          <UiIconButton
            v-if="pendingRemovalId !== project.projectId"
            class="delete-action recent-project-remove"
            icon="trash"
            :label="`从最近项目中移除 ${projectName(project)}`"
            variant="ghost"
            size="sm"
            :disabled="busy"
            @click.stop="pendingRemovalId = project.projectId"
          />
          <div v-else class="recent-project-remove-confirm" role="group" :aria-label="`确认移除 ${projectName(project)}`">
            <span><strong>移出列表？</strong><small>不会删除项目文件</small></span>
            <button class="btn btn-ghost btn-sm" type="button" :disabled="busy" @click="pendingRemovalId = ''"><UiIcon name="x" />取消</button>
            <button class="btn btn-sm delete-action" type="button" :disabled="busy" @click="confirmRemoval(project)"><UiIcon name="trash" />移除</button>
          </div>
        </div>
      </div>
    </section>
    <div class="init-dialog-actions">
      <button
        class="btn btn-primary project-browse-action"
        type="button"
        :data-dialog-initial="!projects.length ? '' : null"
        :disabled="busy"
        @click="emit('browse')"
      ><UiIcon name="folderOpen" />打开其他项目</button>
    </div>
  </ModalLayer>
</template>
