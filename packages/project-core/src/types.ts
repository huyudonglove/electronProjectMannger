export type ProjectConfig = {
  projectId: string
  name: string
  projectRoot: string
  dataRoot: string
  createdAt: string
  schemaVersion: 3
  currentVersionId: string
}

export type ProjectWorkLevel = 'light' | 'standard' | 'deep'
export type ProjectDepthReason = 'architecture' | 'migration' | 'cross_system' | 'security' | 'irreversible' | 'decision'

export type ProjectTask = {
  id: string
  shortId: string
  title: string
  status: string
  priority: string
  workLevel: ProjectWorkLevel
  depthReason: ProjectDepthReason | ''
  area: string
  updated: string
  version: string
  userOriginal: string
  detail: string
  acceptance: string
  constraints: string
  planRollback: string
}

export type ProjectThought = {
  id: string
  shortId: string
  title: string
  status: string
  created: string
  version: string
  content: string
  answer: string
}

export type ProjectLogLevel = ProjectWorkLevel

export type ProjectLog = {
  shortId: string
  title: string
  created: string
  status: string
  source: string
  recordLevel: ProjectLogLevel
  version: string
  userGoal: string
  result: string
  decisions: string[]
  changedFiles: string[]
  verification: string[]
  relatedTasks: Array<{ shortId: string; id: string; title: string; status: string }>
  content: string
}

export type ProjectDialogue = {
  id: string
  shortId: string
  title: string
  created: string
  updated: string
  version: string
  status: ResearchStatus
  mode: ResearchMode
  tags: string[]
  relatedTasks: string[]
  relatedThoughts: string[]
  relatedDocuments: string[]
  recordContent: string
  answer: string
  acceptance: string
  content: string
}

export type ResearchMode = 'breadth' | 'depth' | 'legacy'
export type ResearchStatus = 'pending' | 'doing' | 'done' | 'archived'

export type ProjectDocumentNote = {
  path: string
  folder: string
  title: string
  type: string
  status: string
  shortId: string
  updated: string
  version: string
  tags: string[]
  summary: string
  content: string
}

export type ProjectKnowledgeNote = ProjectDocumentNote & {
  id: string
  aliases: string[]
  sourceProject: string
  source: string
  relatedRecords: string[]
  relatedTasks: string[]
  relatedNotes: string[]
}

export type ProjectConstraint = {
  id: string
  shortId: string
  title: string
  status: string
  scope: string
  version: string
  source: 'user' | 'system'
  created: string
  updated: string
  path: string
  summary: string
  content: string
}

export type ProjectOpenQuestion = {
  id: string
  displayId: string
  shortId: string
  title: string
  question: string
  background: string
  recommendation: string
  conclusion: string
  status: 'open' | 'decided' | 'resolved' | 'expired'
  kind: 'decision' | 'clarification' | 'blocker'
  scope: 'version' | 'project'
  version: string
  blocking: boolean
  created: string
  updated: string
  relations: string[]
  origin: 'user' | 'agent'
  messages: ProjectQuestionMessage[]
}

export type ProjectQuestionMessage = {
  id: string
  role: 'user' | 'agent' | 'system'
  created: string
  content: string
}

export type ProjectRisk = {
  id: string
  shortId: string
  title: string
  kind: 'risk' | 'verification' | 'follow-up'
  status: 'open' | 'resolved' | 'expired'
  version: string
  content: string
  handling: string
  created: string
  updated: string
  relations: string[]
}

export type ProjectRiskSummary = Pick<
  ProjectRisk,
  'id' | 'shortId' | 'title' | 'kind' | 'status' | 'version' | 'updated' | 'relations'
>

export type ProjectVersion = {
  id: string
  shortId: string
  label: string
  title: string
  status: 'active' | 'completed'
  created: string
  completed: string
  goal: string
  summary: string
  outcomes: string[]
  followUps: string[]
}

export type AgentBrief = {
  generatedAt: string
  projectRoot: string
  dataRoot: string
  knowledgeRoot: string
  skillPath: string
  baselinePath: string
  currentVersionRoot: string
  currentDataPaths: {
    tasks: string
    thoughts: string
    research: string
    questions: string
    risks: string
    workLogs: string
  }
  currentVersion: ProjectVersion | null
  activeTasks: ProjectTask[]
  activeResearch: ProjectDialogue[]
  openQuestions: ProjectOpenQuestion[]
  pendingDecisions: ProjectOpenQuestion[]
  activeRisks: ProjectRiskSummary[]
  latestLogs: string[]
  instructions: string[]
}

export type Dashboard = {
  config: ProjectConfig
  tasks: ProjectTask[]
  thoughts: ProjectThought[]
  dialogues: ProjectDialogue[]
  knowledge: ProjectKnowledgeNote[]
  documents: ProjectDocumentNote[]
  constraints: ProjectConstraint[]
  logs: ProjectLog[]
  versions: ProjectVersion[]
  currentVersion: ProjectVersion | null
  questions: ProjectOpenQuestion[]
  risks: ProjectRisk[]
  activeTasks: ProjectTask[]
  activeResearch: ProjectDialogue[]
  openQuestions: AgentBrief['openQuestions']
  latestLogs: string[]
  agentBrief: AgentBrief
}

export type ManagedProject = {
  projectId: string
  projectName: string
  projectRoot: string
  dataRoot: string
  createdAt: string
  lastOpenedAt: string
}

export type ProjectGuidanceSyncResult = {
  projectId: string
  projectName: string
  projectRoot: string
  status: 'updated' | 'failed'
  error: string
}

export type NewTaskInput = {
  title: string
  status?: string
  priority?: string
  workLevel?: ProjectWorkLevel
  depthReason?: ProjectDepthReason
  area?: string
  userOriginal?: string
  executionDefinition?: string
  acceptance?: string
  constraints?: string
  planRollback?: string
}

export type NewDialogueInput = {
  content: string
  acceptance?: string
  mode?: Exclude<ResearchMode, 'legacy'>
}

export type NewConstraintInput = {
  title: string
  content: string
  status?: string
  scope?: string
}

export type OpenQuestionReplyInput = {
  questionId: string
  answer: string
}

export type NewVersionInput = {
  label: string
  title: string
  goal: string
  summary?: string
}

export type NewQuestionInput = {
  title: string
  question: string
  background?: string
  recommendation?: string
  kind?: ProjectOpenQuestion['kind']
  scope?: ProjectOpenQuestion['scope']
  blocking?: boolean
  relations?: string[]
  origin?: 'user' | 'agent'
}

export type ProjectTaskStatusUpdateInput = {
  taskId: string
  taskShortId?: string
  expectedStatus: string
  expectedUpdated: string
  nextStatus: 'todo' | 'doing' | 'done'
}

export type ProjectRunLogInput = {
  source: string
  idempotencyKey: string
  title: string
  taskId: string
  taskShortId: string
  version: string
  recordLevel: ProjectLogLevel
  result: string[]
  changedFiles: string[]
  verification: string[]
  decisions: string[]
}

export type ProjectRunCompletionUpdateInput = {
  taskUpdate?: ProjectTaskStatusUpdateInput
  log: ProjectRunLogInput
}

export type ProjectRunUpdateResult = {
  applied: boolean
  taskUpdated: boolean
  logCreated: boolean
  logShortId?: string
  dashboard: Dashboard
}
