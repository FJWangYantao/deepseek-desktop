const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  setStore: (key, value) => ipcRenderer.invoke('store:set', key, value),
  getStore: (key) => ipcRenderer.invoke('store:get', key),
  deleteStore: (key) => ipcRenderer.invoke('store:delete', key),
  selectAvatar: () => ipcRenderer.invoke('avatar:select'),
  getAvatar: () => ipcRenderer.invoke('avatar:get'),
  selectFiles: () => ipcRenderer.invoke('file:select'),
  parseFiles: (paths) => ipcRenderer.invoke('file:parse', paths),
  getFilePath: (file) => webUtils.getPathForFile(file),
  exportSession: (session, format) => ipcRenderer.invoke('export:session', session, format),
  listSkills: () => ipcRenderer.invoke('skills:list'),
  importSkill: (url) => ipcRenderer.invoke('skills:import', url),
  saveSkill: (skill) => ipcRenderer.invoke('skills:save', skill),
  deleteSkill: (id) => ipcRenderer.invoke('skills:delete', id),
  mcpToolCall: (request) => ipcRenderer.invoke('mcp:tool-call', request),
  toolsList: () => ipcRenderer.invoke('tools:list'),
  toolsCall: (request) => ipcRenderer.invoke('tools:call', request),
  toolsCallApproved: (request) => ipcRenderer.invoke('tools:call-approved', request),
  toolsGetPermissionConfig: () => ipcRenderer.invoke('tools:getPermissionConfig'),
  toolsSetPermissionConfig: (config) => ipcRenderer.invoke('tools:setPermissionConfig', config),
  tokenizerCount: (text) => ipcRenderer.invoke('tokenizer:count', text),
})
