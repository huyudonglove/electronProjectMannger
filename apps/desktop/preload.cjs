const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronManager', {
  openFolder: () => ipcRenderer.invoke('project:open-folder'),
  listRecentProjects: () => ipcRenderer.invoke('project:list-recent'),
  removeRecentProject: (projectId) => ipcRenderer.invoke('project:remove-recent', projectId),
  openPath: (projectRoot) => ipcRenderer.invoke('project:open-path', projectRoot),
  openFolderPath: (folderPath) => ipcRenderer.invoke('system:open-folder', folderPath),
  initProject: (projectRoot) => ipcRenderer.invoke('project:init', projectRoot),
  refreshBrief: (projectRoot) => ipcRenderer.invoke('project:refresh-brief', projectRoot),
  getDashboard: (projectRoot) => ipcRenderer.invoke('project:get-dashboard', projectRoot),
  updateGuidance: (projectRoot) => ipcRenderer.invoke('project:update-guidance', projectRoot),
  createVersion: (projectRoot, payload) => ipcRenderer.invoke('project:create-version', projectRoot, payload),
  addQuestion: (projectRoot, payload) => ipcRenderer.invoke('project:add-question', projectRoot, payload),
  updateQuestionStatus: (projectRoot, questionId, status) =>
    ipcRenderer.invoke('project:update-question-status', projectRoot, questionId, status),
  updateRiskStatus: (projectRoot, riskId, status) =>
    ipcRenderer.invoke('project:update-risk-status', projectRoot, riskId, status),
  addTask: (projectRoot, payload) => ipcRenderer.invoke('project:add-task', projectRoot, payload),
  updateTaskStatus: (projectRoot, taskId, status) =>
    ipcRenderer.invoke('project:update-task-status', projectRoot, taskId, status),
  deleteTask: (projectRoot, taskId) => ipcRenderer.invoke('project:delete-task', projectRoot, taskId),
  addThought: (projectRoot, content) => ipcRenderer.invoke('project:add-thought', projectRoot, content),
  addDialogue: (projectRoot, payload) => ipcRenderer.invoke('project:add-dialogue', projectRoot, payload),
  deleteDialogue: (projectRoot, dialogueId) => ipcRenderer.invoke('project:delete-dialogue', projectRoot, dialogueId),
  addConstraint: (projectRoot, payload) => ipcRenderer.invoke('project:add-constraint', projectRoot, payload),
  deleteConstraint: (projectRoot, constraintId) => ipcRenderer.invoke('project:delete-constraint', projectRoot, constraintId),
  deleteDocument: (projectRoot, documentTarget) => ipcRenderer.invoke('project:delete-document', projectRoot, documentTarget),
  deleteKnowledge: (projectRoot, knowledgeTarget) => ipcRenderer.invoke('project:delete-knowledge', projectRoot, knowledgeTarget),
  deleteThought: (projectRoot, thoughtId) => ipcRenderer.invoke('project:delete-thought', projectRoot, thoughtId),
  replyOpenQuestion: (projectRoot, payload) => ipcRenderer.invoke('project:reply-open-question', projectRoot, payload),
  onProjectDataChanged: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('project:data-changed', listener)
    return () => ipcRenderer.removeListener('project:data-changed', listener)
  },
})
