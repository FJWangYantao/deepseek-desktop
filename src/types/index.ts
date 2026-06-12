import type { ToolCallUIState } from './tools'

export interface QuoteItem {
  text: string
  messageId: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  thinkingExpanded?: boolean
  attachments?: { name: string; size: number; type?: 'file' | 'image'; text?: string }[]
  quotes?: QuoteItem[]
  /** @deprecated 旧版单引用，仅用于历史数据渲染兼容 */
  quote?: { text: string; messageId: string }
  /** 工具调用记录（生成完成后持久化到消息上） */
  toolCalls?: ToolCallUIState[]
  timestamp: number
}

export interface ChatSession {
  id: string
  title: string
  model: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

export interface ModelOption {
  id: string
  name: string
  description: string
  contextLength: number
}

export type ThinkingMode = 'enabled' | 'disabled'

export type ThemeName = 'amber' | 'ocean' | 'sage' | 'slate'
export type ThemeMode = 'light' | 'dark'

export interface ThemeColors {
  bg: string; sidebar: string; card: string; input: string; border: string
  accent: string; 'accent-hover': string
  text: string; heading: string; muted: string
  hover: string; 'hover-strong': string; 'surface-alt': string
  'border-light': string; scrollbar: string; 'scrollbar-hover': string
  'accent-soft': string; 'accent-soft-border': string
}

export interface ThemeDefinition {
  name: ThemeName
  label: string
  light: ThemeColors
  dark: ThemeColors
}

// ===== 笔记/Insight 相关 =====
export type { Insight, InsightInput, Notebook } from './notes'
export { INSIGHT_COLORS } from './notes'

// ===== 记忆相关 =====
export type { MemoryItem, MemoryLayer, MemoryStore } from './memory'

// ===== Skill 相关 =====
export type {
  SkillValidationIssue, SkillValidationResult,
  SkillIndex, SkillResource, SkillPackage, SkillActivation,
  LegacySkillMeta, SkillResourceReadResult,
  SkillRuntimeMetadata, SkillEnvVar, SkillInstallSpec,
} from './skills'

// ===== DSL 相关 =====
export type {
  DSLStep, DSLPromptStep, DSLConditionStep, DSLToolStep, DSLInputStep, DSLOutputStep, DSLLoopStep,
  RunnerState, VariableEnvironment,
  DSLParseResult, DSLValidationError,
  MCPToolCallRequest, MCPToolCallResult,
  DSLPauseInfo, DSLStepOutput,
} from './dsl'

// ===== 工具系统 =====
export type {
  ToolParameter, ToolDefinition, ToolPermission,
  ToolCall, ToolCallResult,
  ToolPermissionMode, ToolPermissionLevel, ToolPermissionRule, ToolPermissionConfig,
  ToolCallRequest, ToolListResponse, ToolAuthorizeRequest,
  ToolCallStatus, ToolCallUIState,
  StreamToolCallChunk,
} from './tools'

// ===== 统计相关 =====

export interface SearchResult {
  title: string
  url: string
  snippet: string
  content: string
}

export interface UsageData {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  prompt_cache_hit_tokens: number
  prompt_cache_miss_tokens: number
}

export interface UsageRecord {
  id: string
  model: string
  sessionId: string
  sessionTitle: string
  usage: UsageData
  timestamp: number
  cost: number
  source: 'api' | 'estimated'
  /** 用户输入内容 */
  userMessage?: string
  /** AI 回复内容 */
  assistantMessage?: string
  /** 实际发送给 API 的完整 messages */
  apiMessages?: { role: string; content: string }[]
}

export interface DailyStats {
  date: string
  totalTokens: number
  promptTokens: number
  completionTokens: number
  cacheHitTokens: number
  conversationCount: number
  cost: number
  proTokens: number
  flashTokens: number
}

export interface BalanceInfo {
  currency: string
  total_balance: string
  granted_balance: string
  topped_up_balance: string
}

export interface BalanceResponse {
  is_available: boolean
  balance_infos: BalanceInfo[]
}
