import * as https from 'https'
import type { DataSource, LocalSearchItem } from '../types'

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://weibo.com',
      },
      timeout: 8000,
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(httpsGet(new URL(res.headers.location, url).href))
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

export const weiboSource: DataSource = {
  name: 'weibo',
  label: '微博热搜',
  category: 'social',
  refreshInterval: 5 * 60 * 1000,
  dailyLimit: 0,
  async fetch() {
    const raw = await httpsGet('https://weibo.com/ajax/side/hotSearch')
    const data = JSON.parse(raw)
    const realtime = data?.data?.realtime
    if (!Array.isArray(realtime)) return []

    return realtime.slice(0, 30).map((item: any, i: number): LocalSearchItem => {
      const title = (item.word || item.note || '').trim()
      return {
        title,
        summary: item.note || title,
        url: `https://s.weibo.com/weibo?q=${encodeURIComponent(title)}`,
        source: 'weibo',
        category: 'social',
        score: item.raw_hot || item.num || (30 - i),
        timestamp: Date.now(),
        keywords: extractKeywords(title),
      }
    })
  },
}
