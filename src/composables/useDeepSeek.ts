interface ChatOptions {
  messages: { role: 'user' | 'assistant'; content: string }[]
  model: string
  thinking: 'enabled' | 'disabled'
  apiKey: string
  signal?: AbortSignal
  onToken: (token: string) => void
  onThinking: (token: string) => void
  onUsage?: (usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; prompt_cache_hit_tokens: number; prompt_cache_miss_tokens: number }) => void
}

export async function deepSeekChat(options: ChatOptions) {
  const { messages, model, thinking, apiKey, signal, onToken, onThinking, onUsage } = options

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
  }

  // V4 Pro 和 V4 Flash 都支持思考模式
  if (thinking === 'enabled') {
    body.thinking = { type: 'enabled', reasoning_effort: 'high' }
  } else {
    body.thinking = { type: 'disabled' }
  }

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const errBody = await response.text()
    throw new Error(`API 错误 ${response.status}: ${errBody}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('无法读取响应流')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue

      const dataStr = trimmed.slice(5).trim()
      if (dataStr === '[DONE]') return

      try {
        const data = JSON.parse(dataStr)
        const delta = data.choices?.[0]?.delta

        if (delta?.reasoning_content) {
          onThinking(delta.reasoning_content)
        }
        if (delta?.content) {
          onToken(delta.content)
        }
        if (data.usage && typeof data.usage === 'object') {
          const u = data.usage
          onUsage?.({
            prompt_tokens: u.prompt_tokens ?? 0,
            completion_tokens: u.completion_tokens ?? 0,
            total_tokens: u.total_tokens ?? 0,
            prompt_cache_hit_tokens: u.prompt_cache_hit_tokens ?? 0,
            prompt_cache_miss_tokens: u.prompt_cache_miss_tokens ?? 0,
          })
        }
        // 记录最后一个有实际内容的 chunk 结构用于调试
        if (data.choices?.[0]?.finish_reason || (data.usage && typeof data.usage === 'object')) {
          localStorage.setItem('ds_last_sse', JSON.stringify(data, null, 2).substring(0, 2000))
        }
      } catch {
        // 忽略解析失败的行
      }
    }
  }
}
