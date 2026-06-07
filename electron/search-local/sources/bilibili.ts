import * as https from 'https'
import type { DataSource, LocalSearchItem } from '../types'

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      timeout: 8000,
    }, (res) => {
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

export const bilibiliSource: DataSource = {
  name: 'bilibili',
  label: 'B站热门',
  category: 'social',
  refreshInterval: 5 * 60 * 1000,
  dailyLimit: 0,
  async fetch() {
    const raw = await httpsGet('https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all')
    const data = JSON.parse(raw)
    const items = data?.data?.list
    if (!Array.isArray(items)) return []

    return items.slice(0, 30).map((item: any, i: number): LocalSearchItem => {
      const title = (item.title || '').trim()
      return {
        title,
        summary: item.desc || title,
        url: item.short_link_v2 || `https://www.bilibili.com/video/${item.bvid}`,
        source: 'bilibili',
        category: 'social',
        score: item.stat?.view || (30 - i),
        timestamp: Date.now(),
        keywords: extractKeywords(title),
      }
    })
  },
}
