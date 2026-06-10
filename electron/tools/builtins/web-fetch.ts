import type { ToolDefinition } from '../../../src/types/tools'
import type { ToolExecutor } from '../registry'
import { fetchUrl } from '../../search/duckduckgo'
import { browserFetch } from '../browser-fetch'

// ===== 四级回退抓取 =====

async function fetchWithFallback(url: string): Promise<{ content: string; source: string }> {
  // 1. 直接 HTTP GET（最快）
  try {
    const content = await fetchUrl(url)
    if (content && content.length > 100) {
      return { content, source: '直接抓取' }
    }
  } catch { /* fall through */ }

  // 2. Google 缓存
  try {
    const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`
    const cached = await fetchUrl(cacheUrl)
    if (cached && cached.length > 100) {
      const clean = cached.replace(/^.*?Google.*?cache.*?is\s+a\s+snapshot/i, '').trim()
      if (clean.length > 100) return { content: clean, source: 'Google 缓存' }
    }
  } catch { /* fall through */ }

  // 3. 文本提取服务
  try {
    const textUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//, '')}`
    const text = await fetchUrl(textUrl)
    if (text && text.length > 100) {
      return { content: text, source: '文本提取服务' }
    }
  } catch { /* fall through */ }

  // 4. Electron 浏览器渲染（真 Chromium，破反爬，最慢但最强）
  try {
    console.log(`[web_fetch] 前三级回退失败，尝试浏览器渲染: ${url}`)
    const rendered = await browserFetch(url, 8000)
    if (rendered && rendered.length > 100) {
      return { content: rendered, source: '浏览器渲染' }
    }
  } catch { /* fall through */ }

  return { content: '', source: '' }
}

function isZhihuUrl(url: string): boolean {
  return /zhihu\.com\/(question|answer|p|pin|column|zhuanlan)/.test(url)
}

const definition: ToolDefinition = {
  name: 'web_fetch',
  description: '抓取指定 URL 的网页内容提取纯文本。自动尝试直接抓取→Google缓存→文本提取服务三级回退。知乎链接因反爬会提示用搜索API。',
  category: 'network',
  permissions: 'auto',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '要抓取的网页 URL',
      },
    },
    required: ['url'],
  },
}

export const webFetchTool: ToolExecutor = {
  definition,
  async execute(args) {
    const url = args.url as string
    if (!url) throw new Error('缺少 URL')

    // 知乎：硬拦截，不做任何网络请求
    if (isZhihuUrl(url)) {
      return `⛔ 知乎页面无法抓取（登录墙）。web_search 结果中已包含知乎摘要，请直接使用搜索结果回答。\n\n原始URL: ${url}`
    }

    // 正常抓取 + 回退
    const { content, source } = await fetchWithFallback(url)
    if (!content || content.length < 50) {
      return `无法获取 ${url} 的内容。\n\n已尝试：直接抓取、Google 缓存、文本提取服务，均未获取到有效内容。\n\n可能原因：\n• 页面需要登录或验证\n• 页面是纯 JS 渲染（SPA）\n• 页面本身内容过少\n\n建议尝试搜索相关关键词获取信息。`
    }

    const label = source !== '直接抓取' ? `[来源: ${source}]\n\n` : ''
    return label + content.slice(0, 5000)
  },
}
