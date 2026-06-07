import type { ToolDefinition } from '../../../src/types/tools'
import type { ToolExecutor } from '../registry'
import { searchWeb } from '../../search/duckduckgo'

const definition: ToolDefinition = {
  name: 'web_search',
  description: '搜索互联网获取信息。支持中英文搜索，返回相关网页的标题、链接和摘要。',
  category: 'search',
  permissions: 'auto',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词',
      },
    },
    required: ['query'],
  },
}

export const webSearchTool: ToolExecutor = {
  definition,
  async execute(args) {
    const query = args.query as string
    if (!query) throw new Error('缺少搜索关键词')

    const results = await searchWeb(query)
    if (results.length === 0) return '未找到相关结果'

    return results
      .slice(0, 8)
      .map((r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet}`)
      .join('\n\n')
  },
}
