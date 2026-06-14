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
    promptBlock: `你当前处于「ReAct」推理模式。对于需要推理或多步骤完成的任务，请通过「思考 → 行动 → 观察」循环完成：

**核心原则：推理放进思考，正文保持干净**

1. **思考**：在思考过程（reasoning）里分析当前情况、决定下一步行动及理由。不要把 Thought、Observation 等标签词写进正文。
2. **行动**：直接调用工具。如需在正文交代一句过渡（例如"我先搜索一下"），用自然语言写，不要加 **Thought:** 之类前缀。
3. **观察**：工具返回后，在思考里总结结果，决定是否继续循环。如确需在正文说明，用自然语言，不要加 **Observation:** 前缀。

循环直到得出最终答案，然后用自然语言输出完整结论，不要加 **Final Answer:** 之类前缀。

**禁止的格式：**
- ❌ 正文里出现 \`Thought:\`、\`Observation:\`、\`Action:\`、\`Final Answer:\` 等标签词
- ❌ 把推理过程写到正文（应放进思考）

注意：简单闲聊或常识问题不需要走 ReAct 循环，直接回答即可。`,
    capabilities: {
      maxRounds: 100,
      allowedTools: 'all',
      accumulate: true,
    },
  },
]
