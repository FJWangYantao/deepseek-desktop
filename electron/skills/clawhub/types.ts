/**
 * ClawHub Registry API 类型定义
 *
 * 协议参考：https://docs.openclaw.ai/clawhub/http-api
 * 关键端点：
 *  - GET /api/v1/skills?limit=&cursor=
 *  - GET /api/v1/skills/{slug}
 *  - GET /api/v1/skills/{slug}/versions/{version}      ← 含 files manifest（每个文件带 sha256）
 *  - GET /api/v1/download?slug=&version=                ← zip 整包，响应头 X-ClawHub-Artifact-Sha256
 *  - GET /api/v1/skills/{slug}/file?path=&version=      ← 单文件 fallback，200KB 上限
 */

export interface ClawHubListItem {
  slug: string
  displayName?: string
  summary?: string
  tags?: Record<string, string>
  stats?: {
    comments?: number
    downloads?: number
    installsAllTime?: number
    installsCurrent?: number
    stars?: number
    versions?: number
  }
  createdAt?: number
  updatedAt?: number
  latestVersion?: ClawHubVersionSummary
  metadata?: unknown
}

export interface ClawHubVersionSummary {
  version: string
  createdAt?: number
  changelog?: string
  license?: string | null
}

export interface ClawHubListResponse {
  items: ClawHubListItem[]
  nextCursor?: string | null
}

export interface ClawHubSkillDetail {
  skill: ClawHubListItem
  latestVersion?: ClawHubVersionSummary
  metadata?: unknown
  owner?: {
    handle?: string
    userId?: string
    displayName?: string
    image?: string
  }
  moderation?: unknown
}

export interface ClawHubFileEntry {
  path: string
  size: number
  sha256: string
  contentType?: string
}

export interface ClawHubVersionDetail {
  skill: { slug: string; displayName?: string }
  version: {
    version: string
    createdAt?: number
    changelog?: string
    changelogSource?: string
    license?: string | null
    files: ClawHubFileEntry[]
    security?: {
      status?: string
      hasWarnings?: boolean
      checkedAt?: number
      model?: string
      hasScanResult?: boolean
      sha256hash?: string
      virustotalUrl?: string
      capabilityTags?: string[]
      scanners?: Record<string, unknown>
    }
  }
}

/**
 * 单个 Skill 安装时落盘的 origin 记录，位于 `<slug>/.clawhub/origin.json`。
 * 记录"这个 Skill 来自哪个 registry 的哪个版本"，update 时用来比对。
 */
export interface ClawHubOrigin {
  registry: string
  slug: string
  version: string
  /** 整包 sha256（来自下载响应头 X-ClawHub-Artifact-Sha256 或 version manifest 的 sha256hash） */
  bundleSha256?: string
  installedAt: number
  /** 安装时用的下载策略 */
  source: 'zip' | 'file-by-file'
}

/**
 * 全局清单 `userData/skills/.clawhub/lock.json`，记录当前 userData 下所有 ClawHub Skill 的状态。
 */
export interface ClawHubLock {
  /** Schema 版本，未来升级用 */
  version: 1
  entries: Record<string, ClawHubLockEntry>
}

export interface ClawHubLockEntry {
  registry: string
  slug: string
  version: string
  bundleSha256?: string
  fileCount: number
  totalSize: number
  installedAt: number
  /** 是否被用户 pin，pin 后 update 拒绝覆盖 */
  pinned?: boolean
}

/**
 * Installer 对外的返回结构。
 */
export interface ClawHubInstallResult {
  ok: boolean
  /** 已落盘 Skill 的 id（= slug） */
  skillId?: string
  /** 落盘的 version */
  version?: string
  /** 实际落盘的文件数 */
  filesWritten?: number
  /** 总字节数 */
  totalSize?: number
  /** 走的下载路径 */
  source?: 'zip' | 'file-by-file'
  /** 失败原因（机器可读） */
  errorCode?: string
  /** 失败原因（人类可读） */
  error?: string
}

export interface ClawHubClientOptions {
  /** Registry base URL，不带尾斜杠。默认 https://clawhub.ai */
  baseUrl?: string
  /** 可选 Bearer token */
  token?: string
  /** fetch 超时（ms），默认 30s */
  timeoutMs?: number
}
