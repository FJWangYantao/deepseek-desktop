import * as https from 'https'
import type { DataSource, LocalSearchItem } from '../types'

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/vnd.github.v3+json',
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
  const parts = title.toLowerCase().split(/[\s\-_/.]+/).filter(Boolean)
  return [...new Set(parts)]
}

export const githubSource: DataSource = {
  name: 'github',
  label: 'GitHub Trending',
  category: 'dev',
  refreshInterval: 15 * 60 * 1000,
  dailyLimit: 0,
  async fetch() {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const dateStr = yesterday.toISOString().split('T')[0]

    const raw = await httpsGet(
      `https://api.github.com/search/repositories?q=created:>${dateStr}&sort=stars&order=desc&per_page=30`
    )
    const data = JSON.parse(raw)
    const items = data?.items
    if (!Array.isArray(items)) return []

    return items.map((item: any): LocalSearchItem => {
      const title = `${item.full_name}: ${item.description || ''}`
      return {
        title,
        summary: item.description || item.full_name,
        url: item.html_url,
        source: 'github',
        category: 'dev',
        score: item.stargazers_count || 0,
        timestamp: Date.now(),
        keywords: extractKeywords(title),
      }
    })
  },
}
