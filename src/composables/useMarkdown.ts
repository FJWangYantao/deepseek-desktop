import katex from 'katex'
import { marked } from 'marked'

const ZWSP = '​'

// 修复 CJK 字符紧贴 **/__/*/_ 导致 marked 无法解析加粗/斜体
// 核心原理：marked 遵循 CommonMark，要求左界符前面是空白/标点/行首。
// CJK 字符（Unicode Lo 类）既非空白也非 ASCII 标点，会导致左界符识别失败。
// 在 CJK 字符与界符之间插入零宽空格，使界符前出现"空白"，从而被正确识别。
// 注意：绝不能在界符内侧插入 ZWSP，否则 marked 认为界符后跟空格，同样失败。
export function fixCjkEmphasis(text: string): string {
  // 先清除已有零宽空格，防止重复处理累积
  text = text.replace(/​/g, '')

  // 只匹配「非ASCII字符 + 紧接界符」的模式，在外侧插入 ZWSP
  const C = '[^\\x00-\\x7F\\s]'

  text = text
    .replace(new RegExp(`(${C})(\\*\\*)`, 'g'), `$1${ZWSP}$2`)
    .replace(new RegExp(`(${C})(__)`, 'g'), `$1${ZWSP}$2`)
    .replace(new RegExp(`(${C})(\\*)(?!\\*)`, 'g'), `$1${ZWSP}$2`)
    .replace(new RegExp(`(${C})(_)(?!_)`, 'g'), `$1${ZWSP}$2`)

  // 修复行首界符紧跟标点导致左界符识别失败（CommonMark 左界符规则）
  // 例：**"迷茫"... 中 ** 在行首且紧跟 "，不满足 left-flanking 条件
  text = text
    .replace(/(^|\n)(\*\*)(\p{P})/gu, `$1$2${ZWSP}$3`)
    .replace(/(^|\n)(__)(\p{P})/gu, `$1$2${ZWSP}$3`)
    .replace(/(^|\n)(\*)(?!\*)(\p{P})/gu, `$1$2${ZWSP}$3`)
    .replace(/(^|\n)(_)(?!_)(\p{P})/gu, `$1$2${ZWSP}$3`)

  return text
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

  // 来源引用样式化
  html = html.replace(/【来源\s*(\d+)】/g, '<span class="cite-tag">[$1]</span>')

  // 明文 URL → 可点击链接（跳过已在 <a> 标签内的）
  html = html.replace(/(?<!href="|">)(https?:\/\/[^\s<>"')\]]+)/g, '<a href="$1" target="_blank" rel="noopener" class="cite-link">$1</a>')

  return html
}
