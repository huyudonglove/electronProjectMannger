<script setup lang="ts">
type Counts = {
  tasks: number
  thoughts: number
  dialogues: number
  knowledge: number
  questions: number
  logs: number
  constraints: number
}

const props = defineProps<{
  generatedAtText: string
  projectRoot: string
  initialized: boolean
  statusTitle: string
  statusDescription: string
  counts: Counts
  dataRoot: string
  knowledgeRoot: string
  recordSkillPath: string
  busy: boolean
  icon: (name: string) => string
}>()

const emit = defineEmits<{
  openDataRoot: []
  openKnowledgeRoot: []
  copyRecordSkill: []
}>()
</script>

<template>
  <section id="overview" class="section view active-view">
    <div class="section-head">
      <h2>总览</h2>
      <span>{{ props.generatedAtText }}</span>
    </div>
    <section class="card status-panel">
      <span v-if="!props.projectRoot" class="status-eyebrow">Ready</span>
      <h2>{{ props.statusTitle }}</h2>
      <p v-if="props.statusDescription">{{ props.statusDescription }}</p>
    </section>
    <div class="stats">
      <article v-for="item in [
        ['tasks', '任务', 'listChecks'],
        ['thoughts', '想法', 'messageCircle'],
        ['dialogues', '研究', 'messagesSquare'],
        ['knowledge', '知识', 'bookOpen'],
        ['questions', '未确认', 'gitPullRequest'],
        ['logs', '记录', 'scrollText'],
        ['constraints', '约束', 'shield'],
      ]" :key="item[0]" class="card stat">
        <div class="stat-head"><span class="stat-icon" v-html="props.icon(item[2])" /><span>{{ item[1] }}</span></div>
        <strong>{{ props.counts[item[0] as keyof Counts] }}</strong>
      </article>
    </div>
    <div class="card paths">
      <div>
        <span>当前项目</span>
        <code>{{ props.projectRoot ? props.projectRoot : '尚未打开项目' }}</code>
      </div>
      <div>
        <span>数据层</span>
        <div class="path-value">
          <code>{{ props.dataRoot || '初始化后显示' }}</code>
          <button class="btn icon-button btn-outline-secondary btn-sm" type="button" title="打开数据层文件夹" aria-label="打开数据层文件夹" :disabled="props.busy || !props.initialized || !props.dataRoot" @click="emit('openDataRoot')" v-html="props.icon('folderOpen')" />
        </div>
      </div>
      <div>
        <span>全局知识库</span>
        <div class="path-value">
          <code>{{ props.knowledgeRoot || '初始化后显示' }}</code>
          <button class="btn icon-button btn-outline-secondary btn-sm" type="button" title="打开知识库文件夹" aria-label="打开知识库文件夹" :disabled="props.busy || !props.initialized || !props.knowledgeRoot" @click="emit('openKnowledgeRoot')" v-html="props.icon('folderOpen')" />
        </div>
      </div>
    </div>
    <div class="card record-skill-card">
      <div>
        <strong>项目记录 Skill</strong>
        <p>复制使用指令，供本机外部代码工具读取和维护项目记录。</p>
      </div>
      <button
        class="btn icon-button btn-outline-primary btn-sm"
        type="button"
        title="复制项目记录 Skill 使用指令"
        aria-label="复制项目记录 Skill 使用指令"
        :disabled="props.busy || !props.initialized || !props.recordSkillPath"
        @click="emit('copyRecordSkill')"
        v-html="props.icon('copy')"
      />
      <code>{{ props.recordSkillPath || '初始化后显示' }}</code>
    </div>
  </section>
</template>
