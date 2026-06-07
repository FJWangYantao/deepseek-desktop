export interface DataSource {
  name: string
  label: string
  category: string
  refreshInterval: number
  dailyLimit?: number  // 每日最大调用次数，0 或不填 = 无限制
  fetch(): Promise<LocalSearchItem[]>
}

export interface LocalSearchItem {
  title: string
  summary: string
  url: string
  source: string
  category: string
  score: number
  timestamp: number
  keywords: string[]
}
