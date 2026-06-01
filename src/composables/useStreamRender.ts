import { ref, readonly } from 'vue'

type State = 'NORMAL' | 'IN_CODE_BLOCK' | 'IN_INLINE_MATH' | 'IN_DISPLAY_MATH'

/**
 * 流式渲染状态机
 * 追踪代码块和 LaTeX 数学公式的闭合状态，确保不完整的块保持为纯文本
 */
export function useStreamRender() {
  const state = ref<State>('NORMAL')

  function processChunk(chunk: string, existing: string): {
    safeContent: string
    pendingContent: string
  } {
    const full = existing + chunk
    const cut = findCutPoint(full)
    return {
      safeContent: full.slice(0, cut),
      pendingContent: full.slice(cut),
    }
  }

  return {
    state: readonly(state),
    processChunk,
  }
}

function findCutPoint(text: string): number {
  let pos = 0
  let st: State = 'NORMAL'

  while (pos < text.length) {
    const rem = text.slice(pos)

    if (st === 'NORMAL') {
      // 找所有可能的开启/闭合标记
      const m = rem.match(/```|\\\(|\\\)|\\\[|\\\]|\$\$/)
      if (!m || m.index === undefined) return text.length // 全部安全

      const tok = m[0]
      const idx = m.index

      if (tok === '```') {
        st = 'IN_CODE_BLOCK'
        pos += idx + 3
      } else if (tok === '\\(') {
        st = 'IN_INLINE_MATH'
        pos += idx + 2
      } else if (tok === '\\[') {
        st = 'IN_DISPLAY_MATH'
        pos += idx + 2
      } else if (tok === '$$') {
        // $$ 在 NORMAL 状态下只会是开启（闭合在 IN_DISPLAY_MATH 处理）
        st = 'IN_DISPLAY_MATH'
        pos += idx + 2
      } else {
        // \) 或 \] — 孤立的闭合标记，跳过
        pos += idx + 2
      }
    } else if (st === 'IN_CODE_BLOCK') {
      const next = rem.indexOf('```')
      if (next === -1) {
        // 回溯到代码块开始处截断
        return backtrack(text, pos, '```')
      }
      st = 'NORMAL'
      pos += next + 3
    } else if (st === 'IN_INLINE_MATH') {
      const next = rem.search(/\\\)/)
      if (next === -1) {
        return backtrack(text, pos, '\\(')
      }
      st = 'NORMAL'
      pos += next + 2
    } else if (st === 'IN_DISPLAY_MATH') {
      const nb = rem.search(/\\\]/)
      const nd = rem.indexOf('$$')
      const next = nb === -1 ? nd : nd === -1 ? nb : Math.min(nb, nd)
      if (next === -1) {
        return backtrack(text, pos, '\\[')
      }
      st = 'NORMAL'
      pos += next + 2
    }
  }

  return text.length
}

// 从当前位置回溯到标记开始处
function backtrack(text: string, afterStart: number, marker: string): number {
  // afterStart 是标记之后的位置，需要减去标记长度得到标记开始位置
  let start = afterStart - marker.length
  // 向前搜索确认确实是这个标记
  const before = text.slice(Math.max(0, start - 10), start + marker.length)
  if (!before.endsWith(marker)) {
    // 安全回退：找到标记实际位置
    const idx = text.lastIndexOf(marker, afterStart - 1)
    if (idx !== -1) start = idx
  }
  return start
}
