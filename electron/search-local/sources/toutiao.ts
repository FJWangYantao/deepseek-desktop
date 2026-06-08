import * as https from 'https'
import type { DataSource, LocalSearchItem } from '../types'

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      timeout: 15000,
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

export const toutiaoSource: DataSource = {
  name: 'toutiao',
  label: '头条热榜',
  category: 'news',
  refreshInterval: 5 * 60 * 1000,
  dailyLimit: 0,
  async fetch() {
    const raw = await httpsGet('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc')
    const data = JSON.parse(raw)
    const items = data?.data
    if (!Array.isArray(items)) return []

    return items.map((item: any, i: number): LocalSearchItem => {
      const title = (item.Title || '').trim()
      return {
        title,
        summary: title,
        url: item.Url || `https://www.toutiao.com/search/?keyword=${encodeURIComponent(title)}`,
        source: 'toutiao',
        category: 'news',
        score: item.HotValue || (30 - i),
        timestamp: Date.now(),
        keywords: extractKeywords(title),
      }
    })
  },
}
