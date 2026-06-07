import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  setStore: (key: string, value: string) => ipcRenderer.invoke('store:set', key, value),
  getStore: (key: string) => ipcRenderer.invoke('store:get', key),
  deleteStore: (key: string) => ipcRenderer.invoke('store:delete', key),
  selectAvatar: () => ipcRenderer.invoke('avatar:select'),
  getAvatar: () => ipcRenderer.invoke('avatar:get'),
  selectFiles: () => ipcRenderer.invoke('file:select'),
  parseFiles: (paths: string[]) => ipcRenderer.invoke('file:parse', paths),
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  exportSession: (session: any, format: 'md' | 'html') => ipcRenderer.invoke('export:session', session, format),
  listSkills: () => ipcRenderer.invoke('skills:list'),
  importSkill: (url: string) => ipcRenderer.invoke('skills:import', url),
  saveSkill: (skill: any) => ipcRenderer.invoke('skills:save', skill),
  deleteSkill: (id: string) => ipcRenderer.invoke('skills:delete', id),
  mcpToolCall: (request: { serverId: string; toolName: string; params: Record<string, string> }) =>
    ipcRenderer.invoke('mcp:tool-call', request),
  toolsList: () => ipcRenderer.invoke('tools:list'),
  toolsCall: (request: any) => ipcRenderer.invoke('tools:call', request),
  toolsCallApproved: (request: any) => ipcRenderer.invoke('tools:call-approved', request),
  toolsGetPermissionConfig: () => ipcRenderer.invoke('tools:getPermissionConfig'),
  toolsSetPermissionConfig: (config: any) => ipcRenderer.invoke('tools:setPermissionConfig', config),
  tokenizerCount: (text: string) => ipcRenderer.invoke('tokenizer:count', text),
})
