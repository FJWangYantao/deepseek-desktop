import * as https from 'https'
import type { SearchHit } from './duckduckgo'
import { createLogger } from '../logger'

const log = createLogger('zhihu')

// 知乎 Bearer token：由主进程启动时从 secure-storage 读取并通过 setZhihuToken 注入。
// 不在此 import secure-storage——那会引入 electron 依赖，破坏 tsx 测试的 import 链
// （web-search → zhihu-search → secure-storage → electron，在非 electron 环境崩）。
let _zhihuToken = ''
export function setZhihuToken(token: string) { _zhihuToken = token }

export interface ZhihuSearchResult {
  title: string
  url: string
  snippet: string
  source: string
}

function httpsGet(url: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...headers,
      },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsGet(res.headers.location, headers).then(resolve).catch(reject)
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
  })
}

function buildHeaders(): Record<string, string> {
  return {
    'Authorization': `Bearer ${_zhihuToken}`,
    'X-Request-Timestamp': Math.floor(Date.now() / 1000).toString(),
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
}

function parseItems(raw: string, defaultSource: string, debug = false): ZhihuSearchResult[] {
  try {
    const resp = JSON.parse(raw)

    // 首次响应字段摸底（debug 级别，平时不输出，方便事后查响应结构变化）
    if (debug) {
      const items = Array.isArray(resp?.Data?.Items) ? resp.Data.Items : []
      const first = items[0] || {}
      log.debug('响应字段摸底', {
        topKeys: Object.keys(resp || {}),
        dataKeys: Object.keys(resp?.Data || {}),
        itemCount: items.length,
        firstItemKeys: Object.keys(first),
        firstTitle: typeof first.Title === 'string' ? first.Title.slice(0, 80) : null,
      })
    }

    const items = resp?.Data?.Items
    if (!Array.isArray(items)) return []

    const results = items.map((item: any) => {
      const snippet = (
        item.ContentText || item.Content || item.Excerpt || item.Summary || item.Highlight ||
        item.Description || item.Abstract || ''
      ).trim()
      return {
        title: (item.Title || '').trim(),
        url: item.Url || '',
        snippet,
        source: item.Source || defaultSource,
      }
    }).filter((r: ZhihuSearchResult) => r.title)

    return results
  } catch (e) {
    log.warn('解析响应失败', { err: e instanceof Error ? e.message : String(e) })
    return []
  }
}

// 按 URL 查找知乎内容：用搜索 API 反查具体文章
export async function fetchZhihuByUrl(articleUrl: string): Promise<ZhihuSearchResult | null> {
  // 从 URL 提取关键词搜索
  const match = articleUrl.match(/zhihu\.com\/(?:question\/\d+|answer\/\d+|p\/(\d+)|column\/\d+)/
  )
  if (!match) return null

  // 尝试从 URL 路径提取可能的搜索词
  try {
    const urlObj = new URL(articleUrl)
    const pathParts = urlObj.pathname.split('/').filter(Boolean)
    // 用路径中的关键词搜索
    const queryTerms: string[] = []
    for (const part of pathParts) {
      if (/^\d+$/.test(part)) continue // 跳过纯数字 ID
      if (part.length > 2 && !/^(question|answer|p|column|pin|people|org)$/.test(part)) {
        queryTerms.push(decodeURIComponent(part))
      }
    }
    if (queryTerms.length > 0) {
      const query = queryTerms.join(' ')
      const results = await zhihuSearch(query)
      const found = results.find(r => r.url === articleUrl || r.url.includes(articleUrl.split('/').pop()!))
      if (found && found.snippet) return found
      // 返回第一个有内容的
      const any = results.find(r => r.snippet.length > 50)
      if (any) return any
    }
  } catch { /* ignore */ }

  return null
}

// 第一次搜索打印字段结构用于调试
let debugOnce = true

export async function zhihuSearch(query: string): Promise<ZhihuSearchResult[]> {
  const url = `https://developer.zhihu.com/api/v1/content/zhihu_search?Query=${encodeURIComponent(query)}`
  const t0 = Date.now()
  const raw = await httpsGet(url, buildHeaders())
  const d = debugOnce
  if (debugOnce) debugOnce = false
  const results = parseItems(raw, '知乎', d)
  log.info('站内搜索', { query, bytes: raw.length, count: results.length, ms: Date.now() - t0 })
  return results
}

export async function globalSearch(query: string): Promise<ZhihuSearchResult[]> {
  const url = `https://developer.zhihu.com/api/v1/content/global_search?Query=${encodeURIComponent(query)}`
  const t0 = Date.now()
  const raw = await httpsGet(url, buildHeaders())
  const results = parseItems(raw, '全网')
  log.info('全网搜索', { query, bytes: raw.length, count: results.length, ms: Date.now() - t0 })
  return results
}

export async function searchAll(query: string): Promise<{ zhihu: ZhihuSearchResult[], global: ZhihuSearchResult[] }> {
  const [zhihu, global] = await Promise.allSettled([zhihuSearch(query), globalSearch(query)])
  return {
    zhihu: zhihu.status === 'fulfilled' ? zhihu.value : [],
    global: global.status === 'fulfilled' ? global.value : [],
  }
}

/**
 * 把知乎全网搜索结果适配成 SearchHit，给主搜索链使用。
 * 知乎全网召回的是综合互联网内容（新闻/政府站/百科/知乎专栏...），可作为主搜索源。
 * 单独的站内 zhihuSearch() 仍保留为【知乎】面板，因为问答型内容语义独立。
 *
 * 没有 token 时返回空（让调用方自动 fallback 到下一级）。
 * 失败时也返回空（已在 globalSearch 内 catch parse 错误；这里再兜一次网络异常）。
 */
export async function searchZhihuGlobalAsHits(query: string): Promise<SearchHit[]> {
  if (!_zhihuToken) return []
  const q = query.trim()
  if (!q) return []
  try {
    const items = await globalSearch(q)
    return items
      .filter(r => r.title && r.url)
      .map(r => ({ title: r.title, url: r.url, snippet: r.snippet || '' }))
  } catch {
    return []
  }
}
