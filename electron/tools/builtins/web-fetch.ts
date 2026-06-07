import type { ToolDefinition } from '../../../src/types/tools'
import type { ToolExecutor } from '../registry'
import { fetchUrl } from '../../search/duckduckgo'

const definition: ToolDefinition = {
  name: 'web_fetch',
  description: '抓取指定 URL 的网页内容，提取纯文本。',
  category: 'network',
  permissions: 'auto',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '要抓取的网页 URL',
      },
      offset: {
        type: 'number',
        description: '内容偏移量（字符数），用于分页读取大页面',
      },
      limit: {
        type: 'number',
        description: '最大返回字符数，默认 4000',
      },
    },
    required: ['url'],
  },
}

export const webFetchTool: ToolExecutor = {
  definition,
  async execute(args) {
    const url = args.url as string
    if (!url) throw new Error('缺少 URL')

    const content = await fetchUrl(url)
    if (!content) return '无法获取页面内容'
    return content
  },
}
