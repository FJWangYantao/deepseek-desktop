export type MemoryLayer = 'short' | 'medium' | 'long'

export interface MemoryItem {
  id: string
  content: string
  layer: MemoryLayer
  category: string
  keywords: string[]
  createdAt: number
  lastAccessedAt: number
  accessCount: number
}

export interface DreamLog {
  timestamp: number
  beforeCount: number
  afterCount: number
  categories: string[]
}

export interface MemoryStore {
  items: MemoryItem[]
  lastExtractionAt: number
  dreamLogs: DreamLog[]
  newSinceLastDream: number
}
