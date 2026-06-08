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

function parseItems(raw: string, defaultSource: string): ZhihuSearchResult[] {
  try {
    const resp = JSON.parse(raw)
    const items = resp?.Data?.Items
    if (!Array.isArray(items)) return []
    return items.map((item: any) => ({
      title: (item.Title || '').trim(),
      url: item.Url || '',
      snippet: (item.Summary || item.Excerpt || '').trim(),
      source: item.Source || defaultSource,
    })).filter((r: ZhihuSearchResult) => r.title)
  } catch {
    return []
  }
}

export async function zhihuSearch(query: string): Promise<ZhihuSearchResult[]> {
  const url = `https://developer.zhihu.com/api/v1/content/zhihu_search?Query=${encodeURIComponent(query)}`
  const raw = await httpsGet(url, buildHeaders())
  console.log(`[ZhihuSearch] 站内搜索 "${query}": ${raw.length} bytes`)
  return parseItems(raw, '知乎')
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
