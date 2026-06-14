/**
 * 数学公式提取（纯函数，仅依赖 katex，无 DOM 依赖，便于在 node 下单测）
 *
 * 在 marked 解析之前，把所有 LaTeX 公式提取出来用 KaTeX 渲染，并用占位符替换，
 * 避免 marked 把公式里的 _ ^ * 等当成 markdown 界符破坏公式。
 *
 * 支持的定界符：
 *   $$...$$   display math
 *   \[...\]   display math
 *   \(...\)   inline math
 *   $...$     inline math（最常见的行内公式形式）
 *
 * $...$ 采用「两侧不贴空白」约束（开头 $ 后非空白、结尾 $ 前非空白），
 * 避免把价格（如 $5）或裸美元符误判为公式。
 *
 * 处理顺序：display 先于 inline，避免 $$ 被 $...$ 误匹配。
 */
import katex from 'katex'

export interface ExtractedMath {
  /** 公式已被替换为 \x00M{n}\x00 占位符的文本 */
  text: string
  /** 各占位符对应的 KaTeX 渲染 HTML，下标即占位符序号 */
  blocks: string[]
}

export function extractMath(raw: string): ExtractedMath {
  const blocks: string[] = []
  let text = raw

  const stash = (tex: string, displayMode: boolean): string => {
    try {
      blocks.push(katex.renderToString(tex.trim(), { displayMode, throwOnError: false }))
    } catch {
      blocks.push(tex)
    }
    return `\x00M${blocks.length - 1}\x00`
  }

  // display math（先于 inline）
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, t) => stash(t, true))
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, t) => stash(t, true))
  // inline math：\(...\)
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, t) => stash(t, false))
  // inline math：$...$（内容不含 $ 和换行；两侧不贴空白）
  text = text.replace(/\$(?!\s)([^\n$]+?)(?<!\s)\$/g, (_, t) => stash(t, false))

  return { text, blocks }
}
