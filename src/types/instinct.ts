// Instinct Engine 类型定义
// trigger → action 形式的行为规则，带置信度动态演化

export type InstinctDomain =
  | 'tool-strategy'      // 工具调用策略（例如："实时榜单类查询优先 web_fetch"）
  | 'workflow'           // 工作流模式（例如："改文件前先 read"）
  | 'tool-preference'    // 工具偏好（例如："用户永远拒绝 file_write"）
  | 'search-pattern'     // 搜索习惯（例如："研究 X 主题时常用关键词组合"）
  | 'context-pattern'    // 项目上下文（例如："用户提到的项目栈"）

export interface Instinct {
  id: string
  trigger: string                // 触发条件描述
  action: string                 // 推荐行为
  domain: InstinctDomain
  confidence: number             // 0.0 ~ 0.9
  source: 'statistical' | 'semantic'
  evidence: string               // 证据描述（人类可读）
  observedCount: number          // 累计观察到次数
  validatedCount: number         // 累计被复用/验证次数
  lastObservedAt: number         // 最近一次匹配到的时间戳
  createdAt: number
  deprecated: boolean
  keywords: string[]             // 用于 Jaccard 去重的英文关键词
}

export interface InstinctCandidate {
  trigger: string
  action: string
  domain: InstinctDomain
  source: 'statistical' | 'semantic'
  evidence: string
  initialConfidence: number      // 0.5（路径A）/ LLM 给的初值（路径B，0.4~0.7）
}

export interface InstinctStoreShape {
  instincts: Instinct[]
  updatedAt: number
}
