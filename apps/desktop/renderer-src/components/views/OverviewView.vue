<script setup lang="ts">
import UiIcon from '../ui/UiIcon.vue'

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
  generatedAtText: string
  projectRoot: string
  initialized: boolean
  statusTitle: string
  statusDescription: string
  selectedVersionLabel?: string
  selectedVersionTitle?: string
  selectedVersionStatus?: string
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

function versionStatusText(status?: string) {
  if (!status) return ''
  return ({ planned: '规划中', active: '进行中', paused: '已暂停', completed: '已完成' } as Record<string, string>)[status] || status
}
</script>

<template>
  <section id="overview" class="section view active-view">
    <div class="section-head">
      <h2>总览</h2>
      <span>{{ props.generatedAtText }}</span>
    </div>
    <div class="overview-layout">
      <section class="card status-panel overview-focus">
        <div v-if="props.selectedVersionLabel" class="overview-focus-context">
          <span>{{ props.selectedVersionLabel }}</span>
          <span v-if="props.selectedVersionStatus" class="overview-version-status">{{ versionStatusText(props.selectedVersionStatus) }}</span>
        </div>
        <span v-else-if="!props.projectRoot" class="status-eyebrow">Ready</span>
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
        <div class="overview-summary-head">
          <strong>记录摘要</strong>
          <span>版本 / 项目</span>
        </div>
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
          <small>路径与 Skill</small>
        </summary>
        <div class="project-details-body">
          <div class="project-detail-row">
            <span>当前项目</span>
            <code :title="props.projectRoot">{{ props.projectRoot || '尚未打开项目' }}</code>
          </div>
          <div class="project-detail-row">
            <span>数据层</span>
            <div class="path-value">
              <code :title="props.dataRoot">{{ props.dataRoot || '初始化后显示' }}</code>
              <button class="btn icon-button btn-outline-secondary btn-sm" type="button" title="打开数据层文件夹" aria-label="打开数据层文件夹" :disabled="props.busy || !props.initialized || !props.dataRoot" @click="emit('openDataRoot')"><UiIcon name="folderOpen" /></button>
            </div>
          </div>
          <div class="project-detail-row">
            <span>全局知识库</span>
            <div class="path-value">
              <code :title="props.knowledgeRoot">{{ props.knowledgeRoot || '初始化后显示' }}</code>
              <button class="btn icon-button btn-outline-secondary btn-sm" type="button" title="打开知识库文件夹" aria-label="打开知识库文件夹" :disabled="props.busy || !props.initialized || !props.knowledgeRoot" @click="emit('openKnowledgeRoot')"><UiIcon name="folderOpen" /></button>
            </div>
          </div>
          <div class="project-detail-row project-detail-skill">
            <span>项目记录 Skill</span>
            <div class="path-value">
              <code :title="props.recordSkillPath">{{ props.recordSkillPath || '初始化后显示' }}</code>
              <button class="btn icon-button btn-outline-primary btn-sm" type="button" title="复制 Skill" aria-label="复制 Skill" :disabled="props.busy || !props.initialized || !props.recordSkillPath" @click="emit('copyRecordSkill')"><UiIcon name="copy" /></button>
            </div>
          </div>
        </div>
      </details>
    </div>
  </section>
</template>
