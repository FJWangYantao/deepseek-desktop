import type { ToolDefinition } from '../../../src/types/tools'
import type { ToolExecutor } from '../registry'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'

const definition: ToolDefinition = {
  name: 'file_write',
  description: '写入内容到本地文件。如果文件不存在会创建，如果存在会覆盖。会自动创建所需的目录。',
  category: 'file',
  permissions: 'confirm',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '要写入的文件路径',
      },
      content: {
        type: 'string',
        description: '要写入的内容',
      },
      encoding: {
        type: 'string',
        description: '文件编码，默认 utf-8',
        enum: ['utf-8', 'ascii', 'latin1'],
      },
    },
    required: ['path', 'content'],
  },
}

export const fileWriteTool: ToolExecutor = {
  definition,
  async execute(args) {
    const filePath = args.path as string
    const content = args.content as string
    if (!filePath) throw new Error('缺少文件路径')
    if (content === undefined || content === null) throw new Error('缺少写入内容')

    // 确保目录存在
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const encoding = (args.encoding as BufferEncoding) || 'utf-8'
    writeFileSync(filePath, content, encoding)
    return `成功写入 ${content.length} 字符到 ${filePath}`
  },
}
