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
    webSearch: (query: string) => Promise<SearchResult[]>
    fetchUrl: (url: string) => Promise<string>
    selectAvatar: () => Promise<string | null>
    getAvatar: () => Promise<string | null>
    selectFiles: () => Promise<FileInfo[]>
    parseFiles: (paths: string[]) => Promise<ParsedFile[]>
    getFilePath: (file: File) => string
    exportSession: (session: any, format: 'md' | 'html') => Promise<boolean>
    listSkills: () => Promise<import('../electron/ipc/skills').SkillMeta[]>
    importSkill: (url: string) => Promise<import('../electron/ipc/skills').SkillMeta | null>
    saveSkill: (skill: import('../electron/ipc/skills').SkillMeta) => Promise<boolean>
    deleteSkill: (id: string) => Promise<boolean>
  }
}
