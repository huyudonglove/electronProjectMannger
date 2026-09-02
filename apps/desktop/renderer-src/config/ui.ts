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
  description: string
}

export const boardColumns = [
  ['todo', 'Todo'],
  ['doing', 'Doing'],
  ['done', 'Done'],
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
])

export const createLabels: Readonly<Record<string, string>> = {
  overview: '新建',
  board: '新建任务',
  dialogues: '新建研究',
  collaboration: '新建协作',
  capture: '记录想法',
  constraints: '新建约束',
}

export const pageMetaBySection: Readonly<Record<string, PageMeta>> = {
  overview: { title: '总览', description: '聚焦当前版本的进展和需要处理的事项' },
  board: { title: '任务', description: '按状态推进当前版本的工作' },
  dialogues: { title: '研究', description: '记录问题、证据与结论' },
  collaboration: { title: '协作', description: '集中处理决策、回复和风险' },
  capture: { title: '想法', description: '保留未整理的输入和初步判断' },
  'work-logs': { title: '工作记录', description: '回看执行过程、改动与验证' },
  documents: { title: '文档', description: '浏览项目产出的长文档' },
  knowledge: { title: '知识库', description: '跨版本沉淀可复用的项目知识' },
  versions: { title: '版本', description: '管理项目阶段与状态' },
  constraints: { title: '约束', description: '维护项目需要长期遵守的规则' },
}

export const defaultPageMeta: PageMeta = { title: '总览', description: '' }
