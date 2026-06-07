import type { SearchHit } from './duckduckgo'

const EXCLUDED_DOMAINS = [
  'dict.baidu.com', 'zdic.net', 'dict.cn', 'dictionary.com',
  'merriam-webster.com', 'translate.google.com',
]

const LOW_QUALITY_DOMAINS = [
  'wenku.baidu.com',
  'csdn.net',
]

function getDomain(url: string): string {
  try { return new URL(url).hostname } catch { return '' }
}

export function filterResults(results: SearchHit[]): SearchHit[] {
  const filtered: SearchHit[] = []
  const lowQuality: SearchHit[] = []

  for (const r of results) {
    const domain = getDomain(r.url)
    if (EXCLUDED_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) continue
    if (LOW_QUALITY_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) {
      lowQuality.push(r)
      continue
    }
    filtered.push(r)
  }

  return [...filtered, ...lowQuality]
}
