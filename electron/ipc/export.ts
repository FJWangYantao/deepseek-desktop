import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'
import type { ChatSession } from '../../src/types'

function buildMarkdown(session: ChatSession): string {
  const now = new Date()
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const lines: string[] = [
    `# ${session.title}`,
    '',
    `> 导出时间：${dateStr}`,
    `> 模型：${session.model}`,
    `> 消息数：${session.messages.length}`,
    '',
    '---',
    '',
  ]
  for (const msg of session.messages) {
    if (msg.role === 'user') {
      lines.push('## 用户')
      if (msg.attachments?.length) {
        lines.push('')
        for (const a of msg.attachments) {
          const size = a.size < 1024 ? `${a.size}B` : a.size < 1048576 ? `${(a.size / 1024).toFixed(1)}KB` : `${(a.size / 1048576).toFixed(1)}MB`
          lines.push(`> 📎 ${a.name} (${size})`)
        }
        lines.push('')
      }
      lines.push(msg.content)
    } else {
      lines.push('## AI')
      if (msg.thinking) {
        lines.push('')
        lines.push('> 💭 思考过程：')
        lines.push('> ' + msg.thinking.replace(/\n/g, '\n> '))
        lines.push('')
      }
      lines.push(msg.content)
    }
    lines.push('')
    lines.push('---')
    lines.push('')
  }
  return lines.join('\n')
}

function buildHtml(session: ChatSession): string {
  const md = buildMarkdown(session)
  // 动态导入 marked（它已经是项目依赖）
  const { marked } = require('marked')
  const body = marked.parse(md) as string
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${session.title}</title>
<style>
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 860px; margin: 40px auto; padding: 0 20px; line-height: 1.8; color: #333; }
  h1 { border-bottom: 2px solid #e0e0e0; padding-bottom: 8px; }
  h2 { margin-top: 24px; color: #555; }
  blockquote { border-left: 3px solid #ddd; margin: 8px 0; padding: 4px 16px; color: #888; background: #f9f9f9; }
  hr { border: none; border-top: 1px solid #eee; margin: 20px 0; }
  pre { background: #f5f5f5; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 14px; }
  code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f5f5f5; }
</style>
</head>
<body>${body}</body>
</html>`
}

export function registerExportHandlers() {
  ipcMain.handle('export:session', async (_event, session: ChatSession, format: 'md' | 'html') => {
    const ext = format === 'html' ? 'html' : 'md'
    const filters = format === 'html'
      ? [{ name: 'HTML 文件', extensions: ['html'] }]
      : [{ name: 'Markdown 文件', extensions: ['md'] }]

    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showSaveDialog(win!, {
      title: '导出对话',
      defaultPath: `${session.title.replace(/[\\/:*?"<>|]/g, '_')}.${ext}`,
      filters,
    })

    if (result.canceled || !result.filePath) return false

    const content = format === 'html' ? buildHtml(session) : buildMarkdown(session)
    writeFileSync(result.filePath, content, 'utf-8')
    return true
  })
}
