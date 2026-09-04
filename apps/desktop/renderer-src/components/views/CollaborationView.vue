<script setup lang="ts">
import CollaborationRecordDetail, { type CollaborationRecordMode } from '../details/CollaborationRecordDetail.vue'
import UiEmptyState from '../ui/UiEmptyState.vue'
import IndexPaneHeader from '../ui/IndexPaneHeader.vue'
import RecordIndexButton from '../ui/RecordIndexButton.vue'
import UiIconButton from '../ui/UiIconButton.vue'
import UiTag from '../ui/UiTag.vue'
import { formatTime } from '../../utils/record-presentation'

type CollabItem = Record<string, any>
type VersionItem = Record<string, any>
type CollabTab = 'open' | 'decided' | 'risks' | 'history'

const props = defineProps<{
  selectedVersion: VersionItem | null | undefined
  collabTab: CollabTab
  openQuestions: CollabItem[]
  pendingDecisions: CollabItem[]
  activeRisks: CollabItem[]
  activeCollabItems: CollabItem[]
  selectedCollabItem: CollabItem | null | undefined
  selectedCollabIndex: number
  versions: VersionItem[]
  questions: CollabItem[]
  risks: CollabItem[]
}>()

const emit = defineEmits<{
  'update:collabTab': [tab: CollabTab]
  openCollabItem: [index: number]
  openQuestionTarget: [item: CollabItem]
  openReplyDialog: [item: CollabItem]
  completeQuestion: [item: CollabItem]
  resolveRisk: [item: CollabItem]
  editQuestion: [item: CollabItem]
}>()

function setCollabTab(tab: CollabTab) {
  emit('update:collabTab', tab)
}

function versionHistoryQuestions(versionId: string) {
  return props.questions.filter((item) => item.version === versionId && ['resolved', 'expired'].includes(item.status))
}

function versionHistoryRisks(versionId: string) {
  return props.risks.filter((item) => item.version === versionId && ['resolved', 'expired'].includes(item.status))
}

function versionHistoryCount(versionId: string) {
  return versionHistoryQuestions(versionId).length + versionHistoryRisks(versionId).length
}

function questionThreadMessages(item: CollabItem) {
  const source = Array.isArray(item.messages) ? item.messages : []
  const question = String(item.question || '').trim()
  return source.filter((message: CollabItem, index: number) =>
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
  <section id="collaboration" class="section view active-view">
    <div class="segmented-control collab-tabs" role="tablist" aria-label="协作记录类型">
      <button type="button" :class="{ active: collabTab === 'open' }" @click="setCollabTab('open')">待我回复 <span>{{ openQuestions.length }}</span></button>
      <button type="button" :class="{ active: collabTab === 'decided' }" @click="setCollabTab('decided')">待跟进 <span>{{ pendingDecisions.length }}</span></button>
      <button type="button" :class="{ active: collabTab === 'risks' }" @click="setCollabTab('risks')">风险与后续 <span>{{ activeRisks.length }}</span></button>
      <button type="button" :class="{ active: collabTab === 'history' }" @click="setCollabTab('history')">版本历史</button>
    </div>

    <div v-if="collabTab !== 'history'" class="collab-workspace">
      <aside class="collab-index">
        <IndexPaneHeader title="记录" />
        <div class="collab-index-list">
          <UiEmptyState
            v-if="!activeCollabItems.length"
            :message="collabTab === 'open' ? '暂无待回复' : collabTab === 'decided' ? '暂无待跟进' : '暂无风险或后续'"
            compact
          />
          <RecordIndexButton
            v-for="(item, index) in activeCollabItems"
            :key="item.id"
            class="collab-index-item"
            :active="index === selectedCollabIndex"
            @click="emit('openCollabItem', index)"
          >
            <span class="collab-index-meta">
              <span class="task-short-id">{{ item.shortId }}</span>
              <UiTag v-if="collabTab === 'open'" :label="questionKindText(item.kind)" icon-name="messageCircle" />
              <UiTag v-else-if="collabTab === 'risks'" :label="riskKindText(item.kind)" tone="warning" icon-name="alertTriangle" />
            </span>
            <strong>{{ item.title }}</strong>
            <small>{{ item.question || item.content || '暂无内容。' }}</small>
            <span class="collab-index-foot">{{ item.scope === 'project' ? '项目级' : item.version || '未标注版本' }}</span>
          </RecordIndexButton>
        </div>
      </aside>

      <div class="collab-detail-wrap">
        <UiEmptyState v-if="!selectedCollabItem" class="collab-detail-empty" message="选择一条记录" compact />
        <CollaborationRecordDetail
          v-else
          :item="selectedCollabItem"
          :mode="collabTab as CollaborationRecordMode"
          @open-question-target="emit('openQuestionTarget', $event)"
          @open-reply-dialog="emit('openReplyDialog', $event)"
          @complete-question="emit('completeQuestion', $event)"
          @resolve-risk="emit('resolveRisk', $event)"
          @edit-question="emit('editQuestion', $event)"
        />
      </div>
    </div>

    <div v-else class="version-history-list collab-history-view">
      <details v-for="version in versions" :key="version.shortId" class="version-history-group" :open="version.status === 'active'">
        <summary>
          <span><span class="task-short-id">{{ version.shortId }}</span><strong>{{ version.label }} · {{ version.title }}</strong></span>
          <span>{{ versionHistoryCount(version.shortId) }} 条</span>
        </summary>
        <div class="collab-history-records">
          <UiEmptyState v-if="!versionHistoryCount(version.shortId)" message="暂无归档记录" compact />
          <article v-for="item in versionHistoryQuestions(version.shortId)" :key="item.id" class="collab-history-row">
            <span class="task-short-id">{{ item.shortId }}</span>
            <div class="collab-history-main">
              <strong>{{ item.title }}</strong>
              <p>{{ item.question }}</p>
              <div v-if="questionThreadMessages(item).length" class="collab-thread compact-thread">
                <div v-for="message in questionThreadMessages(item)" :key="message.id" class="collab-message" :class="questionMessageClass(message.role)">
                  <div><strong>{{ questionMessageRole(message.role) }}</strong><time>{{ formatTime(message.created) }}</time></div>
                  <p>{{ message.content }}</p>
                </div>
              </div>
            </div>
            <div class="collab-history-actions">
              <UiTag :label="item.status === 'resolved' ? '已完成' : '已归档'" :tone="item.status === 'resolved' ? 'complete' : 'neutral'" variant="status" :icon-name="item.status === 'resolved' ? 'circleCheck' : 'archive'" />
              <UiIconButton icon="edit" label="编辑协作问题" size="sm" @click="emit('editQuestion', item)" />
              <UiIconButton icon="messagesSquare" label="继续讨论" size="sm" @click="emit('openReplyDialog', item)" />
            </div>
          </article>
          <article v-for="item in versionHistoryRisks(version.shortId)" :key="item.id" class="collab-history-row">
            <span class="task-short-id">{{ item.shortId }}</span>
            <div><strong>{{ item.title }}</strong><p>{{ item.content }}</p></div>
            <UiTag :label="item.status === 'resolved' ? '已处理' : '已归档'" :tone="item.status === 'resolved' ? 'complete' : 'neutral'" variant="status" :icon-name="item.status === 'resolved' ? 'circleCheck' : 'archive'" />
          </article>
        </div>
      </details>
    </div>
  </section>
</template>
