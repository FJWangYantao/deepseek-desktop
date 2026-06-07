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

export const sinaFinanceSource: DataSource = {
  name: 'sina-finance',
  label: '新浪财经',
  category: 'finance',
  refreshInterval: 5 * 60 * 1000,
  dailyLimit: 0,
  async fetch() {
    const raw = await httpsGet('https://feed.mix.sina.com.cn/api/roll/get?pageid=155&lid=2503&num=30&versionNumber=1.2.4')
    const data = JSON.parse(raw)
    const items = data?.result?.data
    if (!Array.isArray(items)) return []

    return items.map((item: any, i: number): LocalSearchItem => {
      const title = (item.title || '').trim().replace(/<[^>]+>/g, '')
      return {
        title,
        summary: title,
        url: item.url || '',
        source: 'sina-finance',
        category: 'finance',
        score: (30 - i) * 100,
        timestamp: Date.now(),
        keywords: extractKeywords(title),
      }
    })
  },
}
