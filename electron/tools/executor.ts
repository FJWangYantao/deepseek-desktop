import type { ToolCallRequest, ToolCallResult } from '../../src/types/tools'
import { getTool } from './registry'

const DEFAULT_DISPLAY_LIMIT = 4000
const EXECUTION_TIMEOUT = 30_000 // 30 秒

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
    const limit = (args.limit as number) || DEFAULT_DISPLAY_LIMIT
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
