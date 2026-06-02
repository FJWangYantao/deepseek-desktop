import { ipcMain, dialog } from 'electron'
import { readFileSync, statSync } from 'fs'
import { extname } from 'path'

const MAX_SIZE = 5 * 1024 * 1024 // 5MB
const TEXT_EXTS = new Set([
  '.txt', '.md', '.csv', '.json', '.xml', '.html', '.htm',
  '.css', '.js', '.ts', '.jsx', '.tsx', '.vue', '.svelte',
  '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.rs', '.go', '.rb', '.php',
  '.sh', '.bat', '.ps1', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.log', '.sql', '.svg', '.env', '.gitignore',
])

interface FileInfo {
  path: string
  name: string
  size: number
  ext: string
}

interface ParsedFile {
  name: string
  ext: string
  text: string
}

async function parseText(path: string): Promise<string> {
  const buf = readFileSync(path)
  return buf.toString('utf-8')
}

async function parsePDF(path: string): Promise<string> {
  const pdfParse = (await import('pdf-parse')).default
  const buf = readFileSync(path)
  const data = await pdfParse(buf)
  return data.text
}

async function parseDocx(path: string): Promise<string> {
  const mammoth = (await import('mammoth')).default
  const buf = readFileSync(path)
  const result = await mammoth.extractRawText({ buffer: buf })
  return result.value
}

async function parseXlsx(path: string): Promise<string> {
  const XLSX = (await import('xlsx')).default
  const buf = readFileSync(path)
  const workbook = XLSX.read(buf, { type: 'buffer' })
  const parts: string[] = []
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name]
    const csv = XLSX.utils.sheet_to_csv(sheet)
    if (csv.trim()) {
      parts.push(workbook.SheetNames.length > 1 ? `=== ${name} ===\n${csv}` : csv)
    }
  }
  return parts.join('\n\n')
}

async function parsePptx(path: string): Promise<string> {
  const JSZip = (await import('jszip')).default
  const buf = readFileSync(path)
  const zip = await JSZip.loadAsync(buf)
  const slideRE = /^ppt\/slides\/slide\d+\.xml$/
  const slides = Object.keys(zip.files).filter(f => slideRE.test(f)).sort()
  const texts: string[] = []
  for (const name of slides) {
    const xml = await zip.files[name].async('string')
    const parts: string[] = []
    for (const m of xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)) {
      if (m[1]) parts.push(m[1])
    }
    if (parts.length > 0) texts.push(parts.join(''))
  }
  return texts.join('\n\n')
}

function getParser(ext: string): (path: string) => Promise<string> {
  switch (ext) {
    case '.pdf': return parsePDF
    case '.docx': return parseDocx
    case '.xlsx':
    case '.xls': return parseXlsx
    case '.pptx': return parsePptx
    default: return parseText
  }
}

export function registerFileHandlers() {
  ipcMain.handle('file:select', async (): Promise<FileInfo[]> => {
    const result = await dialog.showOpenDialog({
      title: '选择文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '支持的文件',
          extensions: [
            'txt', 'md', 'csv', 'json', 'xml', 'html', 'htm',
            'pdf', 'docx', 'xlsx', 'xls', 'pptx',
            'css', 'js', 'ts', 'jsx', 'tsx', 'vue',
            'py', 'java', 'c', 'cpp', 'h', 'rs', 'go',
            'sh', 'yaml', 'yml', 'toml', 'ini', 'cfg',
            'log', 'sql', 'svg',
          ],
        },
        { name: '所有文件', extensions: ['*'] },
      ],
    })

    if (result.canceled || result.filePaths.length === 0) return []

    return result.filePaths.slice(0, 5).map(p => {
      const stats = statSync(p)
      return {
        path: p,
        name: p.split(/[\\/]/).pop() ?? p,
        size: stats.size,
        ext: extname(p).toLowerCase(),
      }
    })
  })

  ipcMain.handle('file:parse', async (_event, paths: string[]): Promise<ParsedFile[]> => {
    const results: ParsedFile[] = []

    for (const p of paths) {
      try {
        const stats = statSync(p)
        if (stats.size > MAX_SIZE) {
          const name = p.split(/[\\/]/).pop() ?? p
          results.push({ name, ext: extname(p).toLowerCase(), text: `[文件过大 (${(stats.size / 1024 / 1024).toFixed(1)}MB)，超过 5MB 限制]` })
          continue
        }

        const ext = extname(p).toLowerCase()
        const name = p.split(/[\\/]/).pop() ?? p
        const parser = getParser(ext)

        let text = await parser(p)

        // 截断过长的文本
        if (text.length > 8000) {
          text = text.slice(0, 8000) + `\n\n... (内容已截断，原始 ${text.length} 字符)`
        }

        results.push({ name, ext, text })
      } catch (e) {
        const name = p.split(/[\\/]/).pop() ?? p
        results.push({ name, ext: extname(p).toLowerCase(), text: `[解析失败: ${e instanceof Error ? e.message : '未知错误'}]` })
      }
    }

    return results
  })
}
