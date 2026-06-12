/**
 * ClawHub Registry HTTP 客户端。
 *
 * 设计原则：
 *  - 不做任何文件落盘、不做 sha256 校验（那是 installer 的职责）
 *  - 只负责：构造 URL、发请求、解析 JSON、暴露响应头给上层
 *  - 所有错误转成 Error 抛出，由 installer 翻成可读的 errorCode
 */

import type {
  ClawHubClientOptions,
  ClawHubListResponse,
  ClawHubSkillDetail,
  ClawHubVersionDetail,
} from './types'

const DEFAULT_BASE_URL = 'https://clawhub.ai'
const DEFAULT_TIMEOUT_MS = 30_000

export class ClawHubClient {
  /** Registry base URL，已去掉尾斜杠，外部只读。 */
  readonly baseUrl: string
  private readonly token?: string
  private readonly timeoutMs: number

  constructor(opts: ClawHubClientOptions = {}) {
    const raw = opts.baseUrl ?? process.env.CLAWHUB_REGISTRY ?? DEFAULT_BASE_URL
    this.baseUrl = raw.replace(/\/+$/, '')
    this.token = opts.token
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Accept': 'application/json',
      'User-Agent': 'deepseek-chat-clawhub-client/1.0',
    }
    if (this.token) h['Authorization'] = `Bearer ${this.token}`
    return h
  }

  private async fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
    try {
      return await fetch(url, { ...init, headers: { ...this.headers(), ...(init.headers as Record<string, string> | undefined) }, signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  private async getJson<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const res = await this.fetchWithTimeout(url)
    if (!res.ok) {
      throw new Error(`ClawHub GET ${path} 返回 ${res.status} ${res.statusText}`)
    }
    return await res.json() as T
  }

  /** 列表（搜索）。limit/cursor 都是 registry 支持的查询参数。 */
  async listSkills(params: { limit?: number; cursor?: string; sort?: string } = {}): Promise<ClawHubListResponse> {
    const qs = new URLSearchParams()
    if (params.limit !== undefined) qs.set('limit', String(params.limit))
    if (params.cursor) qs.set('cursor', params.cursor)
    if (params.sort) qs.set('sort', params.sort)
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    return this.getJson<ClawHubListResponse>(`/api/v1/skills${suffix}`)
  }

  /** 全文搜索。 */
  async searchSkills(query: string, limit = 30): Promise<ClawHubListResponse> {
    const qs = new URLSearchParams({ q: query, limit: String(limit) })
    return this.getJson<ClawHubListResponse>(`/api/v1/search?${qs.toString()}`)
  }

  /** 单个 Skill 的元信息（含 latestVersion）。 */
  async getSkill(slug: string): Promise<ClawHubSkillDetail> {
    return this.getJson<ClawHubSkillDetail>(`/api/v1/skills/${encodeURIComponent(slug)}`)
  }

  /** 指定版本的 files manifest（每个文件含 sha256）。 */
  async getVersion(slug: string, version: string): Promise<ClawHubVersionDetail> {
    return this.getJson<ClawHubVersionDetail>(
      `/api/v1/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`,
    )
  }

  /**
   * 下载整包 zip。
   * 返回 zip 字节 + 响应头里的 sha256（如有），由 installer 双重校验。
   */
  async downloadZip(slug: string, version?: string): Promise<{ bytes: Uint8Array; sha256Header?: string }> {
    const qs = new URLSearchParams({ slug })
    if (version) qs.set('version', version)
    const url = `${this.baseUrl}/api/v1/download?${qs.toString()}`
    const res = await this.fetchWithTimeout(url)
    if (res.status === 410) throw new Error('ClawHub 该版本已被作者撤回（410 Gone）')
    if (!res.ok) throw new Error(`ClawHub 下载 zip 返回 ${res.status} ${res.statusText}`)
    const buf = new Uint8Array(await res.arrayBuffer())
    const sha256Header = res.headers.get('x-clawhub-artifact-sha256') ?? undefined
    return { bytes: buf, sha256Header }
  }

  /**
   * 单文件 fallback。registry 对单文件硬限制 200KB；大文件会返回 415 或 413。
   * 返回的是文本（registry 该端点本身就只允许文本类）。
   */
  async getFile(slug: string, path: string, version?: string): Promise<string> {
    const qs = new URLSearchParams({ path })
    if (version) qs.set('version', version)
    const url = `${this.baseUrl}/api/v1/skills/${encodeURIComponent(slug)}/file?${qs.toString()}`
    const res = await this.fetchWithTimeout(url)
    if (!res.ok) {
      throw new Error(`ClawHub 单文件下载 ${path} 返回 ${res.status} ${res.statusText}`)
    }
    return await res.text()
  }
}
