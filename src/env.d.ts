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
    listSkills: () => Promise<import('../src/types/skills').LegacySkillMeta[]>
    importSkill: (url: string) => Promise<import('../src/types/skills').LegacySkillMeta | null>
    saveSkill: (skill: import('../src/types/skills').LegacySkillMeta) => Promise<boolean>
    deleteSkill: (id: string) => Promise<boolean>
    listSkillIndex: () => Promise<import('../src/types/skills').SkillIndex[]>
    getSkillPackage: (id: string) => Promise<import('../src/types/skills').SkillPackage | null>
    createSkillPackage: (payload: { id: string; readme: string }) => Promise<import('../src/types/skills').SkillPackage | null>
    saveSkillPackage: (payload: { id: string; readme: string }) => Promise<boolean>
    importSkillPackageUrl: (url: string) => Promise<import('../src/types/skills').SkillPackage | null>
    migrateLegacySkill: (id: string) => Promise<import('../src/types/skills').SkillPackage | null>
    readSkillResource: (payload: { id: string; path: string }) => Promise<import('../src/types/skills').SkillResourceReadResult>
    validateSkill: (id: string) => Promise<import('../src/types/skills').SkillValidationResult>
    // ClawHub registry
    clawHubSearch: (payload: { query?: string; cursor?: string; limit?: number; token?: string; baseUrl?: string }) =>
      Promise<import('../electron/skills/clawhub/types').ClawHubListResponse | { error: string }>
    clawHubGetSkill: (payload: { slug: string; token?: string; baseUrl?: string }) =>
      Promise<import('../electron/skills/clawhub/types').ClawHubSkillDetail | { error: string }>
    clawHubGetVersion: (payload: { slug: string; version: string; token?: string; baseUrl?: string }) =>
      Promise<import('../electron/skills/clawhub/types').ClawHubVersionDetail | { error: string }>
    clawHubInstall: (payload: { slug: string; version?: string; overwrite?: boolean; token?: string; baseUrl?: string }) =>
      Promise<import('../electron/skills/clawhub/types').ClawHubInstallResult>
    clawHubUninstall: (slug: string) => Promise<boolean>
    clawHubListInstalled: () => Promise<import('../electron/skills/clawhub/types').ClawHubLock>
    // Skill 运行时：trust / env / deps（P2）
    skillTrustList: () => Promise<import('../electron/skills/runtime/trust-store').TrustStore>
    skillTrustSet: (payload: { skillId: string; decision: 'trusted' | 'denied' }) => Promise<boolean>
    skillTrustRevoke: (skillId: string) => Promise<boolean>
    skillEnvGet: () => Promise<import('../electron/skills/runtime/env-resolver').SkillEnvConfig>
    skillEnvSet: (payload: { skillId: string; name: string; value: string | null }) => Promise<boolean>
    skillEnvSetGlobal: (payload: { name: string; value: string | null }) => Promise<boolean>
    skillCheckDeps: (skillId: string) => Promise<import('../electron/skills/runtime/deps-check').SkillDepsReport>
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
    // 划词助手
    assistantOnText: (callback: (text: string) => void) => void
    assistantHide: () => Promise<void>
    assistantQuery: (text: string, action: string) => Promise<string>
    assistantResize: (width: number, height: number) => Promise<void>
  }
}
