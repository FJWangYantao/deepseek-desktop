/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface SearchResult {
  title: string
  url: string
  snippet: string
  content: string
}

interface FileInfo {
  path: string
  name: string
  size: number
  ext: string
}

interface ParsedFile {
  name: string
  ext: string
  text: string
}

interface Window {
  electronAPI?: {
    setStore: (key: string, value: string) => Promise<boolean>
    getStore: (key: string) => Promise<string | null>
    deleteStore: (key: string) => Promise<boolean>
    secureGet: (key: string) => Promise<string>
    secureSet: (key: string, value: string) => Promise<boolean>
    secureDelete: (key: string) => Promise<boolean>
    secureAvailable: () => Promise<boolean>
    selectAvatar: () => Promise<string | null>
    getAvatar: () => Promise<string | null>
    selectFiles: () => Promise<FileInfo[]>
    parseFiles: (paths: string[]) => Promise<ParsedFile[]>
    getFilePath: (file: File) => string
    exportSession: (session: any, format: 'md' | 'html') => Promise<boolean>
    exportMessage: (msg: import('../src/types').Message, format: 'md' | 'html') => Promise<boolean>
    listSkills: () => Promise<import('../electron/ipc/skills').SkillMeta[]>
    importSkill: (url: string) => Promise<import('../electron/ipc/skills').SkillMeta | null>
    saveSkill: (skill: import('../electron/ipc/skills').SkillMeta) => Promise<boolean>
    deleteSkill: (id: string) => Promise<boolean>
    mcpToolCall: (request: { serverId: string; toolName: string; params: Record<string, string> }) => Promise<{ success: boolean; data?: unknown; error?: string }>
    toolsList: () => Promise<import('../src/types/tools').ToolListResponse>
    toolsCall: (request: import('../src/types/tools').ToolCallRequest) => Promise<import('../src/types/tools').ToolCallResult>
    toolsCallApproved: (request: import('../src/types/tools').ToolCallRequest) => Promise<import('../src/types/tools').ToolCallResult>
    toolsGetPermissionConfig: () => Promise<import('../src/types/tools').ToolPermissionConfig>
    toolsSetPermissionConfig: (config: import('../src/types/tools').ToolPermissionConfig) => Promise<boolean>
    tokenizerCount: (text: string) => Promise<number>
    describeImage: (config: { path: string; apiKey: string; baseUrl: string; model: string }) => Promise<{ description: string; error?: string }>
    saveClipboardImage: (data: { base64: string; ext: string }) => Promise<string>
    observationsAppend: (event: import('../src/types/observation').ObservationEvent) => Promise<import('../src/types/observation').ObservationAppendResult>
    observationsAppendBatch: (events: import('../src/types/observation').ObservationEvent[]) => Promise<import('../src/types/observation').ObservationAppendResult>
    observationsFlush: () => Promise<{ ok: boolean }>
  }
}
