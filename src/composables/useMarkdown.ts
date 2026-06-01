import katex from 'katex'
import { marked } from 'marked'

// 修复 CJK 标点紧贴 **/__ 导致 CommonMark 无法解析加粗/斜体
export function fixCjkEmphasis(text: string): string {
  const punct = '‘-‟　-〿＀-￯，。、；：！？'
  return text
    .replace(new RegExp(`\\*\\*([${punct}])`, 'g'), '**​$1')
    .replace(new RegExp(`([${punct}])\\*\\*`, 'g'), '$1​**')
}

// 在 marked 之前：提取 LaTeX 公式，用 KaTeX 渲染，生成占位符
export function renderMarkdown(raw: string): string {
  // 提取 LaTeX 公式，渲染为 HTML，用占位符替换
  const blocks: string[] = []
  let text = raw

  // $$...$$ display math
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, tex) => {
    try {
      blocks.push(katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false }))
    } catch { blocks.push(tex) }
    return `\x00M${blocks.length - 1}\x00`
  })

  // \[...\] display math
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, tex) => {
    try {
      blocks.push(katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false }))
    } catch { blocks.push(tex) }
    return `\x00M${blocks.length - 1}\x00`
  })

  // \(...\) inline math
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, tex) => {
    try {
      blocks.push(katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false }))
    } catch { blocks.push(tex) }
    return `\x00M${blocks.length - 1}\x00`
  })

  // marked 解析
  let html = marked.parse(text) as string

  // 还原占位符
  html = html.replace(/\x00M(\d+)\x00/g, (_, i) => blocks[+i] ?? '')

  return html
}
