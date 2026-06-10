import katex from 'katex'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

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

  // 修复界符与标点相邻导致的 CommonMark 界符识别失败：
  // - 左界符（**"...）：界符后紧跟标点 → ** 与标点间插 ZWSP
  // - 右界符（"**）：标点紧贴界符前 → 标点与 ** 间插 ZWSP
  // 注意：仅处理双界符 ** / __，单界符 * / _ 保留行首修复即可，
  // 因为 * 本身是 Unicode 标点，全位置替换会误匹配 ** 自身导致拆分。
  text = text
    .replace(/(\*\*)(\p{P})/gu, `$1${ZWSP}$2`)
    .replace(/(\p{P})(\*\*)/gu, `$1${ZWSP}$2`)
    .replace(/(__)(\p{P})/gu, `$1${ZWSP}$2`)
    .replace(/(\p{P})(__)/gu, `$1${ZWSP}$2`)

  // 行首单界符修复（原始逻辑，仅行首安全）
  text = text
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

  // 最终统一净化：剥离 <script>/事件属性/危险协议，保留 KaTeX/常用 Markdown 标签
  // 单点防御：useMarkdown 的所有调用方都受此保护，无需在每个 v-html 出口重复 sanitize
  html = DOMPurify.sanitize(html, {
    ADD_TAGS: ['math', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'msqrt', 'mtext', 'annotation', 'semantics'],
    ADD_ATTR: ['target', 'rel', 'class', 'style'],
    FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'input'],
    ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel|data:image\/(?:png|jpe?g|gif|webp|svg\+xml)):/i,
  })

  return html
}
