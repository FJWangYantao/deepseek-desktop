interface ChatOptions {
  messages: { role: 'user' | 'assistant'; content: string }[]
  model: string
  thinking: 'enabled' | 'disabled'
  apiKey: string
  onToken: (token: string) => void
  onThinking: (token: string) => void
}

export async function deepSeekChat(options: ChatOptions) {
  const { messages, model, thinking, apiKey, onToken, onThinking } = options

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
      } catch {
        // 忽略解析失败的行
      }
    }
  }
}
