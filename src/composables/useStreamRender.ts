import { ref, readonly } from 'vue'

/**
 * 流式渲染状态机
 * 状态: NORMAL | IN_CODE_BLOCK
 * 用于判断当前流式内容是否包含未闭合的代码块
 */
export function useStreamRender() {
  const state = ref<'NORMAL' | 'IN_CODE_BLOCK'>('NORMAL')

  function processChunk(chunk: string, existing: string): {
    safeContent: string
    pendingContent: string
    state: 'NORMAL' | 'IN_CODE_BLOCK'
  } {
    const full = existing + chunk

    // 统计代码块标记数量
    const ticks = (full.match(/```/g) || []).length

    if (ticks % 2 === 0) {
      // 偶数个 ``` — 所有代码块都已闭合，安全渲染
      state.value = 'NORMAL'
      return { safeContent: full, pendingContent: '', state: 'NORMAL' }
    } else {
      // 奇数个 ``` — 有一个代码块未闭合
      const lastTriple = full.lastIndexOf('```')
      const beforeLastTicks = (full.slice(0, lastTriple).match(/```/g) || []).length

      if (beforeLastTicks % 2 === 0) {
        // 最后一个 ``` 是开启标记
        state.value = 'IN_CODE_BLOCK'
        return {
          safeContent: full.slice(0, lastTriple),
          pendingContent: full.slice(lastTriple),
          state: 'IN_CODE_BLOCK',
        }
      } else {
        // 最后一个 ``` 是闭合标记（不太可能但处理边界）
        state.value = 'NORMAL'
        return { safeContent: full, pendingContent: '', state: 'NORMAL' }
      }
    }
  }

  return {
    state: readonly(state),
    processChunk,
  }
}
