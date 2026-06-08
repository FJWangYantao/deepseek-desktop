import * as https from 'https'
import type { DataSource, LocalSearchItem } from '../types'

const ZHIHU_BEARER_TOKEN = '2408bb15ff55bedb5ac0c598e4c80f01915bea83'

function httpsRequest(url: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...headers,
      },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsRequest(res.headers.location, headers).then(resolve).catch(reject)
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

function extractKeywords(title: string): string[] {
  const cjk = title.match(/[一-鿿]{2,4}/g) || []
  const en = title.match(/[a-zA-Z0-9]+/g) || []
  return [...new Set([...cjk, ...en.map(s => s.toLowerCase())])]
}

export const zhihuSource: DataSource = {
  name: 'zhihu',
  label: '知乎热榜',
  category: 'social',
  refreshInterval: 144 * 60 * 1000,
  dailyLimit: 10,
  async fetch() {
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const raw = await httpsRequest('https://developer.zhihu.com/api/v1/content/hot_list', {
      'Authorization': `Bearer ${ZHIHU_BEARER_TOKEN}`,
      'X-Request-Timestamp': timestamp,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    })

    const resp = JSON.parse(raw)
    // 官方 API 返回格式：{ Code: 0, Message: "success", Data: { Total, Items: [{ Title, Url, Summary }] } }
    const items = resp?.Data?.Items
    if (!Array.isArray(items)) {
      console.warn('[Zhihu] API 返回异常:', JSON.stringify(resp).slice(0, 200))
      return []
    }

    return items.map((item: any, i: number): LocalSearchItem => {
      const title = (item.Title || '').trim()
      const url = item.Url || ''
      return {
        title,
        summary: item.Summary || title,
        url: url.startsWith('http') ? url : `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(title)}`,
        source: 'zhihu',
        category: 'social',
        score: 50 - i,
        timestamp: Date.now(),
        keywords: extractKeywords(title),
      }
    })
  },
}
