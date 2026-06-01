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

interface Window {
  electronAPI?: {
    setStore: (key: string, value: string) => Promise<boolean>
    getStore: (key: string) => Promise<string | null>
    deleteStore: (key: string) => Promise<boolean>
    webSearch: (query: string) => Promise<SearchResult[]>
    fetchUrl: (url: string) => Promise<string>
  }
}
