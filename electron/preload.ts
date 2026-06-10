import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  setStore: (key: string, value: string) => ipcRenderer.invoke('store:set', key, value),
  getStore: (key: string) => ipcRenderer.invoke('store:get', key),
  deleteStore: (key: string) => ipcRenderer.invoke('store:delete', key),
  // 加密存储（用于 API Key 等敏感数据）
  secureGet: (key: string): Promise<string> => ipcRenderer.invoke('secure-storage:get', key),
  secureSet: (key: string, value: string): Promise<boolean> => ipcRenderer.invoke('secure-storage:set', key, value),
  secureDelete: (key: string): Promise<boolean> => ipcRenderer.invoke('secure-storage:delete', key),
  secureAvailable: (): Promise<boolean> => ipcRenderer.invoke('secure-storage:available'),
  selectAvatar: () => ipcRenderer.invoke('avatar:select'),
  getAvatar: () => ipcRenderer.invoke('avatar:get'),
  selectFiles: () => ipcRenderer.invoke('file:select'),
  parseFiles: (paths: string[]) => ipcRenderer.invoke('file:parse', paths),
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  exportSession: (session: any, format: 'md' | 'html') => ipcRenderer.invoke('export:session', session, format),
  exportMessage: (msg: any, format: 'md' | 'html') => ipcRenderer.invoke('export:message', msg, format),
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
  describeImage: (config: { path: string; apiKey: string; baseUrl: string; model: string }) =>
    ipcRenderer.invoke('image:describe', config),
  saveClipboardImage: (data: { base64: string; ext: string }) =>
    ipcRenderer.invoke('image:saveClipboard', data),
  observationsAppend: (event: Record<string, unknown>) => ipcRenderer.invoke('observations:append', event),
  observationsAppendBatch: (events: Record<string, unknown>[]) => ipcRenderer.invoke('observations:appendBatch', events),
  observationsFlush: () => ipcRenderer.invoke('observations:flush'),
})
