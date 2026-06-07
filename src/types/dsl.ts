export interface DSLPromptStep {
  type: 'prompt'
  stage: string
  prompt: string
}

export interface DSLConditionStep {
  type: 'condition'
  stage: string
  condition: string
  then: DSLStep[]
  else?: DSLStep[]
}

export interface DSLToolStep {
  type: 'tool'
  stage: string
  tool: string
  params: Record<string, string>
}

export interface DSLInputStep {
  type: 'input'
  stage: string
  input: string
  default?: string
  validate?: string
}

export interface DSLOutputStep {
  type: 'output'
  stage: string
  output: {
    format: 'markdown' | 'text' | 'json'
    template: string
  }
}

export interface DSLLoopStep {
  type: 'loop'
  stage: string
  loop: {
    times?: number
    until?: string
    max?: number
    each?: string
    as: string
  }
  steps: DSLStep[]
}

export type DSLStep = DSLPromptStep | DSLConditionStep | DSLToolStep | DSLInputStep | DSLOutputStep | DSLLoopStep

// ===== 执行相关 =====

export type RunnerState = 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'ERROR'

export interface VariableEnvironment {
  input: Record<string, string>
  context: {
    userInput: string
    files?: { name: string; text: string; size: number }[]
    date: string
    searchResults?: string
  }
  [key: string]: unknown
}

// ===== 解析结果 =====

export interface DSLParseResult {
  meta: { name: string; description: string; version: string; tags: string[] }
  body: string
  steps: DSLStep[] | null
  isDSL: boolean
  errors: DSLValidationError[]
}

export interface DSLValidationError {
  stepIndex: number
  field: string
  message: string
}

// ===== MCP 工具调用 =====

export interface MCPToolCallRequest {
  serverId: string
  toolName: string
  params: Record<string, string>
}

export interface MCPToolCallResult {
  success: boolean
  data?: unknown
  error?: string
}

// ===== 运行时回调 =====

export interface DSLPauseInfo {
  prompt: string
  default?: string
  validate?: string
  stage: string
}

export interface DSLStepOutput {
  stage: string
  content: string
  stepType: DSLStep['type']
}
