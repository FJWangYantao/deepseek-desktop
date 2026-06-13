# 工作模式能力分层 + ReAct 多轮轨迹 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 chat/react/plan 三种工作模式真正改变能力(工具集 + 轮次上限)和展示(ReAct/Plan 工具调用行多轮累积,Chat 维持每轮覆盖),而非仅 prompt 措辞不同。

**Architecture:** 在 `workModes.ts` 集中声明每个模式的 `capabilities`(`maxRounds` / `allowedTools` / `accumulate`),作为单一策略源。`useToolLoop.run()` 接收一个 `modePolicy` 参数,据此:① 过滤工具 schema、② 参数化轮次上限、③ 控制工具调用行是否累积、④ 工具预算用尽时注入 system 提示优雅收尾。`chat.ts` 按 `settings.workMode` 取策略传入。展示层零改动 —— 累积的 `activeToolCalls` 自然让现有 `v-for` 多行堆叠。

**Tech Stack:** Vue 3 + Pinia + TypeScript(`vue-tsc` 类型门禁)、自研 `check()` 断言 + `tsx` 的纯 Node 测试(`npm test` → `tests/run-all.ts`)、DeepSeek function calling。

**约定:** 所有 commit message 以 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` 结尾(下方 commit step 为简洁省略,执行时补上)。`modePolicy` 在 `useToolLoop` 中设计为**可选参数 + 兜底默认值**,使 Task 2-4 之间每个中间提交都类型安全、行为不回归(兜底 = 现状:全工具 + 100 轮 + 不累积),直到 Task 5 `chat.ts` 传入真实策略才按模式分流。

---

## File Structure

| 文件 | 责任 | 改动 |
|---|---|---|
| `src/data/workModes.ts` | 工作模式定义中心。新增 `ModeCapabilities` 类型、`filterToolSchema` 纯函数、三模式 `capabilities` 字段 | 修改 |
| `tests/mode-policy.test.ts` | 纯函数测试:`filterToolSchema` + 三模式 capabilities 断言 | 新建 |
| `tests/run-all.ts` | 测试总入口,suites 数组注册新套件 | 修改 |
| `src/composables/useToolLoop.ts` | 工具循环核心。接入 `modePolicy`:schema 过滤、轮次参数化、累积开关、收尾注入 | 修改 |
| `src/stores/chat.ts` | 按 `workMode` 取 capabilities 传入 `run()`(约 3 行) | 修改 |
| 展示层(`MessageList.vue` 等) | 无改动 | — |

---

## Task 1: 能力策略类型 + `filterToolSchema` 纯函数(TDD)

**Files:**
- Modify: `src/data/workModes.ts`
- Create: `tests/mode-policy.test.ts`
- Modify: `tests/run-all.ts:11-16`

- [ ] **Step 1: 写失败测试**

Create `tests/mode-policy.test.ts`:

```ts
/**
 * 工作模式能力策略测试 — filterToolSchema 纯函数 + 三模式 capabilities 断言。
 * 用法：npx tsx tests/mode-policy.test.ts
 */
import {
  workModes,
  filterToolSchema,
  type ToolSchemaItem,
} from '../src/data/workModes'

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, cond: unknown, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// 9 个内置工具的 mock schema
const ALL_TOOLS: ToolSchemaItem[] = [
  'web_search', 'web_fetch', 'file_read', 'file_write', 'list_dir',
  'skill_load', 'skill_read_resource', 'skill_check_deps', 'skill_script_run',
].map(name => ({ type: 'function' as const, function: { name, description: '', parameters: {} } }))

console.log('\n[1] filterToolSchema — all')
{
  check('all 返回全部 9 个', filterToolSchema(ALL_TOOLS, 'all').length === 9)
  check('all 不改变元素', filterToolSchema(ALL_TOOLS, 'all')[0].function.name === 'web_search')
}

console.log('\n[2] filterToolSchema — 白名单')
{
  const filtered = filterToolSchema(ALL_TOOLS, ['web_search', 'web_fetch'])
  check('白名单返回 2 个', filtered.length === 2)
  check('含 web_search', filtered.some(t => t.function.name === 'web_search'))
  check('含 web_fetch', filtered.some(t => t.function.name === 'web_fetch'))
  check('不含 file_write', !filtered.some(t => t.function.name === 'file_write'))
}

console.log('\n[3] filterToolSchema — 边界')
{
  check('空白名单返回 0', filterToolSchema(ALL_TOOLS, []).length === 0)
  check('空输入 + all 返回 0', filterToolSchema([], 'all').length === 0)
  check('白名单含不存在的工具名不报错', filterToolSchema(ALL_TOOLS, ['nope']).length === 0)
}

console.log('\n[4] capabilities — chat')
{
  const chat = workModes.find(m => m.value === 'chat')!.capabilities
  check('chat maxRounds = 3', chat.maxRounds === 3)
  check('chat accumulate = false', chat.accumulate === false)
  check('chat allowedTools 是数组', Array.isArray(chat.allowedTools))
  check('chat 白名单 5 个', Array.isArray(chat.allowedTools) && chat.allowedTools.length === 5)
  check('chat 含 web_search', Array.isArray(chat.allowedTools) && chat.allowedTools.includes('web_search'))
  check('chat 含 skill_load', Array.isArray(chat.allowedTools) && chat.allowedTools.includes('skill_load'))
  check('chat 含 skill_read_resource', Array.isArray(chat.allowedTools) && chat.allowedTools.includes('skill_read_resource'))
  check('chat 含 skill_check_deps', Array.isArray(chat.allowedTools) && chat.allowedTools.includes('skill_check_deps'))
  check('chat 不含 file_write', !(Array.isArray(chat.allowedTools) && chat.allowedTools.includes('file_write')))
  check('chat 不含 skill_script_run', !(Array.isArray(chat.allowedTools) && chat.allowedTools.includes('skill_script_run')))
}

console.log('\n[5] capabilities — react / plan')
{
  const react = workModes.find(m => m.value === 'react')!.capabilities
  const plan = workModes.find(m => m.value === 'plan')!.capabilities
  check('react allowedTools = all', react.allowedTools === 'all')
  check('react maxRounds = 100', react.maxRounds === 100)
  check('react accumulate = true', react.accumulate === true)
  check('plan allowedTools = all', plan.allowedTools === 'all')
  check('plan maxRounds = 100', plan.maxRounds === 100)
  check('plan accumulate = true', plan.accumulate === true)
}

console.log('\n')
console.log(`Passed: ${passed}`)
console.log(`Failed: ${failed}`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
}
```

- [ ] **Step 2: 跑测试验证它失败**

Run: `npx tsx tests/mode-policy.test.ts`
Expected: FAIL — `filterToolSchema` 未导出 / `capabilities` 不存在(运行时 `undefined.capabilities` 抛错或导入失败)。

- [ ] **Step 3: 实现 `workModes.ts`**

Replace the entire content of `src/data/workModes.ts` with:

```ts
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
```

- [ ] **Step 4: 跑测试验证通过**

Run: `npx tsx tests/mode-policy.test.ts`
Expected: PASS — `Passed: 22`(或对应总数),`Failed: 0`。

- [ ] **Step 5: 注册到 run-all**

Modify `tests/run-all.ts:11-16`,在 `suites` 数组末尾追加 `'mode-policy.test.ts'`:

```ts
const suites = [
  'skills-frontmatter.test.ts',
  'path-safety.test.ts',
  'clawhub-installer.test.ts',
  'skill-runtime.test.ts',
  'mode-policy.test.ts',
]
```

- [ ] **Step 6: 跑全套测试**

Run: `npm test`
Expected: `✓ 全部 5 个套件通过`。

- [ ] **Step 7: 类型检查**

Run: `npx vue-tsc --noEmit`
Expected: 零错误(纯数据层改动,不碰 useToolLoop)。

- [ ] **Step 8: Commit**

```bash
git add src/data/workModes.ts tests/mode-policy.test.ts tests/run-all.ts
git commit -m "feat(workModes): 新增 ModeCapabilities 策略 + filterToolSchema 纯函数

- 三模式声明 capabilities：Chat 5 只读工具/3 轮/不累积，ReAct/Plan 全工具/100 轮/累积
- filterToolSchema 按 allowedTools 过滤工具 schema
- 配套纯函数测试（TDD）"
```

---

## Task 2: `useToolLoop` 接入 `modePolicy`(可选 + 兜底)+ 工具过滤

**Files:**
- Modify: `src/composables/useToolLoop.ts`

- [ ] **Step 1: 在 import 中加入 `ModeCapabilities` 与 `filterToolSchema`**

Modify `src/composables/useToolLoop.ts:1-4`. 当前:

```ts
import { ref, reactive } from 'vue'
import type { ToolCallUIState, ToolCallResult, UsageData } from '@/types'
import { deepSeekChat } from './useDeepSeek'
import { recordObservation } from './useObservationMemory'
```

改为:

```ts
import { ref, reactive } from 'vue'
import type { ToolCallUIState, ToolCallResult, UsageData } from '@/types'
import { deepSeekChat } from './useDeepSeek'
import { recordObservation } from './useObservationMemory'
import { filterToolSchema, type ModeCapabilities } from '@/data/workModes'
```

- [ ] **Step 2: 删除 `MAX_TOOL_ROUNDS` 常量,`ToolLoopOptions` 增加可选 `modePolicy`**

Modify `src/composables/useToolLoop.ts:6-23`. 当前:

```ts
const MAX_TOOL_ROUNDS = 100

interface ToolLoopOptions {
  messages: { role: 'user' | 'assistant' | 'system' | 'tool'; content: string; tool_call_id?: string; tool_calls?: any[] }[]
  model: string
  thinking: 'enabled' | 'disabled'
  apiKey: string
  signal?: AbortSignal
  sessionId?: string
  conversationTurnId?: string
  onToken: (token: string) => void
  onThinking: (token: string) => void
  onUsage?: (usage: UsageData) => void
  onToolCallUpdate?: (calls: ToolCallUIState[]) => void
  onNeedsApproval?: (info: { callId: string; name: string; arguments: Record<string, unknown>; reason: string }) => Promise<boolean>
  loadedSkillId?: string | null
  onSkillLoaded?: (skillId: string) => void
}
```

改为(删掉 `MAX_TOOL_ROUNDS`,接口末尾加 `modePolicy?`):

```ts
/** 兜底策略：与改造前行为一致（全工具 + 100 轮 + 不累积），保证未传 modePolicy 时不回归 */
const DEFAULT_MODE_POLICY: ModeCapabilities = {
  maxRounds: 100,
  allowedTools: 'all',
  accumulate: false,
}

interface ToolLoopOptions {
  messages: { role: 'user' | 'assistant' | 'system' | 'tool'; content: string; tool_call_id?: string; tool_calls?: any[] }[]
  model: string
  thinking: 'enabled' | 'disabled'
  apiKey: string
  signal?: AbortSignal
  sessionId?: string
  conversationTurnId?: string
  onToken: (token: string) => void
  onThinking: (token: string) => void
  onUsage?: (usage: UsageData) => void
  onToolCallUpdate?: (calls: ToolCallUIState[]) => void
  onNeedsApproval?: (info: { callId: string; name: string; arguments: Record<string, unknown>; reason: string }) => Promise<boolean>
  loadedSkillId?: string | null
  onSkillLoaded?: (skillId: string) => void
  /** 工作模式能力策略。未传时使用 DEFAULT_MODE_POLICY（等同改造前行为） */
  modePolicy?: ModeCapabilities
}
```

- [ ] **Step 3: `loadToolsSchema` 接受 `allowedTools` 参数并过滤**

Modify `src/composables/useToolLoop.ts:50-65`. 当前:

```ts
  async function loadToolsSchema() {
    if (!window.electronAPI?.toolsList) return
    try {
      const resp = await window.electronAPI.toolsList()
      toolsSchema.value = resp.tools.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }))
    } catch (e) {
      console.warn('[ToolLoop] 获取工具列表失败:', e)
    }
  }
```

改为:

```ts
  async function loadToolsSchema(allowedTools: string[] | 'all') {
    if (!window.electronAPI?.toolsList) return
    try {
      const resp = await window.electronAPI.toolsList()
      const all = resp.tools.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }))
      toolsSchema.value = filterToolSchema(all, allowedTools)
    } catch (e) {
      console.warn('[ToolLoop] 获取工具列表失败:', e)
    }
  }
```

- [ ] **Step 4: `run()` 开头解析 policy 并传入 `loadToolsSchema`**

Modify `src/composables/useToolLoop.ts:102-103`. 当前:

```ts
  async function run(options: ToolLoopOptions): Promise<ToolLoopResult> {
    await loadToolsSchema()
```

改为:

```ts
  async function run(options: ToolLoopOptions): Promise<ToolLoopResult> {
    const policy = options.modePolicy ?? DEFAULT_MODE_POLICY
    await loadToolsSchema(policy.allowedTools)
```

- [ ] **Step 5: 类型检查**

Run: `npx vue-tsc --noEmit`
Expected: 零错误。`modePolicy` 可选、未传者(chat.ts 暂未传)走兜底,行为不回归。

- [ ] **Step 6: Commit**

```bash
git add src/composables/useToolLoop.ts
git commit -m "feat(useToolLoop): 接入 modePolicy 可选参数 + 工具 schema 过滤

- modePolicy 可选，未传时用 DEFAULT_MODE_POLICY（= 改造前行为）
- loadToolsSchema 按 allowedTools 白名单过滤工具
- 此提交行为零回归，chat.ts 尚未传入真实策略"
```

---

## Task 3: 轮次上限参数化 + 累积开关

**Files:**
- Modify: `src/composables/useToolLoop.ts`

- [ ] **Step 1: 循环上限用 `policy.maxRounds`**

Modify `src/composables/useToolLoop.ts:116`. 当前:

```ts
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
```

改为:

```ts
    for (let round = 0; round < policy.maxRounds; round++) {
```

- [ ] **Step 2: 循环开头按 `policy.accumulate` 决定是否清空**

Modify `src/composables/useToolLoop.ts:117`. 当前:

```ts
      activeToolCalls.splice(0, activeToolCalls.length)
```

改为:

```ts
      // accumulate=true（ReAct/Plan）：不清空，本轮工具调用行追加到已有轨迹上
      // accumulate=false（Chat）：每轮覆盖，只显示当前轮
      if (!policy.accumulate) {
        activeToolCalls.splice(0, activeToolCalls.length)
      }
```

- [ ] **Step 3: 类型检查**

Run: `npx vue-tsc --noEmit`
Expected: 零错误(`MAX_TOOL_ROUNDS` 已在 Task 2 删除,此处不再引用;`policy` 在 `run` 作用域内可见)。

- [ ] **Step 4: Commit**

```bash
git add src/composables/useToolLoop.ts
git commit -m "feat(useToolLoop): 轮次上限参数化 + 工具行累积开关

- 循环上限用 policy.maxRounds
- accumulate=true 时不再每轮 splice 清空，工具调用行多轮累积（ReAct/Plan）
- 兜底 accumulate=false 仍为每轮覆盖，Chat 行为不回归"
```

---

## Task 4: 工具预算用尽时注入 system 提示优雅收尾

**Files:**
- Modify: `src/composables/useToolLoop.ts`

- [ ] **Step 1: 循环退出后插入收尾逻辑**

Modify `src/composables/useToolLoop.ts` 的循环尾部(约 371-376 行)。当前:

```ts
      fullContent = ''
      fullThinking = ''
    }

    return { content: fullContent || '(工具调用轮次已达上限)', thinking: fullThinking, usageList, totalUsage }
  }
```

改为:

```ts
      fullContent = ''
      fullThinking = ''
    }

    // 工具预算用尽收尾：循环跑满 maxRounds 仍想调工具时，
    // 注入提示让模型基于已有信息直接作答（不再带 tools，强制文字收尾）。
    messages.push({
      role: 'system',
      content: '工具预算已用尽，请基于已有信息直接作答，不要再调用工具。',
    })
    await deepSeekChat({
      messages: messages as any,
      model: options.model,
      thinking: options.thinking,
      apiKey: options.apiKey,
      signal: options.signal,
      onToken(token) {
        fullContent += token
        options.onToken(token)
      },
      onThinking(token) {
        fullThinking += token
        options.onThinking(token)
      },
      onUsage(usage) {
        usageList.push(usage)
        totalUsage = totalUsage ? addUsage(totalUsage, usage) : { ...usage }
        options.onUsage?.(usage)
      },
    })

    return { content: fullContent, thinking: fullThinking, usageList, totalUsage }
  }
```

说明:此处不传 `tools`,故 `deepSeekChat` 内 `if (tools && tools.length > 0)` 分支不触发,模型只能文字作答。该收尾对所有模式生效 —— Chat 在第 3 轮触发,ReAct/Plan 在第 100 轮触发,均优雅收尾而非硬截断。

- [ ] **Step 2: 类型检查**

Run: `npx vue-tsc --noEmit`
Expected: 零错误。`deepSeekChat` 的 options 形状与现有 `run()` 内调用一致(`messages`/`model`/`thinking`/`apiKey`/`signal`/`onToken`/`onThinking`/`onUsage` 均为 `ChatOptions` 合法字段;`tools` 省略即 undefined)。

- [ ] **Step 3: Commit**

```bash
git add src/composables/useToolLoop.ts
git commit -m "feat(useToolLoop): 工具预算用尽注入 system 提示优雅收尾

- 循环跑满 maxRounds 仍想调工具时，注入提示并再发一轮（不带 tools）强制作答
- Chat 第 3 轮 / ReAct 第 100 轮均优雅收尾，不再硬截断成半截话"
```

---

## Task 5: `chat.ts` 按工作模式传入真实策略

**Files:**
- Modify: `src/stores/chat.ts:406-453`

- [ ] **Step 1: 在 `run()` 调用前取出策略**

Modify `src/stores/chat.ts:404-406`. 当前:

```ts
    const toolLoop = useToolLoop()
    const conversationTurnId = generateId()
    const loopResult = await toolLoop.run({
```

改为:

```ts
    const toolLoop = useToolLoop()
    const conversationTurnId = generateId()
    // 按当前工作模式取能力策略（工具白名单 / 轮次上限 / 是否累积）
    const modePolicy = workModes.find(m => m.value === settingsStore.workMode)?.capabilities
      ?? workModes[0].capabilities
    const loopResult = await toolLoop.run({
```

- [ ] **Step 2: 把 `modePolicy` 塞进 run options**

Modify `src/stores/chat.ts` 的 `run({...})` options 对象,在末尾(`onNeedsApproval` 之后、闭合 `})` 之前)追加一行。当前对象末尾:

```ts
        onNeedsApproval(info) {
          return new Promise<boolean>((resolve) => {
            approvalResolver = resolve
            pendingApproval.value = info
          })
        },
      })
```

改为:

```ts
        onNeedsApproval(info) {
          return new Promise<boolean>((resolve) => {
            approvalResolver = resolve
            pendingApproval.value = info
          })
        },
        modePolicy,
      })
```

- [ ] **Step 3: 类型检查 + 全套测试**

Run: `npx vue-tsc --noEmit && npm test`
Expected: 零类型错误;`✓ 全部 5 个套件通过`。`workModes` 已在 `chat.ts:11` 导入,`settingsStore.workMode` 已在 `chat.ts:338` 使用,无需新增 import。

- [ ] **Step 4: Commit**

```bash
git add src/stores/chat.ts
git commit -m "feat(chat): 按工作模式传入 modePolicy，激活能力分层

- Chat 模式：5 个只读工具 / 3 轮 / 不累积
- ReAct/Plan 模式：全部工具 / 100 轮 / 工具调用行多轮累积
- 至此模式真正改变能力与展示，不再仅 prompt 措辞不同"
```

---

## Task 6: 手动验证

**Files:** 无代码改动,纯验证。

- [ ] **Step 1: 构建**

Run: `npm run build`
Expected: `vue-tsc --noEmit` 零错误 + vite build 成功。

- [ ] **Step 2: 启动应用**

Run: `npm run dev`(或项目既有的启动方式)
Expected: 应用正常启动,主窗口加载。

- [ ] **Step 3: 验证 Chat 模式工具受限**

切换到 **Chat** 模式(WorkModeSelector 显示 "Chat"),发送一个需要读本地文件的问题(例如"读取桌面上的某个文件内容")。
Expected: 模型**不会**调用 `file_read`/`list_dir`(这些工具未暴露给它),只能用文字说明或在 ReAct 下完成。若问题只需搜索(如"今天北京天气"),模型用 `web_search`,工具调用行显示当前轮。

- [ ] **Step 4: 验证 Chat 3 轮收尾**

Chat 模式下提一个会诱导连续搜索的问题(如"对比 A、B、C 三个话题的最新信息")。
Expected: 工具调用最多 3 轮,第 3 轮后模型基于已有结果给出完整作答(不再调工具),用户拿到的是完整答案而非半截话。

- [ ] **Step 5: 验证 ReAct 多轮累积**

切换到 **ReAct** 模式,提一个需要多轮搜索的问题(如"查 X、Y、Z 三件事并总结")。
Expected: 工具调用行**多轮累积堆叠**(每一轮的搜索行都保留,而非被下一轮覆盖),形成可见的推理轨迹;完成后这些工具行也全部保留在正文上方。

- [ ] **Step 6: 验证 ReAct 全工具**

ReAct 模式下提一个需要读文件的问题。
Expected: 模型可调用 `file_read`/`list_dir`(ReAct 暴露全部工具),正常完成。

- [ ] **Step 7: 回归 — Chat 单轮行为**

Chat 模式下做一次普通单轮工具调用(如单次搜索)。
Expected: 行为与改造前一致 —— 工具调用行显示当前轮,完成后归档到正文上方。

- [ ] **Step 8: 最终提交(若有验证中发现的微调)**

若验证中发现需微调(如收尾提示措辞),修正后:
```bash
git add -A
git commit -m "fix: 手动验证后的微调"
```
若无需改动,跳过本步。

---

## Self-Review

**Spec coverage:**
- ✅ 能力策略中心(workModes.ts capabilities)→ Task 1
- ✅ 工具 schema 过滤 → Task 1(filterToolSchema)+ Task 2(loadToolsSchema 接入)
- ✅ 轮次参数化 → Task 3
- ✅ 累积开关 → Task 3
- ✅ 3 轮收尾注入 → Task 4
- ✅ chat.ts 传 policy → Task 5
- ✅ 展示层零改动 → 已在 File Structure 与设计说明
- ✅ 工具分组(Chat 5 只读 / ReAct 全 9)→ Task 1 测试 [4][5] 断言
- ✅ 测试要点(过滤/累积/收尾/回归)→ Task 1 TDD + Task 6 手动验证

**Placeholder scan:** 无 TBD/TODO/"add error handling" 等。每个代码 step 含完整代码。

**Type consistency:**
- `ModeCapabilities` 在 Task 1 定义,Task 2 import 复用,字段名 `maxRounds`/`allowedTools`/`accumulate` 全程一致。
- `filterToolSchema(all, allowedTools)` 签名:Task 1 定义、Task 2 调用一致。
- `policy` 变量在 `run()` 作用域(Task 2 Step 4 定义),Task 3/4 引用一致。
- `modePolicy` 在 Task 5 chat.ts 赋值并传入,与 `ToolLoopOptions.modePolicy` 字段名一致。
- `deepSeekChat` options(Task 4)与 `useDeepSeek.ts:3-13` 的 `ChatOptions` 字段一致。

无遗漏。
