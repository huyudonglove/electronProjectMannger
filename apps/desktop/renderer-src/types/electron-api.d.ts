export type ElectronRecord = Record<string, any>

export type CompanionWindowState = {
  enabled: boolean
  alwaysOnTop: boolean
}

export interface ElectronManagerApi {
  getCompanionWindowState: () => Promise<CompanionWindowState>
  setCompanionMode: (enabled: boolean) => Promise<CompanionWindowState>
  setCompanionAlwaysOnTop: (alwaysOnTop: boolean) => Promise<CompanionWindowState>
  openFolder: () => Promise<any>
  listRecentProjects: () => Promise<any[]>
  removeRecentProject: (projectId: string) => Promise<any[]>
  openPath: (projectRoot: string) => Promise<any>
  openFolderPath: (folderPath: string) => Promise<boolean>
  initProject: (projectRoot: string) => Promise<any>
  getDashboard: (projectRoot: string) => Promise<any>
  createVersion: (projectRoot: string, payload: ElectronRecord) => Promise<any>
  updateVersionStatus: (projectRoot: string, versionId: string, status: string) => Promise<any>
  addQuestion: (projectRoot: string, payload: ElectronRecord) => Promise<any>
  updateQuestionStatus: (projectRoot: string, questionId: string, status: string) => Promise<any>
  updateRiskStatus: (projectRoot: string, riskId: string, status: string) => Promise<any>
  addTask: (projectRoot: string, payload: ElectronRecord) => Promise<any>
  updateTaskStatus: (projectRoot: string, taskId: string, status: string) => Promise<any>
  deleteTask: (projectRoot: string, taskId: string) => Promise<any>
  addThought: (projectRoot: string, payload: ElectronRecord) => Promise<any>
  deleteThought: (projectRoot: string, thoughtId: string) => Promise<any>
  addDialogue: (projectRoot: string, payload: ElectronRecord) => Promise<any>
  deleteDialogue: (projectRoot: string, dialogueId: string) => Promise<any>
  addConstraint: (projectRoot: string, payload: ElectronRecord) => Promise<any>
  deleteConstraint: (projectRoot: string, constraintId: string) => Promise<any>
  deleteDocument: (projectRoot: string, documentTarget: string) => Promise<any>
  deleteKnowledge: (projectRoot: string, knowledgeTarget: string) => Promise<any>
  replyOpenQuestion: (projectRoot: string, payload: ElectronRecord) => Promise<any>
  onProjectDataChanged?: (callback: (payload: ElectronRecord) => void) => () => void
}

declare global {
  interface Window {
    electronManager?: ElectronManagerApi
  }
}
