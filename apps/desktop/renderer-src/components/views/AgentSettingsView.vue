<script setup lang="ts">
import { computed, reactive, watch } from 'vue'

type BackendProvider = {
  id: string
  name: string
  models: string[]
  defaultModel: string
  free: boolean
  configured: boolean
  transport: 'loopback-proxy' | 'browser-direct'
  desktopAvailable: boolean
}

type AgentModel = {
  profileId: string
  provider: 'openai'
  providerId: string
  model: string
  connectionSource: 'credential-vault' | 'telance-local-proxy'
  connectionConfigured: boolean
  desktopAvailable: boolean
  availabilityReason?: string
  reasoningEffort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  verbosity: 'low' | 'medium' | 'high'
}

type AgentSettings = {
  settingsRevision: string
  providerCatalog: {
    source: 'telance-local-proxy'
    label: string
    available: boolean
    activeProviderId: string
    providers: BackendProvider[]
    error?: string
  }
  models: AgentModel[]
  effectiveModelRoute: {
    routeId: string
    source: 'built_in' | 'user' | 'project'
    projectId?: string
    selections: Array<AgentModel & { role: 'primary' | 'fallback'; order: number }>
  }
}

type ModelDiagnostic = {
  at: string
  level: 'info' | 'error'
  event: string
  providerId: string
  model: string
  runId: string
  durationMs?: number
  status?: number
  finishReason?: string
  actionShape?: string
  error?: string
  routeId?: string
  profileId?: string
  attempt?: number
  order?: number
  result?: 'succeeded' | 'failed' | 'cancelled'
  errorCategory?: string
}

const props = defineProps<{
  settings: AgentSettings | null
  busy: boolean
  diagnostics?: ModelDiagnostic[]
}>()

const emit = defineEmits<{
  reload: []
  saveProvider: [payload: { settings: Record<string, string> }]
  saveProjectRoute: [payload: { settings: Record<string, unknown> }]
}>()

const form = reactive({
  profileId: '',
  providerId: '',
  model: '',
  reasoningEffort: 'medium',
  verbosity: 'low',
  fallbacks: [] as Array<{ providerId: string; model: string }>,
})

const providers = computed(() => props.settings?.providerCatalog.providers || [])
const selectedProvider = computed(() => providers.value.find((provider) => provider.id === form.providerId) || null)
const canSave = computed(() => Boolean(
  props.settings?.providerCatalog.available
  && selectedProvider.value?.desktopAvailable
  && selectedProvider.value.models.includes(form.model)
  && form.fallbacks.every((fallback) => {
    const provider = providers.value.find((candidate) => candidate.id === fallback.providerId)
    return provider?.desktopAvailable && provider.models.includes(fallback.model)
  })
  && new Set([[form.providerId, form.model], ...form.fallbacks.map((fallback) => [fallback.providerId, fallback.model])]
    .map(([providerId, model]) => `${providerId}\u0000${model}`)).size === form.fallbacks.length + 1,
))
const visibleDiagnostics = computed(() => {
  const route = props.settings?.effectiveModelRoute
  const profileIds = new Set(route?.selections.map((selection) => selection.profileId) || [])
  const providerIds = new Set(route?.selections.map((selection) => selection.providerId) || [])
  return (props.diagnostics || [])
    .filter((entry) => (entry.routeId && entry.routeId === route?.routeId)
      || (entry.profileId && profileIds.has(entry.profileId))
      || providerIds.has(entry.providerId))
    .slice(0, 20)
})

watch(
  () => props.settings,
  (settings) => {
    const model = settings?.effectiveModelRoute.selections[0] || settings?.models[0]
    if (!model) return
    form.profileId = model.profileId
    form.providerId = model.providerId
    form.model = model.model
    form.reasoningEffort = model.reasoningEffort
    form.verbosity = model.verbosity
    form.fallbacks = (settings?.effectiveModelRoute.selections || []).slice(1).map((selection) => ({
      providerId: selection.providerId,
      model: selection.model,
    }))
    ensureValidSelection()
  },
  { immediate: true },
)

function onProviderChange() {
  if (selectedProvider.value) form.model = selectedProvider.value.defaultModel
}

function ensureValidSelection() {
  if (!selectedProvider.value) {
    form.providerId = providers.value.find((provider) => provider.desktopAvailable)?.id || providers.value[0]?.id || ''
  }
  if (selectedProvider.value && !selectedProvider.value.models.includes(form.model)) {
    form.model = selectedProvider.value.defaultModel
  }
}

function saveProvider() {
  if (!props.settings || !form.profileId || !canSave.value) return
  emit('saveProjectRoute', {
    settings: {
      expectedRevision: props.settings.settingsRevision,
      primary: {
        providerId: form.providerId,
        model: form.model,
        reasoningEffort: form.reasoningEffort,
        verbosity: form.verbosity,
      },
      fallbacks: form.fallbacks.map((fallback) => ({ ...fallback })),
    },
  })
}

function addFallback() {
  if (form.fallbacks.length >= 4) return
  const provider = providers.value.find((candidate) => candidate.desktopAvailable && (
    candidate.id !== form.providerId || candidate.models.some((model) => model !== form.model)
  ))
  if (!provider) return
  const model = provider.models.find((candidate) => !selectionExists(provider.id, candidate)) || provider.defaultModel
  form.fallbacks.push({ providerId: provider.id, model })
}

function updateFallbackProvider(index: number) {
  const fallback = form.fallbacks[index]
  const provider = providers.value.find((candidate) => candidate.id === fallback?.providerId)
  if (fallback && provider) fallback.model = provider.defaultModel
}

function moveFallback(index: number, offset: number) {
  const target = index + offset
  if (target < 0 || target >= form.fallbacks.length) return
  const [item] = form.fallbacks.splice(index, 1)
  form.fallbacks.splice(target, 0, item!)
}

function selectionExists(providerId: string, model: string) {
  return (form.providerId === providerId && form.model === model)
    || form.fallbacks.some((fallback) => fallback.providerId === providerId && fallback.model === model)
}

function sourceLabel(source?: AgentSettings['effectiveModelRoute']['source']) {
  return ({ built_in: '内置默认', user: '用户默认', project: '当前项目' } as Record<string, string>)[source || ''] || '未知来源'
}

function diagnosticLabel(entry: ModelDiagnostic) {
  return ({
    'request.started': '开始请求',
    'response.received': entry.status ? `收到 HTTP ${entry.status}` : '收到响应',
    'response.parsed': '解析响应',
    'request.failed': '请求失败',
    'route.attempt.failed': '模型尝试失败',
    'route.attempt.succeeded': '模型尝试成功',
    'route.attempt.cancelled': '模型尝试取消',
  } as Record<string, string>)[entry.event] || entry.event
}

function diagnosticDetail(entry: ModelDiagnostic) {
  const details = [
    entry.attempt ? `第 ${entry.attempt} 次` : '',
    entry.order ? `链路 #${entry.order}` : '',
    entry.profileId ? `Profile ${entry.profileId}` : '',
    entry.errorCategory ? `分类 ${entry.errorCategory}` : '',
    entry.actionShape ? `结构 ${entry.actionShape}` : '',
    entry.finishReason ? `finish ${entry.finishReason}` : '',
    entry.durationMs !== undefined ? `${entry.durationMs} ms` : '',
  ].filter(Boolean)
  if (entry.error) details.push(entry.error)
  return details.join(' · ') || '已记录'
}

function diagnosticTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date)
}
</script>

<template>
  <section id="settings" class="section view active-view agent-settings-view">
    <div class="section-head">
      <div><h2>设置</h2><span>选择后台已配置的 Provider 与模型</span></div>
      <button class="btn btn-outline-secondary btn-sm" type="button" :disabled="props.busy" @click="emit('reload')">刷新</button>
    </div>

    <p v-if="!props.settings" class="empty-panel">正在读取设置…</p>
    <template v-else>
      <section class="settings-group" aria-labelledby="agentSettingsGroupTitle">
        <header class="settings-group-head">
          <span class="settings-group-mark">A</span>
          <div>
            <h3 id="agentSettingsGroupTitle">Agent</h3>
            <p>项目任务执行、检查点恢复与模型调用共用这组本机设置。</p>
          </div>
        </header>

        <article class="card agent-summary-card">
          <div class="agent-summary-copy">
            <span class="agent-provider-mark">AG</span>
            <div>
              <strong>Coder Agent</strong>
              <p>在当前项目中运行任务，记录过程，并从本地检查点继续。</p>
            </div>
          </div>
          <div class="agent-summary-meta">
            <span>本地运行</span>
            <strong>{{ providers.filter((provider) => provider.desktopAvailable).length }} 个可用连接</strong>
          </div>
        </article>
      </section>

      <section class="settings-group" aria-labelledby="modelSettingsGroupTitle">
        <header class="settings-group-head">
          <span class="settings-group-mark">M</span>
          <div>
            <h3 id="modelSettingsGroupTitle">模型</h3>
            <p>连接地址和密钥由 Chrome Extion 后台维护，这里只选择可用项。</p>
          </div>
        </header>

        <article class="card agent-model-card">
          <header class="agent-model-head">
            <div>
              <span class="agent-provider-mark">AI</span>
              <div>
                <strong>{{ selectedProvider?.name || '后台 Provider' }}</strong>
                <small>{{ form.model || '等待选择模型' }} · Chat Completions</small>
              </div>
            </div>
            <span class="connection-state" :class="{ configured: selectedProvider?.desktopAvailable }">
              <i />{{ selectedProvider?.desktopAvailable ? '桌面可用' : selectedProvider?.transport === 'browser-direct' ? '仅 Chrome 可用' : '后台未配置' }}
            </span>
          </header>

          <div class="backend-source" :class="{ unavailable: !props.settings.providerCatalog.available }">
            <span class="backend-source-icon">↳</span>
            <div>
              <strong>{{ props.settings.providerCatalog.label }}</strong>
              <p v-if="props.settings.providerCatalog.available">前端只读取安全清单；连接地址与 API Key 不会进入页面。</p>
              <p v-else>{{ props.settings.providerCatalog.error || '本机 Provider 服务不可用。' }}</p>
            </div>
          </div>

          <div class="effective-route-summary">
            <div>
              <span>实际生效来源</span>
              <strong>{{ sourceLabel(props.settings.effectiveModelRoute.source) }}</strong>
            </div>
            <div>
              <span>模型链路</span>
              <strong>{{ props.settings.effectiveModelRoute.selections.map((selection) => selection.model).join(' → ') || '尚未配置' }}</strong>
            </div>
            <small v-if="props.settings.effectiveModelRoute.selections.some((selection) => !selection.desktopAvailable)">
              {{ props.settings.effectiveModelRoute.selections.find((selection) => !selection.desktopAvailable)?.availabilityReason || '链路中包含不可用模型' }}
            </small>
          </div>

          <div class="agent-settings-grid">
            <label>
              <span>主模型 Provider</span>
              <select v-model="form.providerId" :disabled="props.busy || !props.settings.providerCatalog.available" @change="onProviderChange">
                <option
                  v-for="provider in providers"
                  :key="provider.id"
                  :value="provider.id"
                  :disabled="!provider.desktopAvailable"
                >{{ provider.name }}{{ provider.free ? ' · 免费' : '' }}{{ provider.transport === 'browser-direct' ? ' · 仅 Chrome' : provider.configured ? '' : ' · 未配置' }}</option>
              </select>
              <small>提供商列表来自本机后台配置；未配置项不可选择。</small>
            </label>

            <label>
              <span>主模型</span>
              <select v-model="form.model" :disabled="props.busy || !selectedProvider?.desktopAvailable">
                <option v-for="model in selectedProvider?.models || []" :key="model" :value="model">{{ model }}</option>
              </select>
              <small>模型列表随 Provider 自动切换，不支持页面内手动输入。</small>
            </label>

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
          </div>

          <section class="fallback-settings" aria-label="Fallback 模型顺序">
            <header>
              <div><strong>Fallback</strong><small>主模型失败后按顺序尝试，最多 4 个。</small></div>
              <button class="btn btn-outline-secondary btn-sm" type="button" :disabled="props.busy || form.fallbacks.length >= 4" @click="addFallback">添加</button>
            </header>
            <p v-if="!form.fallbacks.length" class="fallback-empty">当前项目未配置 fallback。</p>
            <div v-for="(fallback, index) in form.fallbacks" :key="`${index}-${fallback.providerId}-${fallback.model}`" class="fallback-row">
              <span class="fallback-order">{{ index + 1 }}</span>
              <select v-model="fallback.providerId" :disabled="props.busy" aria-label="Fallback Provider" @change="updateFallbackProvider(index)">
                <option v-for="provider in providers" :key="provider.id" :value="provider.id" :disabled="!provider.desktopAvailable">{{ provider.name }}{{ provider.desktopAvailable ? '' : ' · 不可用' }}</option>
              </select>
              <select v-model="fallback.model" :disabled="props.busy" aria-label="Fallback 模型">
                <option v-for="model in providers.find((provider) => provider.id === fallback.providerId)?.models || []" :key="model" :value="model">{{ model }}</option>
              </select>
              <div class="fallback-actions">
                <button type="button" :disabled="props.busy || index === 0" title="上移" @click="moveFallback(index, -1)">↑</button>
                <button type="button" :disabled="props.busy || index === form.fallbacks.length - 1" title="下移" @click="moveFallback(index, 1)">↓</button>
                <button type="button" :disabled="props.busy" title="移除" @click="form.fallbacks.splice(index, 1)">×</button>
              </div>
            </div>
          </section>

          <div class="agent-card-actions">
            <small>仅保存到当前项目；其他项目和用户默认设置不受影响。</small>
            <button class="btn btn-primary btn-sm" type="button" :disabled="props.busy || !canSave" @click="saveProvider">保存项目链路</button>
          </div>

          <details class="model-diagnostics" :open="visibleDiagnostics.some((entry) => entry.level === 'error')">
            <summary>
              <span>模型诊断日志</span>
              <small>{{ visibleDiagnostics.length ? `最近 ${visibleDiagnostics.length} 条` : '暂无记录' }}</small>
            </summary>
            <div v-if="visibleDiagnostics.length" class="model-diagnostic-list">
              <article v-for="(entry, index) in visibleDiagnostics" :key="`${entry.at}-${entry.event}-${index}`" :class="{ error: entry.level === 'error' }">
                <i />
                <div>
                  <strong>{{ diagnosticLabel(entry) }}</strong>
                  <p>{{ diagnosticDetail(entry) }}</p>
                </div>
                <time>{{ diagnosticTime(entry.at) }}</time>
              </article>
            </div>
            <p v-else class="model-diagnostics-empty">运行一次 Agent 后，这里会显示脱敏的请求阶段、HTTP 状态、响应结构和失败原因。</p>
          </details>
        </article>
      </section>
    </template>
  </section>
</template>

<style scoped>
.agent-settings-view { max-width: 980px; }
.settings-group + .settings-group { margin-top: 30px; }
.settings-group-head,
.agent-summary-card,
.agent-summary-copy,
.agent-summary-meta,
.agent-model-head,
.agent-model-head > div,
.agent-card-actions,
.backend-source { display: flex; align-items: center; }
.settings-group-head { gap: 12px; margin-bottom: 12px; }
.settings-group-head h3,
.settings-group-head p,
.agent-summary-copy p,
.backend-source p { margin: 0; }
.settings-group-head h3 { font-size: 15px; }
.settings-group-head p,
.agent-summary-copy p,
.backend-source p { margin-top: 3px; color: var(--muted); font-size: 12px; }
.settings-group-mark {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-soft);
  color: var(--primary-text);
  font-size: 11px;
  font-weight: 700;
}
.agent-model-card,
.agent-summary-card { padding: 20px; }
.agent-summary-card { justify-content: space-between; gap: 24px; }
.agent-summary-copy { gap: 12px; min-width: 0; }
.agent-summary-copy strong { display: block; }
.agent-summary-meta { align-items: flex-end; flex: 0 0 auto; flex-direction: column; gap: 3px; }
.agent-summary-meta span { color: var(--muted); font-size: 11px; }
.agent-summary-meta strong { font-size: 13px; }
.agent-model-head { justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.agent-model-head > div { gap: 12px; }
.agent-model-head strong,
.agent-model-head small { display: block; }
.agent-model-head small,
.agent-card-actions small,
label span small { color: var(--muted); }
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
.connection-state { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); font-size: 12px; }
.connection-state i { width: 7px; height: 7px; border-radius: 50%; background: var(--danger); }
.connection-state.configured i { background: var(--complete); }
.backend-source {
  align-items: flex-start;
  gap: 11px;
  margin-bottom: 18px;
  padding: 13px 14px;
  border: 1px solid color-mix(in srgb, var(--primary) 34%, var(--border));
  border-radius: 10px;
  background: color-mix(in srgb, var(--primary) 7%, var(--surface-soft));
}
.backend-source.unavailable { border-color: color-mix(in srgb, var(--danger) 38%, var(--border)); }
.backend-source-icon { color: var(--primary-text); font-size: 17px; line-height: 1; }
.backend-source strong { font-size: 12px; }
.effective-route-summary { display: grid; grid-template-columns: minmax(0, .7fr) minmax(0, 1.3fr); gap: 10px 18px; margin-bottom: 18px; border-radius: 9px; background: var(--surface-soft); padding: 12px 14px; }
.effective-route-summary div { min-width: 0; }
.effective-route-summary span,
.effective-route-summary strong { display: block; }
.effective-route-summary span { margin-bottom: 3px; color: var(--muted); font-size: 10px; }
.effective-route-summary strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.effective-route-summary > small { grid-column: 1 / -1; color: var(--danger); font-size: 10px; }
.agent-settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.agent-settings-grid label { display: grid; gap: 7px; }
.agent-settings-grid label > span { font-size: 12px; font-weight: 600; }
.agent-settings-grid label > small { color: var(--muted); font-size: 10px; line-height: 1.45; }
.fallback-settings { margin-top: 20px; }
.fallback-settings > header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 9px; }
.fallback-settings > header strong,
.fallback-settings > header small { display: block; }
.fallback-settings > header strong { font-size: 12px; }
.fallback-settings > header small,
.fallback-empty { margin: 3px 0 0; color: var(--muted); font-size: 10px; }
.fallback-row { display: grid; grid-template-columns: 24px minmax(120px, .8fr) minmax(150px, 1.2fr) auto; align-items: center; gap: 8px; margin-top: 7px; }
.fallback-order { display: grid; width: 22px; height: 22px; place-items: center; border-radius: 50%; background: var(--surface-soft); color: var(--muted); font-size: 10px; }
.fallback-actions { display: flex; gap: 4px; }
.fallback-actions button { width: 26px; height: 26px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-soft); color: var(--muted); }
.fallback-actions button:hover:not(:disabled) { border-color: var(--primary); color: var(--text); }
.agent-card-actions { justify-content: space-between; gap: 16px; margin-top: 20px; padding: 16px 58px 0 0; border-top: 1px solid var(--border); }
.model-diagnostics { margin-top: 18px; border-top: 1px solid var(--border); padding-top: 14px; }
.model-diagnostics summary { display: flex; cursor: pointer; align-items: center; justify-content: space-between; color: var(--text); font-size: 12px; font-weight: 700; }
.model-diagnostics summary small { color: var(--muted); font-size: 10px; font-weight: 500; }
.model-diagnostic-list { display: grid; gap: 6px; margin-top: 12px; }
.model-diagnostic-list article { display: grid; grid-template-columns: 7px minmax(0, 1fr) auto; align-items: start; gap: 9px; border-radius: 7px; background: var(--surface-soft); padding: 9px 10px; }
.model-diagnostic-list article > i { width: 7px; height: 7px; margin-top: 4px; border-radius: 50%; background: var(--complete); }
.model-diagnostic-list article.error > i { background: var(--danger); }
.model-diagnostic-list strong { display: block; font-size: 10px; }
.model-diagnostic-list p { margin: 3px 0 0; overflow-wrap: anywhere; color: var(--muted); font-size: 10px; }
.model-diagnostic-list time { color: var(--muted); font-size: 9px; }
.model-diagnostics-empty { margin: 12px 0 0; color: var(--muted); font-size: 10px; }
@media (max-width: 800px) {
  .agent-settings-grid { grid-template-columns: 1fr; }
  .effective-route-summary { grid-template-columns: 1fr; }
  .fallback-row { grid-template-columns: 24px 1fr; }
  .fallback-row select,
  .fallback-actions { grid-column: 2; }
  .agent-summary-card { align-items: flex-start; flex-direction: column; }
  .agent-card-actions { align-items: stretch; flex-direction: column; padding-right: 0; }
}
</style>
