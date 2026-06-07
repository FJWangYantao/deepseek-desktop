// ===== 工具定义 =====

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  description: string
  enum?: string[]
  default?: unknown
  items?: ToolParameter
}

export interface ToolDefinition {
  name: string
  description: string
  category: 'search' | 'file' | 'network' | 'code'
  permissions: ToolPermission
  parameters: {
    type: 'object'
    properties: Record<string, ToolParameter>
    required: string[]
  }
}

export type ToolPermission = 'auto' | 'confirm' | 'whitelist'

// ===== 运行时调用 =====

export interface ToolCall {
  id: string
  name: string
  arguments: string // JSON string
}

export interface ToolCallResult {
  callId: string
  name: string
  success: boolean
  data: string
  truncated: boolean
  totalSize: number
  displayedSize: number
  offset: number
  needsApproval?: boolean
  approvalReason?: string
}

// ===== 权限管理 =====

export interface ToolPermissionRule {
  toolName: string
  level: 'auto' | 'confirm' | 'blocked'
  allowedPaths?: string[] // file_* 工具的白名单路径
}

export interface ToolPermissionConfig {
  rules: ToolPermissionRule[]
  // 默认策略：auto = 低风险工具自动放行, confirm = 全部需确认
  defaultPolicy: 'auto' | 'confirm'
}

// ===== IPC 通信 =====

export interface ToolCallRequest {
  name: string
  arguments: string // JSON string
  callId: string
}

export interface ToolListResponse {
  tools: ToolDefinition[]
}

export interface ToolAuthorizeRequest {
  toolName: string
  arguments: Record<string, unknown>
  // 用户授权操作：'allow-once' | 'allow-always' | 'deny'
  decision: 'allow-once' | 'allow-always' | 'deny'
}

// ===== UI 状态 =====

export type ToolCallStatus = 'pending' | 'running' | 'completed' | 'error' | 'awaiting-approval'

export interface ToolCallUIState {
  callId: string
  name: string
  arguments: Record<string, unknown>
  status: ToolCallStatus
  result?: ToolCallResult
  error?: string
  timestamp: number
}

// ===== 流式 chunk 中的 tool_calls =====

export interface StreamToolCallChunk {
  index: number
  id?: string
  type?: string
  function?: {
    name?: string
    arguments?: string
  }
}
