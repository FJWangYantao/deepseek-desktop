import type { ToolCallRequest, ToolCallResult } from '../../src/types/tools'
import { getTool } from './registry'

const DEFAULT_DISPLAY_LIMIT = 4000
const EXECUTION_TIMEOUT = 30_000 // 30 秒

/**
 * 按工具名区分显示上限（字符数）。
 * - 搜索类（web_search）返回的是结果摘要，单条不长但条目多，给更大预算，
 *   避免 10 条结果轻易被截断，丢失排在后面的相关结果。
 * - 抓取类（web_fetch）已是正文提取后的内容，通常需要全文，给较大预算。
 * - 其他工具（file_read/write 等）保持默认。
 */
const DISPLAY_LIMIT_BY_TOOL: Record<string, number> = {
  web_search: 12000,
  web_fetch: 16000,
}

function displayLimitFor(toolName: string): number {
  return DISPLAY_LIMIT_BY_TOOL[toolName] ?? DEFAULT_DISPLAY_LIMIT
}

export async function executeTool(request: ToolCallRequest): Promise<ToolCallResult> {
  const tool = getTool(request.name)
  if (!tool) {
    return {
      callId: request.callId,
      name: request.name,
      success: false,
      data: `未知工具: ${request.name}`,
      truncated: false,
      totalSize: 0,
      displayedSize: 0,
      offset: 0,
    }
  }

  let args: Record<string, unknown>
  try {
    args = JSON.parse(request.arguments)
  } catch {
    return {
      callId: request.callId,
      name: request.name,
      success: false,
      data: `参数解析失败: ${request.arguments}`,
      truncated: false,
      totalSize: 0,
      displayedSize: 0,
      offset: 0,
    }
  }

  try {
    // 带超时执行
    const result = await Promise.race([
      tool.execute(args),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('执行超时')), EXECUTION_TIMEOUT)
      ),
    ])

    const offset = (args.offset as number) || 0
    // 显式 limit 优先，否则按工具类型取默认值
    const limit = (args.limit as number) || displayLimitFor(request.name)
    const totalSize = result.length

    // 分页截取
    let displayed = result
    let truncated = false
    if (offset > 0 || totalSize > limit) {
      displayed = result.slice(offset, offset + limit)
      truncated = offset + limit < totalSize
    }

    // 摘要头
    let data = displayed
    if (totalSize > limit || offset > 0) {
      const header = `[显示 ${displayed.length}/${totalSize} 字符，偏移量 ${offset}]\n\n`
      data = header + displayed
    }

    return {
      callId: request.callId,
      name: request.name,
      success: true,
      data,
      truncated,
      totalSize,
      displayedSize: displayed.length,
      offset,
    }
  } catch (err) {
    return {
      callId: request.callId,
      name: request.name,
      success: false,
      data: `执行失败: ${err instanceof Error ? err.message : String(err)}`,
      truncated: false,
      totalSize: 0,
      displayedSize: 0,
      offset: 0,
    }
  }
}

// 批量并行执行同一批次内的工具调用
export async function executeBatch(requests: ToolCallRequest[]): Promise<ToolCallResult[]> {
  return Promise.all(requests.map(executeTool))
}
