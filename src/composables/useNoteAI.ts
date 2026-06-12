import { useSettingsStore } from '@/stores/settings'

/**
 * 笔记 AI 辅助 composable
 *
 * 提供 4 个 AI 动作：总结、提炼要点、润色、续写
 * 全部使用 deepseek-v4-flash 非流式调用，复用 generateTitle() 相同的 fetch 模式
 */

const API_URL = 'https://api.deepseek.com/v1/chat/completions'

const PROMPTS = {
  summarize: '你是一个笔记助手。根据用户收藏的内容，生成一段简洁的中文摘要笔记。直接输出摘要内容，不要多余解释。',
  extractKeyPoints: '你是一个笔记助手。从用户收藏的内容和已有笔记中，提炼出关键要点，以 Markdown 无序列表格式输出。直接输出要点，不要多余解释。',
  polish: '你是一个写作助手。优化以下笔记的文字表达，使其更清晰、更专业。保持原意不变，直接输出润色后的内容。',
  continueWriting: '你是一个写作助手。根据用户的收藏内容和已有笔记，继续写下去，延续已有风格和主题。直接输出续写内容。',
}

async function callAI(
  systemPrompt: string,
  userContent: string,
  apiKey: string,
  maxTokens = 1000,
): Promise<string> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      thinking: { type: 'disabled' },
      max_tokens: maxTokens,
    }),
  })

  if (!res.ok) {
    console.warn('[NoteAI] API 错误:', res.status)
    return ''
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() ?? ''
}

export function useNoteAI() {
  const settingsStore = useSettingsStore()

  /**
   * 总结：基于收藏原文生成摘要笔记
   * 注入记忆上下文以生成更个性化的摘要
   */
  async function summarize(content: string, memoryContext?: string): Promise<string> {
    if (!settingsStore.apiKey) return ''
    const sys = PROMPTS.summarize + (memoryContext ? '\n\n' + memoryContext : '')
    try {
      return await callAI(sys, `请总结以下收藏内容：\n\n${content}`, settingsStore.apiKey)
    } catch (e) {
      console.warn('[NoteAI] summarize 异常:', e)
      return ''
    }
  }

  /**
   * 提炼要点：基于收藏原文 + 已有笔记生成要点列表
   * 注入记忆上下文以生成更个性化的要点
   */
  async function extractKeyPoints(content: string, note: string, memoryContext?: string): Promise<string> {
    if (!settingsStore.apiKey) return ''
    const sys = PROMPTS.extractKeyPoints + (memoryContext ? '\n\n' + memoryContext : '')
    const user = note
      ? `收藏内容：\n${content}\n\n已有笔记：\n${note}`
      : `请从以下内容中提炼要点：\n\n${content}`
    try {
      return await callAI(sys, user, settingsStore.apiKey)
    } catch (e) {
      console.warn('[NoteAI] extractKeyPoints 异常:', e)
      return ''
    }
  }

  /**
   * 润色：优化已有笔记的表达（不注入记忆）
   */
  async function polish(note: string): Promise<string> {
    if (!settingsStore.apiKey) return ''
    try {
      return await callAI(PROMPTS.polish, `请润色以下笔记：\n\n${note}`, settingsStore.apiKey)
    } catch (e) {
      console.warn('[NoteAI] polish 异常:', e)
      return ''
    }
  }

  /**
   * 续写：基于原文 + 已有笔记继续写（不注入记忆）
   */
  async function continueWriting(content: string, note: string): Promise<string> {
    if (!settingsStore.apiKey) return ''
    const user = `收藏内容：\n${content}\n\n已有笔记：\n${note}\n\n请继续续写。`
    try {
      return await callAI(PROMPTS.continueWriting, user, settingsStore.apiKey)
    } catch (e) {
      console.warn('[NoteAI] continueWriting 异常:', e)
      return ''
    }
  }

  return { summarize, extractKeyPoints, polish, continueWriting }
}
