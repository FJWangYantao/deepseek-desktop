import type { ToolDefinition } from '../../../src/types/tools'
import type { ToolExecutor } from '../registry'
import { readFileSync, statSync } from 'fs'
import { extname } from 'path'

const MAX_SIZE = 5 * 1024 * 1024

const definition: ToolDefinition = {
  name: 'file_read',
  description: '读取本地文件内容。支持文本文件和代码文件。',
  category: 'file',
  permissions: 'whitelist',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '要读取的文件路径',
      },
      encoding: {
        type: 'string',
        description: '文件编码，默认 utf-8',
        enum: ['utf-8', 'ascii', 'latin1'],
      },
      offset: {
        type: 'number',
        description: '内容偏移量（字符数），用于分页读取大文件',
      },
      limit: {
        type: 'number',
        description: '最大返回字符数，默认 4000',
      },
    },
    required: ['path'],
  },
}

export const fileReadTool: ToolExecutor = {
  definition,
  async execute(args) {
    const filePath = args.path as string
    if (!filePath) throw new Error('缺少文件路径')

    const stats = statSync(filePath)
    if (stats.size > MAX_SIZE) {
      throw new Error(`文件过大 (${(stats.size / 1024 / 1024).toFixed(1)}MB)，超过 5MB 限制`)
    }

    const encoding = (args.encoding as BufferEncoding) || 'utf-8'
    const content = readFileSync(filePath, encoding)
    return content
  },
}
