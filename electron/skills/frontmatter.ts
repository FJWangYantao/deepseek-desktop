import * as yaml from 'js-yaml'

interface ParsedFrontmatter {
  meta: Record<string, unknown>
  body: string
}

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/

/**
 * 解析 SKILL.md 顶部 YAML frontmatter。
 *
 * 兼容：
 * - Anthropic 极简版：`name` / `description` / `license`
 * - ClawHub / OpenClaw 扩展：嵌套 `metadata.openclaw.*`，含别名 `metadata.clawdbot`、`metadata.clawdis`
 * - 旧 deepseek 自定义字段：`version` / `tags` / `displayName`
 */
export function parseFrontmatter(text: string): ParsedFrontmatter | null {
  const match = text.match(FRONTMATTER_RE)
  if (!match) return null
  let parsed: unknown
  try {
    parsed = yaml.load(match[1], { schema: yaml.JSON_SCHEMA })
  } catch {
    return null
  }
  const meta = (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
    ? (parsed as Record<string, unknown>)
    : {}
  return { meta, body: match[2].trim() }
}

export function serializeFrontmatter(meta: Record<string, unknown>, body: string): string {
  const cleaned: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null || v === '') continue
    cleaned[k] = v
  }
  // js-yaml 默认 lineWidth 80 会折行，关掉；保持 key 顺序
  const yamlText = yaml.dump(cleaned, { lineWidth: -1, noRefs: true, sortKeys: false }).trimEnd()
  return `---\n${yamlText}\n---\n\n${body.trim()}\n`
}

// ===== ClawHub / OpenClaw 扩展元数据读取 =====

const OPENCLAW_ALIASES = ['openclaw', 'clawdbot', 'clawdis'] as const

export interface OpenClawInstallSpec {
  kind?: string
  package?: string
  formula?: string
  bins?: string[]
}

export interface OpenClawEnvVar {
  name: string
  required?: boolean
  description?: string
}

export interface OpenClawMetadata {
  requires?: {
    env?: string[]
    bins?: string[]
    anyBins?: string[]
    config?: string[]
  }
  primaryEnv?: string
  envVars?: OpenClawEnvVar[]
  always?: boolean
  skillKey?: string
  emoji?: string
  homepage?: string
  os?: string[]
  install?: OpenClawInstallSpec[]
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const arr = v.map(x => (typeof x === 'string' ? x : '')).filter(Boolean)
  return arr.length ? arr : undefined
}

function asEnvVars(v: unknown): OpenClawEnvVar[] | undefined {
  if (!Array.isArray(v)) return undefined
  const arr: OpenClawEnvVar[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const name = asString(obj.name)
    if (!name) continue
    arr.push({
      name,
      required: typeof obj.required === 'boolean' ? obj.required : undefined,
      description: asString(obj.description),
    })
  }
  return arr.length ? arr : undefined
}

function asInstallSpecs(v: unknown): OpenClawInstallSpec[] | undefined {
  if (!Array.isArray(v)) return undefined
  const arr: OpenClawInstallSpec[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const spec: OpenClawInstallSpec = {}
    spec.kind = asString(obj.kind)
    spec.package = asString(obj.package)
    spec.formula = asString(obj.formula)
    spec.bins = asStringArray(obj.bins)
    arr.push(spec)
  }
  return arr.length ? arr : undefined
}

/**
 * 从 frontmatter 中抽取 OpenClaw / ClawHub 扩展元数据。
 * `metadata.openclaw` 是首选，其它两个为兼容别名（同时存在时按 openclaw > clawdbot > clawdis 取第一个）。
 */
export function extractOpenClawMetadata(meta: Record<string, unknown>): OpenClawMetadata | undefined {
  const root = meta.metadata
  if (!root || typeof root !== 'object') return undefined
  const rootObj = root as Record<string, unknown>

  let block: Record<string, unknown> | undefined
  for (const alias of OPENCLAW_ALIASES) {
    const v = rootObj[alias]
    if (v && typeof v === 'object') {
      block = v as Record<string, unknown>
      break
    }
  }
  if (!block) return undefined

  const out: OpenClawMetadata = {}

  if (block.requires && typeof block.requires === 'object') {
    const req = block.requires as Record<string, unknown>
    const r: NonNullable<OpenClawMetadata['requires']> = {}
    r.env = asStringArray(req.env)
    r.bins = asStringArray(req.bins)
    r.anyBins = asStringArray(req.anyBins)
    r.config = asStringArray(req.config)
    if (r.env || r.bins || r.anyBins || r.config) out.requires = r
  }
  out.primaryEnv = asString(block.primaryEnv)
  out.envVars = asEnvVars(block.envVars)
  if (typeof block.always === 'boolean') out.always = block.always
  out.skillKey = asString(block.skillKey)
  out.emoji = asString(block.emoji)
  out.homepage = asString(block.homepage)
  out.os = asStringArray(block.os)
  out.install = asInstallSpecs(block.install)

  return out
}
