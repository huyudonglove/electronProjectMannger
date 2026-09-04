<script lang="ts">
export type CollaborationRecordMode = 'open' | 'decided' | 'risks'
export type CollaborationRecordItem = Record<string, any>
</script>

<script setup lang="ts">
import { formatTime } from '../../utils/record-presentation'
import UiIconButton from '../ui/UiIconButton.vue'
import UiTag from '../ui/UiTag.vue'

defineProps<{
  item: CollaborationRecordItem
  mode: CollaborationRecordMode
}>()

const emit = defineEmits<{
  openQuestionTarget: [item: CollaborationRecordItem]
  openReplyDialog: [item: CollaborationRecordItem]
  completeQuestion: [item: CollaborationRecordItem]
  resolveRisk: [item: CollaborationRecordItem]
  editQuestion: [item: CollaborationRecordItem]
}>()

function questionThreadMessages(item: CollaborationRecordItem) {
  const source = Array.isArray(item.messages) ? item.messages : []
  const question = String(item.question || '').trim()
  return source.filter((message: CollaborationRecordItem, index: number) =>
    !(index === 0 && String(message.content || '').trim() === question))
}

function questionMessageRole(role: string) {
  if (role === 'user') return '你'
  return '历史记录'
}

function questionMessageClass(role: string) {
  return role === 'user' ? 'is-user' : 'is-record'
}

function questionKindText(kind: string) {
  return ({ decision: '决策', clarification: '澄清', blocker: '阻塞' } as Record<string, string>)[kind] || kind
}

function riskKindText(kind: string) {
  return ({ risk: '风险', verification: '验证限制', 'follow-up': '后续事项' } as Record<string, string>)[kind] || kind
}
</script>

<template>
  <article class="collab-detail" :class="{ 'risk-record': mode === 'risks' }">
    <div class="collab-record-head">
      <div>
        <span class="task-short-id">{{ item.shortId }}</span>
        <UiTag v-if="mode === 'open'" :label="questionKindText(item.kind)" icon-name="messageCircle" />
        <UiTag v-else-if="mode === 'decided'" label="待跟进" tone="warning" variant="status" icon-name="clock" />
        <UiTag v-else :label="riskKindText(item.kind)" tone="warning" icon-name="alertTriangle" />
        <UiTag v-if="item.blocking" label="阻塞" tone="warning" variant="status" icon-name="alertTriangle" />
      </div>
      <div class="collab-record-actions">
        <UiIconButton v-if="mode !== 'risks'" icon="edit" label="编辑协作问题" size="sm" @click="emit('editQuestion', item)" />
        <UiIconButton v-if="mode === 'open' && item.relations?.length" icon="eye" label="查看关联记录" size="sm" @click="emit('openQuestionTarget', item)" />
        <UiIconButton v-if="mode === 'open'" icon="messageCircle" label="回复" variant="primary" size="sm" @click="emit('openReplyDialog', item)" />
        <UiIconButton v-else-if="mode === 'decided'" icon="messageCircle" label="补充说明" size="sm" @click="emit('openReplyDialog', item)" />
        <UiIconButton v-if="mode === 'decided'" icon="circleCheck" label="标记已完成" variant="primary" size="sm" @click="emit('completeQuestion', item)" />
        <UiIconButton v-if="mode === 'risks'" icon="circleCheck" label="标记已处理" variant="primary" size="sm" @click="emit('resolveRisk', item)" />
      </div>
    </div>
    <div class="collab-detail-title">
      <h2>{{ item.title }}</h2>
      <p>{{ item.question || item.content }}</p>
    </div>
    <div v-if="item.background && item.background !== '无。'" class="collab-context"><strong>背景</strong><span>{{ item.background }}</span></div>
    <div v-if="item.recommendation && item.recommendation !== '无。'" class="collab-recommendation"><strong>建议</strong><span>{{ item.recommendation }}</span></div>
    <div v-if="item.handling && item.handling !== '无。'" class="collab-context"><strong>处理建议</strong><span>{{ item.handling }}</span></div>
    <div v-if="questionThreadMessages(item).length" class="collab-thread">
      <div v-for="message in questionThreadMessages(item)" :key="message.id" class="collab-message" :class="questionMessageClass(message.role)">
        <div><strong>{{ questionMessageRole(message.role) }}</strong><time>{{ formatTime(message.created) }}</time></div>
        <p>{{ message.content }}</p>
      </div>
    </div>
    <div v-else-if="mode === 'decided' && item.conclusion" class="collab-decision"><strong>最新说明</strong><span>{{ item.conclusion }}</span></div>
    <div class="collab-record-meta">
      <span>{{ item.scope === 'project' ? '项目级' : item.version }}</span>
      <span v-for="relation in item.relations || []" :key="relation">{{ relation }}</span>
      <time v-if="item.updated">{{ formatTime(item.updated) }}</time>
    </div>
  </article>
</template>
