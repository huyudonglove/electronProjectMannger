import { computed, ref, watch, type Ref } from 'vue'
import type { AnyRecord } from '../utils/record-formatters'

export type CompanionPage = 'home' | 'tasks' | 'thoughts' | 'collaboration' | 'logs'
export type CompanionRecordKind = 'task' | 'thought' | 'question' | 'decision' | 'risk' | 'log'

export function useCompanionNavigation(options: {
  currentVersion: Readonly<Ref<AnyRecord | null>>
  tasks: Readonly<Ref<AnyRecord[]>>
  thoughts: Readonly<Ref<AnyRecord[]>>
  collaborationItems: Readonly<Ref<AnyRecord[]>>
  logs: Readonly<Ref<AnyRecord[]>>
  showToast: (message: string) => void
}) {
  const page = ref<CompanionPage>('home')
  const detailKind = ref<CompanionRecordKind | null>(null)
  const detailRecordKey = ref('')
  const detailSourcePage = ref<CompanionPage>('home')

  const detailRecord = computed(() => {
    let source = options.collaborationItems.value
    if (detailKind.value === 'task') source = options.tasks.value
    if (detailKind.value === 'thought') source = options.thoughts.value
    if (detailKind.value === 'log') source = options.logs.value
    return source.find((record) => recordKey(record) === detailRecordKey.value) || null
  })

  const showingDetail = computed(() => Boolean(detailKind.value && detailRecord.value))
  const canGoBack = computed(() => page.value !== 'home' || showingDetail.value)

  function openPage(nextPage: CompanionPage) {
    clearDetail()
    page.value = nextPage
  }

  function openRecord(kind: CompanionRecordKind, record: AnyRecord) {
    detailSourcePage.value = page.value
    detailRecordKey.value = recordKey(record)
    detailKind.value = kind
  }

  function back() {
    if (detailKind.value) {
      page.value = detailSourcePage.value
      clearDetail()
      return
    }
    page.value = 'home'
  }

  function openQuestionTarget(item: AnyRecord) {
    const relation = (item.relations || []).find((value: string) => /^[TL]\d+$/i.test(value))
    if (!relation) {
      options.showToast('陪伴模式中没有可查看的关联记录')
      return
    }
    if (/^L/i.test(relation)) {
      const log = options.logs.value.find((record) => record.shortId === relation)
      if (log) return openRecord('log', log)
    } else {
      const task = options.tasks.value.find((record) => record.shortId === relation)
      if (task) return openRecord('task', task)
    }
    options.showToast('当前版本未找到关联记录')
  }

  function reset() {
    page.value = 'home'
    clearDetail()
  }

  function clearDetail() {
    detailKind.value = null
    detailRecordKey.value = ''
  }

  watch(
    () => options.currentVersion.value?.shortId,
    reset,
  )

  watch(detailRecord, (record) => {
    if (detailKind.value && !record) back()
    if (
      record
      && ['question', 'decision'].includes(detailKind.value || '')
      && ['question', 'decision'].includes(record.companionTargetKind)
    ) {
      detailKind.value = record.companionTargetKind
    }
  })

  return {
    page,
    detailKind,
    detailRecord,
    showingDetail,
    canGoBack,
    openPage,
    openRecord,
    openQuestionTarget,
    back,
    reset,
  }
}

function recordKey(record: AnyRecord) {
  return String(record.id || record.shortId || '')
}
