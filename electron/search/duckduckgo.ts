import * as http from 'http'
import * as https from 'https'
import * as cheerio from 'cheerio'

export interface SearchResult {
  title: string
  url: string
  snippet: string
  content: string
}

export interface SearchHit {
  title: string
  url: string
  snippet: string
}

// ===== 底层 HTTP GET =====

function httpGet(url: string, timeout = 8000, maxRedirects = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      timeout,
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (maxRedirects <= 0) {
          reject(new Error(`Too many redirects: ${url}`))
          return
        }
        const redirectUrl = new URL(res.headers.location, url).href
        resolve(httpGet(redirectUrl, timeout, maxRedirects - 1))
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 5 * 1024 * 1024) {
          req.destroy()
          resolve('')
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)) })
  })
}

// ===== 正文提取 =====

function extractText(html: string): string {
  try {
    const $ = cheerio.load(html)
    // 移除不可见/干扰元素
    $('script, style, nav, footer, header, noscript, iframe, aside, [role="navigation"], .sidebar, .nav, .footer, .header, .ad, .advertisement, .menu, [aria-hidden="true"]').remove()
    // 获取 body 文本，回退 html
    const raw = ($('body').text() || $('html').text() || '').trim()
    if (!raw) return ''
    // 规范化空白
    const text = raw
      .replace(/[ \t]{3,}/g, '  ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return text.slice(0, 30000)
  } catch {
    return ''
  }
}

// ===== Bing HTML 解析 =====

function parseBingHtml(html: string): SearchHit[] {
  const olStart = html.indexOf('<ol id="b_results"')
  if (olStart === -1) return []
  const olEnd = html.indexOf('</ol>', olStart)
  if (olEnd === -1) return []
  const container = html.substring(olStart, olEnd)

  const parts = container.split(/<li class="b_algo"/)
  if (parts.length < 2) return []

  const titleRe = /<h2[^>]*><a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a><\/h2>/i
  const snippetRe = /<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i

  const results: SearchHit[] = []
  for (let i = 1; i < parts.length; i++) {
    const tm = titleRe.exec(parts[i])
    if (!tm) continue
    const title = tm[2].replace(/<[^>]+>/g, '').trim()
    const url = tm[1]
    const sm = snippetRe.exec(parts[i])
    const snippet = sm ? sm[1].replace(/<[^>]+>/g, '').replace(/&ensp;|&#0183;/g, ' ').trim() : ''
    if (title && url) results.push({ title, url, snippet })
  }
  return results
}

// ===== Bing 搜索（轻量版） =====

async function searchBingLight(query: string): Promise<SearchHit[]> {
  const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}`
  const html = await httpGet(url, 6000)
  if (!html) return []
  return parseBingHtml(html)
}

// ===== Bing 搜索（完整版，含页面抓取） =====

async function searchBing(query: string): Promise<SearchResult[]> {
  const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}`
  const html = await httpGet(url, 6000)
  if (!html) return []
  const hits = parseBingHtml(html)
  if (hits.length === 0) return []
  return fetchPageContents(hits.slice(0, 5))
}

// ===== DuckDuckGo HTML 解析 =====

function parseDDGHtml(html: string): SearchHit[] {
  // DDG 的赞助/广告条目 class 通常是 "result result--ad" 或 "result--sponsored"，
  // 旧正则 /class="result[^"]*"/ 会把这些块也吃进来，混进搜索结果。
  // 这里同样拿到 class 字符串后显式排除广告类。
  const blockRe = /<div class="(result[^"]*)"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi
  const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i

  const results: SearchHit[] = []
  let match: RegExpExecArray | null
  while ((match = blockRe.exec(html)) !== null) {
    const classStr = match[1]
    if (/result--ad|result--sponsored|result--more/.test(classStr)) continue
    const block = match[0]
    const lm = linkRe.exec(block)
    if (!lm) continue
    const title = lm[2].replace(/<[^>]+>/g, '').trim()
    let url = lm[1]
    if (url.startsWith('//')) url = 'https:' + url
    if (url.includes('/l/?uddg=')) {
      try {
        const u = new URL(url)
        const uddg = u.searchParams.get('uddg')
        if (uddg) url = decodeURIComponent(uddg)
      } catch {}
    }
    const sm = snippetRe.exec(block)
    const snippet = sm ? sm[1].replace(/<[^>]+>/g, '').trim() : ''
    if (title && url) results.push({ title, url, snippet })
  }
  return results
}

// ===== DuckDuckGo 搜索（轻量版） =====

async function searchDDGLight(query: string): Promise<SearchHit[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const html = await httpGet(url, 6000)
  if (!html) return []
  return parseDDGHtml(html)
}

// ===== DuckDuckGo 搜索（完整版） =====

async function searchDDG(query: string): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const html = await httpGet(url, 6000)
  if (!html) return []
  const hits = parseDDGHtml(html)
  if (hits.length === 0) return []
  return fetchPageContents(hits.slice(0, 5))
}

// ===== 国际 Bing 搜索（轻量版） =====

async function searchBingEnLight(query: string): Promise<SearchHit[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`
  const html = await httpGetCustom(url, 6000, 'en-US,en;q=0.9')
  if (!html) return []
  return parseBingHtml(html)
}

// ===== 国际 Bing 搜索（完整版） =====

async function searchBingEn(query: string): Promise<SearchResult[]> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`
  const html = await httpGetCustom(url, 6000, 'en-US,en;q=0.9')
  if (!html) return []
  const hits = parseBingHtml(html)
  if (hits.length === 0) return []
  return fetchPageContents(hits.slice(0, 5))
}

// ===== 自定义 Accept-Language GET =====

function httpGetCustom(url: string, timeout: number, acceptLang: string, maxRedirects = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': acceptLang,
      },
      timeout,
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (maxRedirects <= 0) {
          reject(new Error(`Too many redirects: ${url}`))
          return
        }
        const redirectUrl = new URL(res.headers.location, url).href
        resolve(httpGetCustom(redirectUrl, timeout, acceptLang, maxRedirects - 1))
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 5 * 1024 * 1024) { req.destroy(); resolve(''); return }
        chunks.push(chunk)
      })
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)) })
  })
}

// ===== 批量抓取页面内容 =====

async function fetchPageContents(items: { title: string; url: string; snippet: string }[]): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  for (const r of items) {
    let content = ''
    try {
      const pageHtml = await httpGet(r.url, 8000)
      content = extractText(pageHtml)
    } catch { /* skip */ }
    results.push({ title: r.title, url: r.url, snippet: r.snippet, content })
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  return results
}

// ===== 多引擎搜索（轻量版，竞速截断） =====

export async function searchWebLight(query: string): Promise<SearchHit[]> {
  const FAST_DEADLINE = 3000
  const FULL_DEADLINE = 8000
  const MIN_FAST = 3

  const tasks = [
    searchBingLight(query).catch(() => [] as SearchHit[]),
    searchDDGLight(query).catch(() => [] as SearchHit[]),
    searchBingEnLight(query).catch(() => [] as SearchHit[]),
  ]

  const seen = new Set<string>()
  const merged: SearchHit[] = []

  function mergeResults(newResults: SearchHit[]) {
    for (const r of newResults) {
      if (!seen.has(r.url)) {
        seen.add(r.url)
        merged.push(r)
      }
    }
  }

  await new Promise<void>(resolve => {
    let resolved = false
    const done = () => { if (!resolved) { resolved = true; resolve() } }

    const fullTimer = setTimeout(done, FULL_DEADLINE)
    const fastTimer = setTimeout(() => {
      if (merged.length >= MIN_FAST) done()
    }, FAST_DEADLINE)

    for (const task of tasks) {
      task.then(results => {
        mergeResults(results)
        if (merged.length >= MIN_FAST) {
          clearTimeout(fastTimer)
          clearTimeout(fullTimer)
          done()
        }
      })
    }

    Promise.all(tasks).then(() => {
      clearTimeout(fastTimer)
      clearTimeout(fullTimer)
      done()
    })
  })

  return merged
}

// ===== 多引擎搜索（完整版，含页面抓取） =====

export async function searchWeb(query: string): Promise<SearchResult[]> {
  const [cnResults, enResults, ddgResults] = await Promise.all([
    searchBing(query).catch(() => [] as SearchResult[]),
    searchBingEn(query).catch(() => [] as SearchResult[]),
    searchDDG(query).catch(() => [] as SearchResult[]),
  ])

  const seen = new Set<string>()
  const merged: SearchResult[] = []
  for (const r of [...cnResults, ...enResults, ...ddgResults]) {
    if (!seen.has(r.url)) {
      seen.add(r.url)
      merged.push(r)
    }
  }
  return merged
}

// ===== 直接抓取 URL =====

export async function fetchUrl(url: string): Promise<string> {
  const html = await httpGet(url, 10000)
  return extractText(html)
}
