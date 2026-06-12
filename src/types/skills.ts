export interface SkillValidationIssue {
  code: string
  message: string
  path?: string
}

export interface SkillValidationResult {
  ok: boolean
  errors: SkillValidationIssue[]
  warnings: SkillValidationIssue[]
}

// ===== ClawHub / OpenClaw 扩展元数据（B 路线兼容核心）=====

export interface SkillInstallSpec {
  kind?: string
  package?: string
  formula?: string
  bins?: string[]
}

export interface SkillEnvVar {
  name: string
  required?: boolean
  description?: string
}

export interface SkillRuntimeMetadata {
  requires?: {
    env?: string[]
    bins?: string[]
    anyBins?: string[]
    config?: string[]
  }
  primaryEnv?: string
  envVars?: SkillEnvVar[]
  always?: boolean
  skillKey?: string
  emoji?: string
  homepage?: string
  os?: string[]
  install?: SkillInstallSpec[]
}

export interface SkillIndex {
  id: string
  name: string
  description: string
  displayName?: string
  version?: string
  tags: string[]
  kind: 'package' | 'legacy-md'
  enabled: boolean
  source: 'user' | 'default' | 'imported'
  entry: 'SKILL.md' | 'legacy.md'
  hasReferences: boolean
  hasAssets: boolean
  hasScripts: boolean
  scriptExecution: 'disabled'
  validation: SkillValidationResult
  updatedAt: number
  /** ClawHub / OpenClaw 扩展元数据；不存在则为 undefined */
  runtime?: SkillRuntimeMetadata
  /** Skill 包大小（package 时为目录文件总和；legacy 为单文件大小） */
  bundleSize?: number
}

export interface SkillResource {
  path: string
  kind: 'reference' | 'asset' | 'script'
  mediaType?: string
  size: number
  readable: boolean
  executable: false
}

export interface SkillPackage extends SkillIndex {
  readme: string
  frontmatter: Record<string, unknown>
  body: string
  resources: SkillResource[]
}

export interface SkillActivation {
  /** Claude Code 风格：Skill Index 始终注入，由模型按需加载 */
  mode: 'auto'
  /** 当前已加载的 Skill；每轮最多一个 */
  loadedSkillId: string | null
  loadedReadme?: boolean
  loadedResources?: string[]
}

export interface LegacySkillMeta {
  id: string
  name: string
  description: string
  version: string
  tags: string[]
  content: string
}

export interface SkillResourceReadResult {
  content?: string
  error?: string
  resource?: SkillResource
}
