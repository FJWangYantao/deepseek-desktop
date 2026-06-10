import type { ToolDefinition } from '../../../src/types/tools'
import type { ToolExecutor } from '../registry'
import { readdirSync, statSync } from 'fs'
import { join, extname } from 'path'

const definition: ToolDefinition = {
  name: 'list_dir',
  description: '列出指定目录下的文件和文件夹。返回名称、类型、大小等信息。',
  category: 'file',
  permissions: 'whitelist',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '要列出的目录路径',
      },
      recursive: {
        type: 'boolean',
        description: '是否递归列出子目录，默认 false',
      },
      maxDepth: {
        type: 'number',
        description: '递归最大深度，默认 2',
      },
    },
    required: ['path'],
  },
}

interface FileEntry {
  name: string
  type: 'file' | 'directory'
  size: number
  ext: string
  children?: FileEntry[]
}

function listDirectory(dirPath: string, recursive: boolean, maxDepth: number, currentDepth: number): FileEntry[] {
  const entries = readdirSync(dirPath, { withFileTypes: true })
  const result: FileEntry[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue

    const fullPath = join(dirPath, entry.name)
    try {
      const stats = statSync(fullPath)
      const fileEntry: FileEntry = {
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: stats.size,
        ext: entry.isFile() ? extname(entry.name) : '',
      }

      if (entry.isDirectory() && recursive && currentDepth < maxDepth) {
        fileEntry.children = listDirectory(fullPath, recursive, maxDepth, currentDepth + 1)
      }

      result.push(fileEntry)
    } catch {
      // 跳过无权访问的文件
    }
  }

  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return result
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`
}

function formatEntries(entries: FileEntry[], indent = ''): string {
  const lines: string[] = []
  for (const e of entries) {
    if (e.type === 'directory') {
      lines.push(`${indent}📁 ${e.name}/`)
      if (e.children) {
        lines.push(formatEntries(e.children, indent + '  '))
      }
    } else {
      lines.push(`${indent}📄 ${e.name}  (${formatSize(e.size)})`)
    }
  }
  return lines.join('\n')
}

export const listDirTool: ToolExecutor = {
  definition,
  async execute(args) {
    const dirPath = args.path as string
    if (!dirPath) throw new Error('缺少目录路径')

    const recursive = (args.recursive as boolean) ?? false
    const maxDepth = (args.maxDepth as number) ?? 2

    const entries = listDirectory(dirPath, recursive, maxDepth, 0)
    const summary = `目录: ${dirPath}\n共 ${entries.length} 项（${entries.filter(e => e.type === 'directory').length} 个文件夹，${entries.filter(e => e.type === 'file').length} 个文件）\n\n${formatEntries(entries)}`

    return summary
  },
}
