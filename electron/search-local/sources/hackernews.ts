import * as https from 'https'
import type { DataSource, LocalSearchItem } from '../types'

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
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
  const parts = title.toLowerCase().split(/\s+/).filter(Boolean)
  return [...new Set(parts)]
}

export const hackernewsSource: DataSource = {
  name: 'hackernews',
  label: 'Hacker News',
  category: 'dev',
  refreshInterval: 10 * 60 * 1000,
  dailyLimit: 0,
  async fetch() {
    const idsRaw = await httpsGet('https://hacker-news.firebaseio.com/v0/topstories.json')
    const ids: number[] = JSON.parse(idsRaw).slice(0, 30)

    const items: LocalSearchItem[] = []
    // 批量获取，限制并发
    for (let i = 0; i < ids.length; i += 5) {
      const batch = ids.slice(i, i + 5)
      const results = await Promise.allSettled(
        batch.map(async (id, idx) => {
          const raw = await httpsGet(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
          const item = JSON.parse(raw)
          if (!item || item.type !== 'story') return null
          const title = (item.title || '').trim()
          return {
            title,
            summary: title,
            url: item.url || `https://news.ycombinator.com/item?id=${id}`,
            source: 'hackernews',
            category: 'dev',
            score: item.score || (30 - i - idx),
            timestamp: Date.now(),
            keywords: extractKeywords(title),
          } as LocalSearchItem
        })
      )
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) items.push(r.value)
      }
    }

    return items
  },
}
