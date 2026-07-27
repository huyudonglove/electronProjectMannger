<script setup lang="ts">
import { reactive, watch } from 'vue'

type AgentModel = {
  profileId: string
  provider: 'openai'
  model: string
  credentialRef: string
  credentialConfigured: boolean
  credentialUpdatedAt?: string
  organization?: string
  project?: string
  reasoningEffort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  verbosity: 'low' | 'medium' | 'high'
}

type AgentSettings = {
  settingsRevision: string
  credentialRevision: string
  models: AgentModel[]
}

const props = defineProps<{
  settings: AgentSettings | null
  busy: boolean
}>()

const emit = defineEmits<{
  reload: []
  updateModel: [payload: Record<string, string>]
  saveCredential: [payload: Record<string, string>]
  deleteCredential: [payload: Record<string, string>]
}>()

const form = reactive({
  profileId: '',
  organization: '',
  project: '',
  reasoningEffort: 'medium',
  verbosity: 'low',
  credential: '',
})

watch(
  () => props.settings,
  (settings) => {
    const model = settings?.models[0]
    if (!model) return
    form.profileId = model.profileId
    form.organization = model.organization || ''
    form.project = model.project || ''
    form.reasoningEffort = model.reasoningEffort
    form.verbosity = model.verbosity
  },
  { immediate: true },
)

function updateModel() {
  if (!props.settings || !form.profileId) return
  emit('updateModel', {
    expectedRevision: props.settings.settingsRevision,
    profileId: form.profileId,
    organization: form.organization,
    project: form.project,
    reasoningEffort: form.reasoningEffort,
    verbosity: form.verbosity,
  })
}

function saveCredential() {
  if (!props.settings || !form.profileId || !form.credential.trim()) return
  emit('saveCredential', {
    profileId: form.profileId,
    value: form.credential,
    expectedCredentialRevision: props.settings.credentialRevision,
  })
  form.credential = ''
}

function deleteCredential() {
  if (!props.settings || !form.profileId) return
  emit('deleteCredential', {
    profileId: form.profileId,
    expectedCredentialRevision: props.settings.credentialRevision,
  })
}
</script>

<template>
  <section id="agent-settings" class="section view active-view agent-settings-view">
    <div class="section-head">
      <div><h2>Agent</h2><span>模型与本机凭据</span></div>
      <button class="btn btn-outline-secondary btn-sm" type="button" :disabled="props.busy" @click="emit('reload')">刷新</button>
    </div>

    <p v-if="!props.settings" class="empty-panel">正在读取 Agent 配置…</p>
    <template v-else>
      <article v-for="model in props.settings.models" :key="model.profileId" class="card agent-model-card">
        <header class="agent-model-head">
          <div>
            <span class="agent-provider-mark">AI</span>
            <div><strong>{{ model.model }}</strong><small>OpenAI Responses</small></div>
          </div>
          <span class="credential-state" :class="{ configured: model.credentialConfigured }">
            <i />{{ model.credentialConfigured ? '凭据已配置' : '未配置凭据' }}
          </span>
        </header>

        <div class="agent-settings-grid">
          <label>
            <span>推理强度</span>
            <select v-model="form.reasoningEffort" :disabled="props.busy">
              <option value="none">None</option>
              <option value="minimal">Minimal</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="xhigh">XHigh</option>
            </select>
          </label>
          <label>
            <span>回答密度</span>
            <select v-model="form.verbosity" :disabled="props.busy">
              <option value="low">简洁</option>
              <option value="medium">标准</option>
              <option value="high">详细</option>
            </select>
          </label>
          <label>
            <span>Organization <small>可选</small></span>
            <input v-model="form.organization" type="text" autocomplete="off" :disabled="props.busy" placeholder="org_…" />
          </label>
          <label>
            <span>Project <small>可选</small></span>
            <input v-model="form.project" type="text" autocomplete="off" :disabled="props.busy" placeholder="proj_…" />
          </label>
        </div>
        <div class="agent-card-actions">
          <small>模型运行参数会参与任务恢复兼容性检查。</small>
          <button class="btn btn-primary btn-sm" type="button" :disabled="props.busy" @click="updateModel">保存参数</button>
        </div>
      </article>

      <article v-if="props.settings.models[0]" class="card credential-card">
        <div class="credential-copy">
          <strong>API Key</strong>
          <p>密钥只会在主进程中通过系统安全存储加密，页面只能读取是否已配置。</p>
        </div>
        <div class="credential-input-row">
          <input
            v-model="form.credential"
            type="password"
            autocomplete="new-password"
            :disabled="props.busy"
            :placeholder="props.settings.models[0].credentialConfigured ? '输入新密钥以替换' : 'sk-…'"
            @keyup.enter="saveCredential"
          />
          <button class="btn btn-primary btn-sm" type="button" :disabled="props.busy || !form.credential.trim()" @click="saveCredential">
            {{ props.settings.models[0].credentialConfigured ? '替换' : '保存' }}
          </button>
          <button v-if="props.settings.models[0].credentialConfigured" class="btn btn-outline-secondary btn-sm" type="button" :disabled="props.busy" @click="deleteCredential">移除</button>
        </div>
      </article>
    </template>
  </section>
</template>

<style scoped>
.agent-settings-view {
  max-width: 980px;
}

.agent-model-card,
.credential-card {
  padding: 20px;
}

.agent-model-head,
.agent-model-head > div,
.agent-card-actions,
.credential-input-row {
  display: flex;
  align-items: center;
}

.agent-model-head {
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 22px;
}

.agent-model-head > div {
  gap: 12px;
}

.agent-model-head strong,
.agent-model-head small {
  display: block;
}

.agent-model-head small,
.agent-card-actions small,
.credential-copy p,
label span small {
  color: var(--muted);
}

.agent-provider-mark {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border: 1px solid var(--primary);
  border-radius: 9px;
  color: var(--primary-text);
  font-size: 11px;
  font-weight: 700;
}

.credential-state {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--muted);
  font-size: 12px;
}

.credential-state i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--danger);
}

.credential-state.configured i {
  background: var(--complete);
}

.agent-settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.agent-settings-grid label {
  display: grid;
  gap: 7px;
}

.agent-settings-grid label > span {
  font-size: 12px;
  font-weight: 600;
}

.agent-card-actions {
  justify-content: space-between;
  gap: 16px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.credential-card {
  display: grid;
  grid-template-columns: minmax(220px, .8fr) minmax(360px, 1.2fr);
  gap: 24px;
  margin-top: 14px;
  align-items: center;
}

.credential-copy p {
  margin: 5px 0 0;
  max-width: 440px;
}

.credential-input-row {
  gap: 8px;
}

.credential-input-row input {
  min-width: 0;
  flex: 1;
}

@media (max-width: 800px) {
  .agent-settings-grid,
  .credential-card {
    grid-template-columns: 1fr;
  }
}
</style>
