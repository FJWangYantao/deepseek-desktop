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
  listSkillIndex: () => ipcRenderer.invoke('skills:list-index'),
  getSkillPackage: (id: string) => ipcRenderer.invoke('skills:get-package', id),
  createSkillPackage: (payload: { id: string; readme: string }) => ipcRenderer.invoke('skills:create-package', payload),
  saveSkillPackage: (payload: { id: string; readme: string }) => ipcRenderer.invoke('skills:save-package', payload),
  importSkillPackageUrl: (url: string) => ipcRenderer.invoke('skills:import-package-url', url),
  migrateLegacySkill: (id: string) => ipcRenderer.invoke('skills:migrate-legacy', id),
  readSkillResource: (payload: { id: string; path: string }) => ipcRenderer.invoke('skills:read-resource', payload),
  validateSkill: (id: string) => ipcRenderer.invoke('skills:validate', id),
  // ClawHub registry
  clawHubSearch: (payload: { query?: string; cursor?: string; limit?: number; token?: string; baseUrl?: string }) =>
    ipcRenderer.invoke('clawhub:search', payload),
  clawHubGetSkill: (payload: { slug: string; token?: string; baseUrl?: string }) =>
    ipcRenderer.invoke('clawhub:get-skill', payload),
  clawHubGetVersion: (payload: { slug: string; version: string; token?: string; baseUrl?: string }) =>
    ipcRenderer.invoke('clawhub:get-version', payload),
  clawHubInstall: (payload: { slug: string; version?: string; overwrite?: boolean; token?: string; baseUrl?: string }) =>
    ipcRenderer.invoke('clawhub:install', payload),
  clawHubUninstall: (slug: string) => ipcRenderer.invoke('clawhub:uninstall', slug),
  clawHubListInstalled: () => ipcRenderer.invoke('clawhub:list-installed'),
  // Skill 运行时：trust / env / deps（P2）
  skillTrustList: () => ipcRenderer.invoke('skills:trust-list'),
  skillTrustSet: (payload: { skillId: string; decision: 'trusted' | 'denied' }) => ipcRenderer.invoke('skills:trust-set', payload),
  skillTrustRevoke: (skillId: string) => ipcRenderer.invoke('skills:trust-revoke', skillId),
  skillEnvGet: () => ipcRenderer.invoke('skills:env-get'),
  skillEnvSet: (payload: { skillId: string; name: string; value: string | null }) => ipcRenderer.invoke('skills:env-set', payload),
  skillEnvSetGlobal: (payload: { name: string; value: string | null }) => ipcRenderer.invoke('skills:env-set-global', payload),
  skillCheckDeps: (skillId: string) => ipcRenderer.invoke('skills:check-deps', skillId),
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
  // 划词助手
  assistantOnText: (callback: (text: string) => void) => {
    ipcRenderer.on('assistant:text-captured', (_e, text: string) => callback(text))
  },
  assistantHide: () => ipcRenderer.invoke('assistant:hide'),
  assistantQuery: (text: string, action: string) => ipcRenderer.invoke('assistant:query', text, action),
  assistantResize: (width: number, height: number) => ipcRenderer.invoke('assistant:resize', width, height),
})
