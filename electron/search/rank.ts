import type { SearchHit } from './duckduckgo'

interface ScoredHit {
  hit: SearchHit
  score: number
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    // 移除追踪参数
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|spm|from|ref|source|tracking)/.test(key)) u.searchParams.delete(key)
    }
    u.hash = ''
    return u.toString().toLowerCase().replace(/\/+$/, '')
  } catch {
    return url.toLowerCase()
  }
}

function extractKeywords(text: string): string[] {
  const lower = text.toLowerCase()
  // 中文按 2-4 字切分，英文按空格
  const cjk = lower.match(/[一-鿿]{2,4}/g) || []
  const en = lower.match(/[a-z0-9]+/g) || []
  return [...new Set([...cjk, ...en])]
}

export function scoreAndRank(results: SearchHit[], query: string): SearchHit[] {
  const queryKeywords = extractKeywords(query)
  const isChineseQuery = /[一-鿿]/.test(query)

  // URL 去重
  const seenUrls = new Map<string, ScoredHit>()

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    const normUrl = normalizeUrl(r.url)

    let score = 0

    // 标题匹配
    const titleKeywords = extractKeywords(r.title)
    for (const qk of queryKeywords) {
      if (titleKeywords.some(tk => tk.includes(qk) || qk.includes(tk))) score += 3
    }

    // 摘要匹配
    const snippetKeywords = extractKeywords(r.snippet)
    for (const qk of queryKeywords) {
      if (snippetKeywords.some(sk => sk.includes(qk) || qk.includes(sk))) score += 1
    }

    // 引擎权重（靠前的结果来自优先引擎）
    if (isChineseQuery && i < 10) score += 2   // CN Bing 优先
    if (!isChineseQuery && i >= 10 && i < 20) score += 2  // EN Bing 优先

    // URL 质量惩罚
    if (/\/video\//.test(r.url) || /\/image\//.test(r.url)) score -= 2

    const existing = seenUrls.get(normUrl)
    if (!existing || existing.score < score) {
      seenUrls.set(normUrl, { hit: r, score })
    }
  }

  return [...seenUrls.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(s => s.hit)
}
