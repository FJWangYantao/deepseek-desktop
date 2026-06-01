/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface Window {
  electronAPI?: {
    setStore: (key: string, value: string) => Promise<boolean>
    getStore: (key: string) => Promise<string | null>
    deleteStore: (key: string) => Promise<boolean>
  }
}
