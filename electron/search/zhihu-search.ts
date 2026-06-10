import * as https from 'https'

const ZHIHU_BEARER_TOKEN = '2408bb15ff55bedb5ac0c598e4c80f01915bea83'

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
    'Authorization': `Bearer ${ZHIHU_BEARER_TOKEN}`,
    'X-Request-Timestamp': Math.floor(Date.now() / 1000).toString(),
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
}

function parseItems(raw: string, defaultSource: string, debug = false): ZhihuSearchResult[] {
  try {
    const resp = JSON.parse(raw)

    // 粗暴日志：打印顶层 keys
    if (debug) {
      console.log(`[ZhihuSearch] 响应顶层 keys:`, Object.keys(resp).join(', '))
      if (resp.Data) {
        console.log(`[ZhihuSearch] Data keys:`, Object.keys(resp.Data).join(', '))
        if (Array.isArray(resp.Data.Items)) {
          console.log(`[ZhihuSearch] Items 数量: ${resp.Data.Items.length}`)
          if (resp.Data.Items.length > 0) {
            const first = resp.Data.Items[0]
            console.log(`[ZhihuSearch] 首条所有 keys:`, Object.keys(first).join(', '))
            // 打印所有字符串字段值
            for (const k of Object.keys(first)) {
              const v = first[k]
              if (typeof v === 'string' && v.length > 0) {
                console.log(`[ZhihuSearch]    ${k}: "${v.slice(0, 100)}"`)
              }
            }
          }
        } else {
          console.log(`[ZhihuSearch] Items 不是数组，类型: ${typeof resp.Data.Items}`)
        }
      } else {
        console.log(`[ZhihuSearch] 无 Data 字段`)
      }
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

    if (debug) {
      const withSnippet = results.filter(r => r.snippet.length > 0)
      console.log(`[ZhihuSearch] 解析结果: ${results.length} 条, ${withSnippet.length} 条有摘要, 平均 ${withSnippet.length > 0 ? Math.round(withSnippet.reduce((s, r) => s + r.snippet.length, 0) / withSnippet.length) : 0} 字符`)
    }

    return results
  } catch (e) {
    if (debug) console.log(`[ZhihuSearch] 解析异常:`, e)
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
  const raw = await httpsGet(url, buildHeaders())
  console.log(`[ZhihuSearch] 站内搜索 "${query}": ${raw.length} bytes`)
  const d = debugOnce
  if (debugOnce) debugOnce = false
  return parseItems(raw, '知乎', d)
}

export async function globalSearch(query: string): Promise<ZhihuSearchResult[]> {
  const url = `https://developer.zhihu.com/api/v1/content/global_search?Query=${encodeURIComponent(query)}`
  const raw = await httpsGet(url, buildHeaders())
  console.log(`[ZhihuSearch] 全网搜索 "${query}": ${raw.length} bytes`)
  return parseItems(raw, '全网')
}

export async function searchAll(query: string): Promise<{ zhihu: ZhihuSearchResult[], global: ZhihuSearchResult[] }> {
  const [zhihu, global] = await Promise.allSettled([zhihuSearch(query), globalSearch(query)])
  return {
    zhihu: zhihu.status === 'fulfilled' ? zhihu.value : [],
    global: global.status === 'fulfilled' ? global.value : [],
  }
}
