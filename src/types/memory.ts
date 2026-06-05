export type MemoryLayer = 'short' | 'medium' | 'long'
export type SortMode = 'createdAt' | 'lastAccessedAt' | 'accessCount'

export interface MemoryItem {
  id: string
  content: string
  layer: MemoryLayer
  category: string
  keywords: string[]
  createdAt: number
  lastAccessedAt: number
  accessCount: number
  pinned: boolean
}

export interface DreamLog {
  timestamp: number
  beforeCount: number
  afterCount: number
  categories: string[]
  manual: boolean
}

export interface DreamPreviewOp {
  type: 'merge' | 'reclassify' | 'delete' | 'new'
  description: string
  targetIds: string[]
  resultContent?: string
  resultLayer?: MemoryLayer
  resultCategory?: string
}

export interface DreamPreview {
  timestamp: number
  operations: DreamPreviewOp[]
  beforeCount: number
  afterCount: number
  categories: string[]
  rawText: string
}

export interface ExportOptions {
  format: 'json' | 'markdown'
  layers?: MemoryLayer[]
  categories?: string[]
}

export interface SelectiveClearOptions {
  layers?: MemoryLayer[]
  categories?: string[]
  olderThanDays?: number
}

export interface GrowthPoint {
  date: string
  count: number
}

export interface LayerDistribution {
  layer: MemoryLayer
  count: number
  label: string
}

export interface TopAccessed {
  id: string
  content: string
  accessCount: number
}

export interface MemoryStore {
  items: MemoryItem[]
  lastExtractionAt: number
  dreamLogs: DreamLog[]
  newSinceLastDream: number
  pendingPreview: DreamPreview | null
}
