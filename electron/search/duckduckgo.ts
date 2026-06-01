import * as http from 'http'
import * as https from 'https'

export interface SearchResult {
  title: string
  url: string
  snippet: string
  content: string
}

// ===== 底层 HTTP GET =====

function httpGet(url: string, timeout = 8000): Promise<string> {
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
        const redirectUrl = new URL(res.headers.location, url).href
        resolve(httpGet(redirectUrl, timeout))
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
    // 用正则移除不可见标签后提取可见文本（避免 cheerio 在大文件上的性能问题）
    const cleaned = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
      .replace(/<[^>]+>/g, ' ')
    const text = cleaned
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&nbsp;/g, ' ')
    return text.replace(/\s{3,}/g, '\n\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 3000)
  } catch {
    return ''
  }
}

// ===== Bing 搜索 =====

async function searchBing(query: string): Promise<SearchResult[]> {
  const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}`
  console.log('[SearchBing] 请求 URL:', url)
  const html = await httpGet(url, 10000)
  console.log('[SearchBing] HTML 长度:', html.length)
  if (!html) { console.warn('[SearchBing] HTML 为空'); return [] }

  // 提取 b_results 容器
  const olStart = html.indexOf('<ol id="b_results"')
  console.log('[SearchBing] b_results 位置:', olStart)
  if (olStart === -1) return []
  const olEnd = html.indexOf('</ol>', olStart)
  if (olEnd === -1) return []
  const container = html.substring(olStart, olEnd)

  // 按 b_algo 分割
  const parts = container.split(/<li class="b_algo"/)
  if (parts.length < 2) return []

  const titleRe = /<h2[^>]*><a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a><\/h2>/i
  const snippetRe = /<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i

  const raw: { title: string; url: string; snippet: string }[] = []
  for (let i = 1; i < parts.length; i++) {
    const tm = titleRe.exec(parts[i])
    if (!tm) continue
    const title = tm[2].replace(/<[^>]+>/g, '').trim()
    const url = tm[1]
    const sm = snippetRe.exec(parts[i])
    const snippet = sm ? sm[1].replace(/<[^>]+>/g, '').replace(/&ensp;|&#0183;/g, ' ').trim() : ''
    if (title && url) raw.push({ title, url, snippet })
  }

  if (raw.length === 0) return []

  const results: SearchResult[] = []
  for (const r of raw.slice(0, 3)) {
    let content = ''
    try {
      const pageHtml = await httpGet(r.url, 8000)
      content = extractText(pageHtml)
    } catch {
      // 跳过
    }
    results.push({ title: r.title, url: r.url, snippet: r.snippet, content })
    await new Promise(resolve => setTimeout(resolve, 300))
  }

  return results
}

// ===== DuckDuckGo 搜索（回退） =====

async function searchDDG(query: string): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const html = await httpGet(url, 10000)
  if (!html) return []

  const blockRe = /<div class="result[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi
  const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i

  const raw: { title: string; url: string; snippet: string }[] = []
  let match: RegExpExecArray | null
  while ((match = blockRe.exec(html)) !== null) {
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
    if (title && url) raw.push({ title, url, snippet })
  }

  if (raw.length === 0) return []

  const results: SearchResult[] = []
  for (const r of raw.slice(0, 3)) {
    let content = ''
    try {
      const pageHtml = await httpGet(r.url, 8000)
      content = extractText(pageHtml)
    } catch {
      // 跳过
    }
    results.push({ title: r.title, url: r.url, snippet: r.snippet, content })
    await new Promise(resolve => setTimeout(resolve, 300))
  }

  return results
}

// ===== 多引擎搜索 =====

export async function searchWeb(query: string): Promise<SearchResult[]> {
  console.log('[Search::searchWeb] 启动搜索, 查询:', query)
  // 优先 Bing（国内可用），回退 DDG
  try {
    console.log('[Search::searchWeb] 尝试 Bing...')
    const results = await searchBing(query)
    if (results.length > 0) {
      console.log('[Search::searchWeb] Bing 返回', results.length, '条结果')
      return results
    }
    console.warn('[Search::searchWeb] Bing 返回空结果，尝试 DDG...')
  } catch (e) {
    console.error('[Search::searchWeb] Bing 搜索失败:', e)
  }

  try {
    const results = await searchDDG(query)
    if (results.length > 0) {
      console.log('[Search::searchWeb] DDG 返回', results.length, '条结果')
      return results
    }
    console.warn('[Search::searchWeb] DDG 也返回空结果')
  } catch (e) {
    console.error('[Search::searchWeb] DDG 搜索失败:', e)
  }

  console.warn('[Search::searchWeb] 最终返回空数组')
  return []
}

// ===== 直接抓取 URL =====

export async function fetchUrl(url: string): Promise<string> {
  const html = await httpGet(url, 10000)
  return extractText(html)
}
