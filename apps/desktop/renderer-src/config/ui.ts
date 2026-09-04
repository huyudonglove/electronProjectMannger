export type SelectOption = {
  label: string
  value: string
  disabled?: boolean
}

export type NavigationItem = readonly [key: string, label: string, icon: string]

export type NavigationGroup = {
  label: string
  items: readonly NavigationItem[]
}

export type PageMeta = {
  title: string
}

export const boardColumns = [
  ['todo', '待办'],
  ['doing', '进行中'],
  ['done', '已完成'],
] as const

export const versionStatusOptions: SelectOption[] = [
  { label: '规划中', value: 'planned' },
  { label: '进行中', value: 'active' },
  { label: '已暂停', value: 'paused' },
  { label: '已完成', value: 'completed' },
]

export const questionKindOptions: SelectOption[] = [
  { label: '决策', value: 'decision' },
  { label: '澄清', value: 'clarification' },
  { label: '阻塞', value: 'blocker' },
]

export const questionScopeOptions: SelectOption[] = [
  { label: '所选版本', value: 'version' },
  { label: '整个项目', value: 'project' },
]

export const navigationGroups = [
  {
    label: '工作',
    items: [
      ['overview', '总览', 'layoutDashboard'],
      ['board', '任务', 'listChecks'],
      ['dialogues', '研究', 'messagesSquare'],
      ['collaboration', '协作', 'gitPullRequest'],
    ],
  },
  {
    label: '记录库',
    items: [
      ['capture', '想法', 'messageCircle'],
      ['work-logs', '工作记录', 'scrollText'],
      ['documents', '文档', 'fileText'],
    ],
  },
  {
    label: '项目',
    items: [
      ['versions', '版本', 'layers'],
      ['constraints', '约束', 'shield'],
    ],
  },
] as const satisfies readonly NavigationGroup[]

export const knowledgeNavigationItem = ['knowledge', '知识库', 'bookOpen'] as const satisfies NavigationItem

export const versionScopedSections: ReadonlySet<string> = new Set([
  'overview',
  'board',
  'dialogues',
  'collaboration',
  'capture',
  'work-logs',
  'documents',
  'constraints',
  'versions',
])

export const createLabels: Readonly<Record<string, string>> = {
  overview: '新增',
  board: '新增',
  dialogues: '新增',
  collaboration: '新增',
  capture: '新增',
  constraints: '新增',
}

export const pageMetaBySection: Readonly<Record<string, PageMeta>> = {
  overview: { title: '总览' },
  board: { title: '任务' },
  dialogues: { title: '研究' },
  collaboration: { title: '协作' },
  capture: { title: '想法' },
  'work-logs': { title: '工作记录' },
  documents: { title: '文档' },
  knowledge: { title: '知识库' },
  versions: { title: '版本' },
  constraints: { title: '约束' },
}

export const defaultPageMeta: PageMeta = { title: '总览' }
