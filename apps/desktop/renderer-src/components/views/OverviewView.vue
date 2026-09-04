<script setup lang="ts">
import UiIcon from '../ui/UiIcon.vue'
import UiIconButton from '../ui/UiIconButton.vue'

type Counts = {
  tasks: number
  thoughts: number
  dialogues: number
  knowledge: number
  questions: number
  logs: number
  constraints: number
}

type OverviewSection = 'board' | 'dialogues' | 'collaboration'

const props = defineProps<{
  initialized: boolean
  statusTitle: string
  statusDescription: string
  selectedVersionTitle?: string
  counts: Counts
  dataRoot: string
  knowledgeRoot: string
  recordSkillPath: string
  busy: boolean
}>()

const emit = defineEmits<{
  openDataRoot: []
  openKnowledgeRoot: []
  copyRecordSkill: []
  navigate: [section: OverviewSection]
}>()

</script>

<template>
  <section id="overview" class="section view active-view">
    <div class="overview-layout">
      <section class="card status-panel overview-focus">
        <h2>{{ props.selectedVersionTitle || props.statusTitle }}</h2>
        <p v-if="props.statusDescription">{{ props.statusDescription }}</p>

        <div class="overview-core-metrics" aria-label="核心记录">
          <button class="overview-core-metric" type="button" @click="emit('navigate', 'board')">
            <span><UiIcon name="listChecks" />任务</span>
            <strong>{{ props.counts.tasks }}</strong>
          </button>
          <button class="overview-core-metric" type="button" @click="emit('navigate', 'dialogues')">
            <span><UiIcon name="messagesSquare" />研究</span>
            <strong>{{ props.counts.dialogues }}</strong>
          </button>
          <button class="overview-core-metric" type="button" @click="emit('navigate', 'collaboration')">
            <span><UiIcon name="gitPullRequest" />未确认</span>
            <strong>{{ props.counts.questions }}</strong>
          </button>
        </div>
      </section>

      <aside class="card overview-summary" aria-label="记录摘要">
        <dl>
          <div><dt><UiIcon name="messageCircle" />想法</dt><dd>{{ props.counts.thoughts }}</dd></div>
          <div><dt><UiIcon name="bookOpen" />知识</dt><dd>{{ props.counts.knowledge }}</dd></div>
          <div><dt><UiIcon name="scrollText" />记录</dt><dd>{{ props.counts.logs }}</dd></div>
          <div><dt><UiIcon name="shield" />约束</dt><dd>{{ props.counts.constraints }}</dd></div>
        </dl>
      </aside>

      <details class="card project-details">
        <summary>
          <span><UiIcon name="folderOpen" />项目与存储</span>
        </summary>
        <div class="project-details-body">
          <div class="project-detail-row">
            <span>数据层</span>
            <div class="path-value">
              <code :title="props.dataRoot">{{ props.dataRoot || '初始化后显示' }}</code>
              <UiIconButton icon="folderOpen" label="打开数据层文件夹" size="sm" :disabled="props.busy || !props.initialized || !props.dataRoot" @click="emit('openDataRoot')" />
            </div>
          </div>
          <div class="project-detail-row">
            <span>全局知识库</span>
            <div class="path-value">
              <code :title="props.knowledgeRoot">{{ props.knowledgeRoot || '初始化后显示' }}</code>
              <UiIconButton icon="folderOpen" label="打开知识库文件夹" size="sm" :disabled="props.busy || !props.initialized || !props.knowledgeRoot" @click="emit('openKnowledgeRoot')" />
            </div>
          </div>
          <div class="project-detail-row project-detail-skill">
            <span>项目记录 Skill</span>
            <div class="path-value">
              <code :title="props.recordSkillPath">{{ props.recordSkillPath || '初始化后显示' }}</code>
              <UiIconButton icon="copy" label="复制 Skill" variant="outline-primary" size="sm" :disabled="props.busy || !props.initialized || !props.recordSkillPath" @click="emit('copyRecordSkill')" />
            </div>
          </div>
        </div>
      </details>
    </div>
  </section>
</template>
