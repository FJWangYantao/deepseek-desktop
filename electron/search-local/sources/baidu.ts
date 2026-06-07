import * as https from 'https'
import * as cheerio from 'cheerio'
import type { DataSource, LocalSearchItem } from '../types'

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
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

export const baiduSource: DataSource = {
  name: 'baidu',
  label: '百度热搜',
  category: 'news',
  refreshInterval: 5 * 60 * 1000,
  dailyLimit: 0,
  async fetch() {
    const html = await httpsGet('https://top.baidu.com/board?tab=realtime')
    const $ = cheerio.load(html)
    const items: LocalSearchItem[] = []

    $('#sanRoot .category-wrap_iQLoo .c-single-text-ellipsis').each((i, el) => {
      if (i >= 30) return false
      const title = $(el).text().trim()
      if (!title) return

      const parent = $(el).closest('.category-wrap_iQLoo')
      const href = parent.find('a').first().attr('href') || ''
      const hotTag = parent.find('.hot-index_1Bl1a').text().trim()
      const hotNum = parseInt(hotTag.replace(/[^\d]/g, '')) || (30 - i)

      items.push({
        title,
        summary: title,
        url: href || `https://www.baidu.com/s?wd=${encodeURIComponent(title)}`,
        source: 'baidu',
        category: 'news',
        score: hotNum,
        timestamp: Date.now(),
        keywords: extractKeywords(title),
      })
    })

    return items
  },
}
