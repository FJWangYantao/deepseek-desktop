import type { WorkMode } from '@/types'

/** 工具 schema 项的形状（与 useToolLoop 内构造一致） */
export interface ToolSchemaItem {
  type: 'function'
  function: { name: string; description: string; parameters: object }
}

/** 工作模式的能力策略 */
export interface ModeCapabilities {
  /** 工具调用轮次上限 */
  maxRounds: number
  /** 允许的工具：'all' 或工具名白名单 */
  allowedTools: string[] | 'all'
  /** 工具调用行是否多轮累积（ReAct/Plan=true）；false=每轮覆盖（Chat 现状） */
  accumulate: boolean
}

export interface WorkModeDefinition {
  value: WorkMode
  label: string
  desc: string
  promptBlock: string
  capabilities: ModeCapabilities
}

/** 按 allowedTools 过滤工具 schema。'all' 返回全部。 */
export function filterToolSchema(
  all: ToolSchemaItem[],
  allowedTools: string[] | 'all',
): ToolSchemaItem[] {
  if (allowedTools === 'all') return all
  return all.filter(t => allowedTools.includes(t.function.name))
}

export const workModes: WorkModeDefinition[] = [
  {
    value: 'chat',
    label: 'Chat',
    desc: '直接对话与工具调用',
    promptBlock: '',
    capabilities: {
      maxRounds: 3,
      allowedTools: ['web_search', 'web_fetch', 'skill_load', 'skill_read_resource', 'skill_check_deps'],
      accumulate: false,
    },
  },
  {
    value: 'plan',
    label: 'Plan',
    desc: '先制定计划，确认后逐步执行',
    promptBlock: `你当前处于「计划与执行」模式。请严格遵循以下流程：

## 阶段一：制定计划
收到用户任务后，不要立即调用任何工具。先完成以下步骤：
1. 分析用户需求，明确目标
2. 制定一个清晰的分步执行计划
3. 用有序列表输出计划，每步包含：目标、拟使用的工具、预期结果
4. 以明确的提示结尾，例如："以上就是执行计划。请回复「执行」开始执行，或提出修改意见。"

## 阶段二：执行计划
当用户确认执行后（用户消息包含「执行」「确认」「开始」等语义），按计划逐步执行：
- 每执行一步，标注当前进度（例如 "步骤 2/5"）
- 如遇到意外情况，暂停并报告给用户
- 全部完成后输出执行总结

重要：如果用户的首次消息不包含明确的任务（如普通闲聊），按普通对话模式回复，不必强制制定计划。`,
    capabilities: {
      maxRounds: 100,
      allowedTools: 'all',
      accumulate: true,
    },
  },
  {
    value: 'react',
    label: 'ReAct',
    desc: '思考→行动→观察循环推理',
    promptBlock: `你当前处于「ReAct」推理模式。对于需要推理或多步骤完成的任务，请严格遵循 Thought → Action → Observation 循环：

**格式要求：**
每次工具调用前，必须先输出 **Thought** 块说明你的推理过程。

1. **Thought:** 分析当前情况，决定下一步行动及理由
2. **Action:** 调用工具（或直接给出回答）
3. **Observation:** 简要总结工具返回的结果

重复以上循环直到得出最终答案，然后输出 **Final Answer:** 给出完整结论。

示例格式：
> **Thought:** 用户询问北京今天天气，我需要先搜索最新天气信息。
> **Action:** 调用 web_search 搜索"北京今天天气"
> **Observation:** 搜索结果显示北京今日晴，最高温度 32°C。
> **Final Answer:** 北京今天天气晴朗，最高温度 32°C。

注意：简单闲聊或常识问题不需要走 ReAct 循环，直接回答即可。`,
    capabilities: {
      maxRounds: 100,
      allowedTools: 'all',
      accumulate: true,
    },
  },
]
