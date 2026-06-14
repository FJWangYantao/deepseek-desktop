import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { extractMath } from './useMath'

// 全局 marked 配置：GFM + 软换行转 <br>。
// 助手窗口不复用 ContentBlock 的 setOptions，在此兜底，保证两窗口排版一致。
marked.setOptions({ breaks: true, gfm: true })

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

/**
 * Markdown → HTML 渲染管线。
 *
 * 顺序很重要（每一步都为下一步保护内容）：
 *   1. 提取公式（extractMath）—— 公式里的 _ ^ * 不能被 marked/fixCjkEmphasis 破坏
 *   2. 提取填空横线 —— 连续下划线/零宽空格要在 fixCjkEmphasis 清理零宽空格前保护
 *   3. fixCjkEmphasis —— CJK 与强调界符之间补零宽空格（公式与横线已是占位符，不受影响）
 *   4. marked 解析 → 还原公式与横线
 *   5. 来源引用、明文链接化（http(s)://、www.、括号内域名）
 *   6. DOMPurify 统一净化
 */
export function renderMarkdown(raw: string): string {
  // 1. 提取公式（含 $...$ 行内公式）
  const { text: textWoMath, blocks } = extractMath(raw)
  let text = textWoMath

  // 2. 提取填空横线（连续下划线/零宽空格，常见于试卷填空；须在 fixCjkEmphasis 前保护）
  const fills: string[] = []
  text = text.replace(/_[​_]{2,}/g, () => {
    fills.push(`<span class="fill-blank" style="display:inline-block;min-width:3em;border-bottom:1px solid currentColor;height:0.85em;vertical-align:bottom;margin:0 3px;"></span>`)
    return `\x00F${fills.length - 1}\x00`
  })

  // 3. CJK 强调修复
  text = fixCjkEmphasis(text)

  // 4. marked 解析
  let html = marked.parse(text) as string

  // 5. 还原公式与横线
  html = html.replace(/\x00M(\d+)\x00/g, (_, i) => blocks[+i] ?? '')
  html = html.replace(/\x00F(\d+)\x00/g, (_, i) => fills[+i] ?? '')

  // 6. 来源引用样式化
  html = html.replace(/【来源\s*(\d+)】/g, '<span class="cite-tag">[$1]</span>')

  // 链接化前先保护 <pre> 块，避免代码里的 xxx.yyy 被当成域名误链接化
  const preBlocks: string[] = []
  html = html.replace(/<pre[\s\S]*?<\/pre>/g, (m) => {
    preBlocks.push(m)
    return `\x00P${preBlocks.length - 1}\x00`
  })

  // 明文 URL → 可点击链接：http(s):// 完整 URL、www. 开头域名
  html = html.replace(
    /(?<!href="|">)(https?:\/\/[^\s<>"')\]]+|www\.[\w.-]+\.[a-z]{2,}(?:\/[^\s<>"')\]]*)?)/gi,
    (m) => {
      const url = /^https?:\/\//i.test(m) ? m : `http://${m}`
      return `<a href="${url}" target="_blank" rel="noopener" class="cite-link">${m}</a>`
    },
  )
  // 括号内域名（处理「文字 (url)」写法，含非 www 域名如 max.book118.com）
  html = html.replace(
    /\(([\w.-]+\.[a-z]{2,}(?:\/[\w./?=&%#~-]*)?)\)/gi,
    (_, domain) => `(<a href="http://${domain}" target="_blank" rel="noopener" class="cite-link">${domain}</a>)`,
  )

  // 还原 <pre>
  html = html.replace(/\x00P(\d+)\x00/g, (_, i) => preBlocks[+i] ?? '')

  // 7. 最终统一净化：剥离 <script>/事件属性/危险协议，保留 KaTeX/常用 Markdown 标签
  // 单点防御：useMarkdown 的所有调用方都受此保护，无需在每个 v-html 出口重复 sanitize
  html = DOMPurify.sanitize(html, {
    ADD_TAGS: ['math', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'msqrt', 'mtext', 'annotation', 'semantics'],
    ADD_ATTR: ['target', 'rel', 'class', 'style'],
    FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'input'],
    ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel|data:image\/(?:png|jpe?g|gif|webp|svg\+xml)):/i,
  })

  return html
}
