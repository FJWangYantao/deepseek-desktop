/**
 * 划词助手 IPC handlers
 *
 * - assistant:hide  — 隐藏助手窗口
 * - assistant:query — 在主进程调 DeepSeek API（翻译/解释）
 */

import { ipcMain, safeStorage, app } from 'electron'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const API_URL = 'https://api.deepseek.com/v1/chat/completions'

const PROMPTS: Record<string, string> = {
  translate:
    '你是一个翻译助手。将以下文字翻译为目标语言：如果主要是中文就翻译为英文，如果主要是英文就翻译为中文。直接输出翻译结果，不要任何解释、注释或前缀。',
  explain:
    '你是一个知识助手。清晰简洁地解释以下文字的含义。如果涉及专业术语，给出通俗说明。直接输出解释内容，不要任何前缀。',
}

/** 从加密存储读取 API key（与 secure-storage.ts 相同逻辑） */
function getApiKey(): string {
  try {
    if (!safeStorage.isEncryptionAvailable()) return ''
    const storePath = join(app.getPath('userData'), 'secure-store.json')
    if (!existsSync(storePath)) return ''
    const store = JSON.parse(readFileSync(storePath, 'utf-8'))
    const encrypted = store['ds_api_key']
    if (!encrypted) return ''
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch {
    return ''
  }
}

async function callDeepSeek(
  systemPrompt: string,
  userText: string,
  apiKey: string,
): Promise<string> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
      thinking: { type: 'disabled' },
      max_tokens: 1000,
    }),
  })

  if (!res.ok) {
    console.warn('[Assistant] API 错误:', res.status)
    return ''
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() ?? ''
}

// 助手窗口引用（由 main.ts 通过 setAssistantWindow 注入）
let assistantWin: Electron.BrowserWindow | null = null

export function setAssistantWindow(win: Electron.BrowserWindow | null) {
  assistantWin = win
}

export function registerAssistantHandlers() {
  ipcMain.handle('assistant:hide', () => {
    if (assistantWin && !assistantWin.isDestroyed()) {
      assistantWin.hide()
    }
    return true
  })

  ipcMain.handle('assistant:resize', (_e, width: number, height: number) => {
    if (assistantWin && !assistantWin.isDestroyed()) {
      // Windows 下 resizable:false 会让 setSize 被忽略，临时解锁再恢复
      assistantWin.setResizable(true)
      assistantWin.setSize(width, height)
      assistantWin.setResizable(false)
    }
    return true
  })

  ipcMain.handle(
    'assistant:query',
    async (_e, text: string, action: string): Promise<string> => {
      const apiKey = getApiKey()
      if (!apiKey) return ''
      const prompt = PROMPTS[action]
      if (!prompt) return ''

      try {
        return await callDeepSeek(prompt, text, apiKey)
      } catch (err) {
        console.warn('[Assistant] query 异常:', err)
        return ''
      }
    },
  )
}
