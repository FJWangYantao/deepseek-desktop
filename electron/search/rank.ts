import type { SearchHit } from './duckduckgo'

interface ScoredHit {
  hit: SearchHit
  score: number
  domain: string
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|spm|from|ref|source|tracking)/.test(key)) u.searchParams.delete(key)
    }
    u.hash = ''
    return u.toString().toLowerCase().replace(/\/+$/, '')
  } catch {
    return url.toLowerCase()
  }
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function extractKeywords(text: string): string[] {
  const lower = text.toLowerCase()
  const cjk = lower.match(/[一-鿿]{2,4}/g) || []
  const en = lower.match(/[a-z][a-z0-9]*/g) || []
  return [...new Set([...cjk, ...en])]
}

function snippetQualityScore(snippet: string): number {
  if (!snippet) return -3
  const len = snippet.length
  if (len < 20) return -2
  if (len < 50) return 0
  if (len > 200) return 3
  if (len > 100) return 2
  return 1
}

export function scoreAndRank(results: SearchHit[], query: string): SearchHit[] {
  const queryKeywords = extractKeywords(query)

  const seenUrls = new Map<string, ScoredHit>()

  for (const r of results) {
    const normUrl = normalizeUrl(r.url)
    const domain = getDomain(r.url)

    let score = 0

    // 标题关键词匹配（精确等值，不再用 includes 双向）
    const titleKeywords = extractKeywords(r.title)
    for (const qk of queryKeywords) {
      if (titleKeywords.some(tk => tk === qk)) {
        score += 3
      } else if (titleKeywords.some(tk => tk.startsWith(qk) && tk.length <= qk.length + 2)) {
        score += 1
      }
    }

    // 片段关键词匹配
    const snippetKeywords = extractKeywords(r.snippet)
    for (const qk of queryKeywords) {
      if (snippetKeywords.some(sk => sk === qk)) {
        score += 1
      }
    }

    // 片段质量
    score += snippetQualityScore(r.snippet)

    // URL 质量惩罚
    if (/\/(video|image|gallery)\//.test(r.url)) score -= 2

    const existing = seenUrls.get(normUrl)
    if (!existing || existing.score < score) {
      seenUrls.set(normUrl, { hit: r, score, domain })
    }
  }

  // 排序后做来源多样性：同域名最多保留 2 条
  const sorted = [...seenUrls.values()].sort((a, b) => b.score - a.score)
  const domainCount = new Map<string, number>()
  const final: SearchHit[] = []
  const overflow: SearchHit[] = []

  for (const item of sorted) {
    const count = domainCount.get(item.domain) || 0
    if (count < 2) {
      final.push(item.hit)
      domainCount.set(item.domain, count + 1)
    } else {
      overflow.push(item.hit)
    }
    if (final.length >= 15) break
  }

  // 不够 15 条时从 overflow 补充
  if (final.length < 15) {
    final.push(...overflow.slice(0, 15 - final.length))
  }

  return final
}
