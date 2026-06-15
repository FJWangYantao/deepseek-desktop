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

/** Plan 模式「规划阶段」system 提示（工具已被代码层禁用，LLM 只能输出计划） */
export const PLAN_PLANNING_PROMPT = `你当前处于「计划与执行」模式的【规划阶段】。

此时你**不能调用任何工具**（系统已禁用）。请只输出计划，不要尝试调用工具：
1. 先用一两句话简要分析用户需求与目标
2. 然后输出分步执行计划，**必须用 \`\`\`plan 代码块包裹的 JSON 数组**，每项含 step（序号，从1开始）、title（步骤目标）、tool（拟用工具名，如 web_search/web_fetch/file_write，可省略）。格式示例：

\`\`\`plan
[
  { "step": 1, "title": "搜索相关资料", "tool": "web_search" },
  { "step": 2, "title": "抓取详情页", "tool": "web_fetch" },
  { "step": 3, "title": "整理并输出结果" }
]
\`\`\`

3. JSON 之后可补一句说明，并提示用户确认执行。

重要：\`\`\`plan 块必须出现在你的回复中，系统依赖它渲染待办列表。如果用户的首次消息不包含明确的任务（如普通闲聊），按普通对话回复，不必输出 plan 块。`

/** Plan 模式「执行阶段」system 提示（工具已放开，按计划逐步执行） */
export const PLAN_EXECUTING_PROMPT = `你当前处于「计划与执行」模式的【执行阶段】。用户已确认执行计划。

按计划逐步执行：
- **每完成一步，在正文开头用「步骤 N/M」标注当前进度**（例如「步骤 2/5」，M 为总步数）。系统据此自动勾选待办。
- 完成所有步骤后，输出执行总结
- 如遇到意外情况，暂停并报告给用户

如果用户提出了新任务（而非确认执行），请先回到规划阶段思路：分析任务并输出新计划（含 \`\`\`plan 块），提示用户确认。`

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
    // promptBlock 留空：Plan 的提示按 planning/executing 阶段动态拼接（见 chat.ts）
    promptBlock: '',
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
