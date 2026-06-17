/**
 * Tavily 搜索模块测试（离线，不调用真实 Tavily API）。
 * 用法：npx tsx tests/tavily-search.test.ts
 */
import {
  setTavilyApiKey,
  searchTavilyLight,
  searchTavilyThenFallback,
} from '../electron/search/tavily'
import type { SearchHit } from '../electron/search/duckduckgo'

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, cond: unknown, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

const originalFetch = globalThis.fetch
const originalWarn = console.warn
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith('[tavily]')) return
  originalWarn(...args)
}
let fetchCalls = 0

function setFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  fetchCalls = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls++
    return handler(input, init)
  }) as typeof fetch
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

console.log('\n[1] searchTavilyLight — no key')
{
  setTavilyApiKey('')
  setFetch(async () => jsonResponse({ results: [] }))
  const hits = await searchTavilyLight('黄仁勋 女儿 订婚')
  check('无 key 返回空数组', Array.isArray(hits) && hits.length === 0)
  check('无 key 不调用 fetch', fetchCalls === 0, `fetchCalls=${fetchCalls}`)
}

console.log('\n[2] searchTavilyLight — success mapping')
{
  setTavilyApiKey('tvly-test')
  setFetch(async (input, init) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    const body = JSON.parse(String(init?.body))
    check('调用 Tavily endpoint', url === 'https://api.tavily.com/search', url)
    check('使用 Bearer token', headers.get('Authorization') === 'Bearer tvly-test')
    check('请求体含 query', body.query === 'Elon Musk Twitter acquisition price')
    check('默认 max_results=8', body.max_results === 8)
    check('默认 search_depth=basic', body.search_depth === 'basic')
    check('默认不请求 answer', body.include_answer === false)
    check('默认不请求 raw content', body.include_raw_content === false)
    return jsonResponse({
      results: [
        { title: 'Elon Musk completes Twitter acquisition', url: 'https://example.com/musk-twitter', content: 'Musk bought Twitter for $44 billion.', score: 0.9 },
      ],
    })
  })
  const hits = await searchTavilyLight('Elon Musk Twitter acquisition price')
  check('映射 title', hits[0]?.title === 'Elon Musk completes Twitter acquisition')
  check('映射 url', hits[0]?.url === 'https://example.com/musk-twitter')
  check('映射 content→snippet', hits[0]?.snippet === 'Musk bought Twitter for $44 billion.')
}

console.log('\n[3] searchTavilyLight — error handling')
{
  setTavilyApiKey('tvly-test')
  setFetch(async () => jsonResponse({ error: 'bad' }, 500))
  const httpFail = await searchTavilyLight('x')
  check('HTTP 非 2xx 返回空', httpFail.length === 0)

  setFetch(async () => jsonResponse({ nope: [] }))
  const badShape = await searchTavilyLight('x')
  check('results 缺失返回空', badShape.length === 0)

  setFetch(async () => { throw new Error('network down') })
  const networkFail = await searchTavilyLight('x')
  check('网络错误返回空', networkFail.length === 0)
}

console.log('\n[4] searchTavilyThenFallback — priority/fallback')
{
  setTavilyApiKey('tvly-test')
  setFetch(async () => jsonResponse({
    results: [{ title: 'Tavily hit', url: 'https://tavily.example', content: 'from tavily' }],
  }))
  const fallback = async (): Promise<SearchHit[]> => [{ title: 'Fallback hit', url: 'https://fallback.example', snippet: 'from fallback' }]
  const tavilyHits = await searchTavilyThenFallback('q', fallback)
  check('Tavily 有结果时优先 Tavily', tavilyHits[0]?.title === 'Tavily hit')

  setFetch(async () => jsonResponse({ results: [] }))
  const fallbackHits = await searchTavilyThenFallback('q', fallback)
  check('Tavily 空结果时回退 fallback', fallbackHits[0]?.title === 'Fallback hit')
}

globalThis.fetch = originalFetch
console.warn = originalWarn
setTavilyApiKey('')

console.log(`\n${failed === 0 ? '✓' : '✗'} ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\n失败项：')
  failures.forEach(f => console.log('  - ' + f))
}
process.exit(failed > 0 ? 1 : 0)
