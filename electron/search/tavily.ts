import { searchWebLight, type SearchHit } from './duckduckgo'
import { createLogger } from '../logger'

const log = createLogger('tavily')

const TAVILY_URL = 'https://api.tavily.com/search'
let tavilyApiKey = ''

export interface TavilySearchOptions {
  maxResults?: number
  searchDepth?: 'basic' | 'advanced' | 'fast' | 'ultra-fast'
}

interface TavilyResult {
  title?: unknown
  url?: unknown
  content?: unknown
}

interface TavilyResponse {
  results?: TavilyResult[]
}

export function setTavilyApiKey(key: string): void {
  tavilyApiKey = key.trim()
}

function toHit(r: TavilyResult): SearchHit | null {
  if (typeof r.title !== 'string' || typeof r.url !== 'string') return null
  const snippet = typeof r.content === 'string' ? r.content : ''
  if (!r.title.trim() || !r.url.trim()) return null
  return { title: r.title.trim(), url: r.url.trim(), snippet: snippet.trim() }
}

export async function searchTavilyLight(query: string, opts: TavilySearchOptions = {}): Promise<SearchHit[]> {
  if (!tavilyApiKey) return []
  const q = query.trim()
  if (!q) return []

  try {
    const resp = await fetch(TAVILY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tavilyApiKey}`,
      },
      body: JSON.stringify({
        query: q,
        search_depth: opts.searchDepth ?? 'basic',
        max_results: opts.maxResults ?? 8,
        include_answer: false,
        include_raw_content: false,
      }),
    })

    if (!resp.ok) {
      const err = await resp.text().catch(() => '')
      log.warn('HTTP 非 2xx', { status: resp.status, body: err.slice(0, 200) })
      return []
    }

    const data = await resp.json() as TavilyResponse
    if (!Array.isArray(data.results)) return []
    return data.results.map(toHit).filter((h): h is SearchHit => h !== null)
  } catch (e) {
    log.warn('调用失败', { err: e instanceof Error ? e.message : String(e) })
    return []
  }
}

export async function searchTavilyThenFallback(
  query: string,
  fallback: (q: string) => Promise<SearchHit[]> = searchWebLight,
): Promise<SearchHit[]> {
  const tavilyHits = await searchTavilyLight(query)
  if (tavilyHits.length > 0) return tavilyHits
  return fallback(query)
}
