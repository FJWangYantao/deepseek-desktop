import type { ToolDefinition, ToolCallRequest, ToolCallResult } from '../../src/types/tools'

// ===== 工具执行器接口 =====

export interface ToolExecutor {
  definition: ToolDefinition
  execute(args: Record<string, unknown>): Promise<string>
}

// ===== 工具注册表 =====

const registry = new Map<string, ToolExecutor>()

export function registerTool(executor: ToolExecutor) {
  registry.set(executor.definition.name, executor)
}

export function getTool(name: string): ToolExecutor | undefined {
  return registry.get(name)
}

export function listTools(): ToolDefinition[] {
  return Array.from(registry.values()).map(e => e.definition)
}

export function hasTool(name: string): boolean {
  return registry.has(name)
}

// 将注册表中的工具转换为 OpenAI function calling 的 tools 参数格式
export function getToolsSchema(): object[] {
  return Array.from(registry.values()).map(e => ({
    type: 'function' as const,
    function: {
      name: e.definition.name,
      description: e.definition.description,
      parameters: e.definition.parameters,
    },
  }))
}
