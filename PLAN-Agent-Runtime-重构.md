# DeepSeek Desktop — Agent Runtime 重构计划

## 1. 重构目标

本次重构的目标不是新增功能，而是把当前隐式存在的 Agent Runtime 正式独立出来。

最终希望形成：

```text
Renderer / UI
      │
      ▼
Runtime Client
      │
      ▼
Agent Runtime
 ├─ Run Lifecycle
 ├─ Context Builder
 ├─ Agent Loop
 ├─ LLM Provider
 ├─ Tool Runtime
 ├─ Event Bus
 └─ Hooks
```

Runtime 应做到：

1. 不依赖 Vue 页面生命周期；
2. 不依赖 Pinia 作为核心执行状态；
3. 能独立运行一轮 Agent 任务；
4. 能被 Chat、划词助手、后台任务、未来移动端共同调用；
5. 能完整记录一次 Run 的模型、工具、权限和结果轨迹；
6. 为后续 Hook、Review Model、Sub-Agent、Checkpoint 提供稳定扩展点。

---

## 2. 当前架构判断

当前主链：

```text
ChatView
   ↓
chatStore.sendMessage()
   ↓
Context 构建
   ↓
useToolLoop.run()
   ↓
deepSeekChat()
   ↓
tool_calls
   ↓
IPC
   ↓
Electron Tool Runtime
```

其中：

### `chat.ts`

目前同时负责：

- Session
- 附件
- 图片描述
- Quote
- Plan 状态机
- System Prompt
- Skill Context
- Memory Context
- Instinct Context
- Agent 启动
- Streaming
- 后台会话
- Plan Todo
- Observation
- Memory Extraction
- Stats
- 归档

这是当前最大的职责集中点。

### `useToolLoop.ts`

负责：

- Agent Round
- LLM 请求
- Tool Call
- Tool Result
- Permission Approval
- Round Budget
- 停止条件
- ContentBlock
- Observation

它实际上已经是 Agent Runtime Core 的雏形。

### Electron Tool Runtime

现有：

```text
Tool Registry
Permission
Executor
IPC Boundary
```

这一层原则上保持不动。

---

## 3. 重构原则

### 原则 A：不重写 Tool 系统

现有：

```text
electron/tools/
electron/ipc/tools.ts
```

继续保留。

Agent Runtime 只负责：

- 什么时候调用 Tool
- 调用哪个 Tool
- 结果如何回填模型

Tool Runtime 继续负责：

- 能不能执行
- 是否需要批准
- 怎么执行
- 超时
- 结果截断

### 原则 B：先抽边界，再搬实现

不要先把代码复制到 `electron/runtime/` 然后一次改完。

正确顺序：

```text
定义 Runtime Interface
        ↓
让现有 useToolLoop 实现 Interface
        ↓
ChatStore 改为调用 Interface
        ↓
再迁移 Runtime 实现
```

这样每一步都可以测试。

### 原则 C：UI 不拥有 Agent 状态

最终 Vue Store 不应该拥有：

- 当前 round
- 当前 runtime message
- tool result 回填
- Agent 是否继续运行
- round budget

这些应该属于 Runtime。

UI 只拥有：

- 当前显示什么
- 哪个 Session 被选中
- Streaming 如何展示
- 是否弹审批框

---

## 4. 建议最终目录

```text
src/
├─ runtime-client/
│  ├─ runtimeClient.ts
│  ├─ runtimeEvents.ts
│  └─ runtimeTypes.ts

electron/
├─ runtime/
│  ├─ AgentRuntime.ts
│  │
│  ├─ run/
│  │  ├─ AgentRun.ts
│  │  ├─ AgentRound.ts
│  │  └─ RunManager.ts
│  │
│  ├─ context/
│  │  ├─ ContextBuilder.ts
│  │  ├─ MemoryContextProvider.ts
│  │  ├─ SkillContextProvider.ts
│  │  ├─ InstinctContextProvider.ts
│  │  └─ WorkModeContextProvider.ts
│  │
│  ├─ loop/
│  │  └─ AgentLoop.ts
│  │
│  ├─ llm/
│  │  ├─ LLMProvider.ts
│  │  └─ DeepSeekProvider.ts
│  │
│  ├─ events/
│  │  ├─ RuntimeEventBus.ts
│  │  └─ RuntimeEvents.ts
│  │
│  ├─ hooks/
│  │  ├─ RuntimeHook.ts
│  │  └─ HookManager.ts
│  │
│  └─ policies/
│     ├─ RoundPolicy.ts
│     └─ WorkModePolicy.ts
│
├─ tools/
├─ skills/
├─ observations/
└─ ipc/
   └─ runtime.ts
```

第一阶段不要求马上全部迁到 Electron，可以先在 `src/runtime/` 完成抽象，再迁主进程。

---

## 5. Phase 0 — 建立重构基线

### 目标

在正式搬代码前，确保当前行为可以被验证。

### 工作

增加 Agent Runtime 回归测试，至少覆盖：

#### 普通 Chat

```text
User
→ LLM
→ Final Answer
```

#### 单 Tool

```text
User
→ LLM
→ file_read
→ Tool Result
→ LLM
→ Final
```

#### 多轮 Tool

```text
LLM
→ web_search
→ LLM
→ web_fetch
→ LLM
→ Final
```

#### Permission

```text
Tool
→ needsApproval
→ approve
→ execute
```

以及：

```text
Tool
→ needsApproval
→ deny
```

#### Plan

```text
planning
→ plan JSON
→ confirm
→ executing
→ todo completed
→ idle
```

#### Abort

```text
Run
→ cancel
→ partial result
```

### 验收

重构前所有测试通过。

---

## 6. Phase 1 — 建立 Runtime Domain Model

这是第一步真正的架构改造。

新增：

```text
AgentRun
AgentRound
RuntimeMessage
RuntimeToolCall
RuntimeToolResult
```

建议：

```ts
interface AgentRun {
  id: string
  sessionId: string
  conversationTurnId: string

  status:
    | 'created'
    | 'running'
    | 'waiting_approval'
    | 'completed'
    | 'failed'
    | 'cancelled'

  mode: string
  rounds: AgentRound[]
  startedAt: number
  finishedAt?: number
}
```

### AgentRound

```ts
interface AgentRound {
  index: number
  inputMessages: RuntimeMessage[]

  output?: {
    content: string
    thinking?: string
    toolCalls?: RuntimeToolCall[]
  }

  tools: RuntimeToolExecution[]
  usage?: UsageData
}
```

### 目的

现在这些信息实际上散落在：

```text
conversationTurnId
round
activeToolCalls
messages
observations
```

重构后 `Run` 成为 Agent Runtime 的第一等实体。

### 验收标准

能够：

```ts
const run = createAgentRun(...)
```

并且：

```text
一次 sendMessage
=
一个 AgentRun
```

---

## 7. Phase 2 — 把 `useToolLoop` 改造成纯 AgentLoop

当前 `useToolLoop()` 带有明显 Vue 特征：

```ts
ref()
reactive()
window.electronAPI
```

这些都不应该属于 Runtime Core。

目标变成：

```ts
class AgentLoop {
  async run(context: RunContext): Promise<RunResult>
}
```

### 从 `useToolLoop` 移除

#### Vue reactive 状态

例如：

```ts
const activeToolCalls = reactive(...)
const toolsSchema = ref(...)
```

改成普通 TypeScript 对象。

#### UI Callback

目前：

```text
onToken
onThinking
onToolCallUpdate
onBlock
onNeedsApproval
```

逐渐替换成 Runtime Events，例如：

```ts
runtime.emit({
  type: 'llm.token',
  runId,
  token
})
```

### 保留逻辑

现有有价值的逻辑继续保留：

- Round Budget
- absoluteLimit
- empty answer fallback
- tool trajectory
- skill_load 单 Skill 限制
- 连续搜索提醒
- Tool Result 回填

不需要重写算法。

---

## 8. Phase 3 — 抽出 LLM Provider

目前 `deepSeekChat()` 直接 fetch DeepSeek API。

Runtime 不应该绑定具体模型厂商。

定义：

```ts
interface LLMProvider {
  chat(request: LLMRequest): Promise<LLMResult>
}
```

实现：

```text
DeepSeekProvider
```

未来自然可以加：

```text
OpenAIProvider
AnthropicProvider
LocalVLLMProvider
```

AgentLoop 只依赖 `LLMProvider`，不依赖 DeepSeek API。

---

## 9. Phase 4 — 抽 ContextBuilder

这是减轻 `chat.ts` 最重要的一步。

当前 system prompt 构造包括：

```text
固定 System Prompt
WorkMode
User Prompt
Skill
Memory
Instinct
Date
```

统一变成：

```ts
ContextBuilder.build(...)
```

设计：

```ts
interface ContextProvider {
  build(ctx: ContextBuildInput): Promise<ContextBlock | null>
}
```

然后：

```text
SystemProvider
WorkModeProvider
UserPromptProvider
SkillProvider
MemoryProvider
InstinctProvider
DateProvider
```

组合：

```text
ContextBuilder
      │
      ├─ system
      ├─ mode
      ├─ skill
      ├─ memory
      ├─ instinct
      └─ date
```

以后新增 Project Context、Git Context、Current App Context、User Profile、Workspace 时，不需要继续修改 `chat.ts`。

---

## 10. Phase 5 — 建立 Runtime Event Bus

这是整个重构最关键的基础设施之一。

定义：

```ts
interface RuntimeEvent {
  type: string
  runId: string
  timestamp: number
}
```

事件建议包括：

```text
run.started
context.built

llm.started
llm.token
llm.thinking
llm.completed
llm.usage

tool.requested
tool.approval_required
tool.started
tool.completed
tool.failed

round.started
round.completed

run.completed
run.failed
run.cancelled
```

### UI

ChatStore 订阅：

```text
llm.token
tool.started
tool.completed
run.completed
```

负责更新 UI。

### Observation

Observation 订阅 Runtime Event Bus，而不是 Runtime 主动调用 `recordObservation(...)`。

### Stats

Stats 同样订阅：

```text
run.completed
llm.usage
```

### Memory

Memory Extractor 订阅：

```text
run.completed
session.switch
```

最终：

```text
             Runtime Event Bus
                 │
       ┌─────────┼─────────┐
       ▼         ▼         ▼
      UI    Observation   Stats
                            │
                         Memory
```

---

## 11. Phase 6 — 建立 Runtime Hook

Event 和 Hook 必须区分。

### Event

只是“发生了什么”，观察者不能改变执行。

### Hook

可以影响 Runtime 生命周期。

接口：

```ts
interface RuntimeHook {
  beforeRun?(ctx): Promise<void>
  beforeLLM?(ctx): Promise<void>
  afterLLM?(ctx): Promise<void>
  beforeTool?(ctx): Promise<void>
  afterTool?(ctx): Promise<void>
  afterRound?(ctx): Promise<void>
  afterRun?(ctx): Promise<void>
}
```

### HookManager

```text
AgentRuntime
     │
     ▼
HookManager
     │
 ┌───┼────┐
 ▼   ▼    ▼
A    B    C
```

需要支持：

- priority
- timeout
- failure isolation
- enabled / disabled

Hook 报错原则上不能导致主 Agent Runtime 崩溃。

---

## 12. Phase 7 — 加入 Review Hook

完成 Hook 基础设施后，再做第二模型 Review。

新增：

```text
RuntimeReviewHook
```

挂在：

```text
afterRun
```

### Review 输入

收集：

```text
AgentRun
Tool Calls
Tool Results
file_write
Git Diff
Final Answer
Errors
```

形成 `ReviewContext`。

### Reviewer

调用第二模型，输出：

```ts
interface ReviewResult {
  summary: string
  issues: ReviewIssue[]
  severity: 'ok' | 'warning' | 'error'
  suggestions: string[]
}
```

### UI

Run 完成后展示：

```text
Agent Answer

────────────

Review
✓ 通过
```

或：

```text
⚠ 发现 2 个问题
```

---

## 13. Phase 8 — Runtime 移到 Electron Main

前面的阶段可以暂时仍运行在 renderer。

等 Runtime API 稳定后，再迁移。

目标：

```text
Renderer
   │
runtime:start
   │
   ▼
Electron Main
   │
AgentRuntime
```

### IPC

新增：

```text
runtime:start
runtime:cancel
runtime:approve
runtime:deny
runtime:event
```

Renderer：

```ts
runtimeClient.start(...)
runtimeClient.cancel(...)
runtimeClient.approve(...)
```

Runtime 持续向 renderer 发 `runtime:event`。

---

## 14. Phase 9 — ChatStore 瘦身

最终 `chat.ts` 不再负责 Agent execution。

理想职责：

```text
Current Session
Messages UI State
Streaming Display
Approval Dialog
Unread State
```

调用逻辑大概变成：

```ts
async function sendMessage(text) {
  await runtimeClient.start({
    sessionId,
    input: text,
  })
}
```

监听：

```ts
runtimeClient.onEvent(event => {
  switch (event.type) {
    case 'llm.token':
      updateStreaming()
      break
    case 'tool.started':
      updateToolUI()
      break
    case 'run.completed':
      archiveMessage()
      break
  }
})
```

---

## 15. Phase 10 — Observation 改成 Runtime Trace

你已经有：

```text
llm.request
llm.usage
tool.request
tool.permission
tool.result
message.completed
```

后续建议提升为 Runtime Trace：

```text
Run
 │
 ├─ Round 0
 │   ├─ LLM request
 │   ├─ LLM output
 │   ├─ Tool request
 │   └─ Tool result
 │
 ├─ Round 1
 │   └─ ...
 │
 └─ Completed
```

这样 Observation、Debug、Replay、Review、Benchmark 可以共享同一套 Run Trace。

---

## 16. 推荐实施顺序

```text
Phase 0
测试基线

↓

Phase 1
AgentRun Domain

↓

Phase 2
AgentLoop 去 Vue 化

↓

Phase 3
LLM Provider

↓

Phase 4
ContextBuilder

↓

Phase 5
Runtime Event Bus

↓

Phase 6
Runtime Hook

↓

Phase 7
Review Hook

↓

Phase 8
迁移 Electron Main

↓

Phase 9
ChatStore 瘦身

↓

Phase 10
Runtime Trace
```

---

## 17. 第一轮实际改动范围

第一次 PR 不应该太大。

建议只做：

```text
AgentRun Types
Runtime Events Types
AgentLoop interface
useToolLoop → AgentLoop wrapper
```

暂时保持：

```text
chat.ts
Electron Tool Runtime
Memory
Skill
Observation
```

全部原样。

即：

```text
PR 1
只建立新架构骨架
不改变用户行为
```

---

## 18. 第二轮

```text
PR 2

useToolLoop
    ↓
AgentLoop
```

移除：

```text
Vue ref/reactive
```

改成普通 TypeScript。

UI Callback 暂时允许保留 Adapter：

```text
LegacyRuntimeAdapter
```

避免 UI 同时重写。

---

## 19. 第三轮

```text
PR 3

Prompt Build
    ↓
ContextBuilder
```

这是第一次真正明显缩小 `chat.ts`。

---

## 20. 第四轮

```text
PR 4

Runtime Event Bus
```

然后 Observation、Stats、UI 逐步从 callback 迁移到事件订阅。

---

## 21. 第五轮

```text
PR 5

HookManager
+
RuntimeReviewHook
```

此时原本想做的：

```text
Agent 完成
↓
Review runtime edits
```

正式落地。

---

## 22. 当前不建议马上做的事情

暂时不要同时加入：

```text
Sub-Agent
MCP 重构
远程 Runtime
手机控制
Checkpoint Resume
Task Queue
多 Agent Parallel
```

原因是这些都会依赖：

```text
AgentRun
Runtime Event
Runtime Lifecycle
```

先把 Runtime 地基做好，它们后面都会容易很多。

---

## 23. 重构完成后的核心调用链

```text
User
 │
 ▼
Chat UI
 │
 ▼
RuntimeClient.start()
 │
 ▼
AgentRuntime
 │
 ├─ ContextBuilder
 │
 ├─ Hook.beforeRun
 │
 ▼
AgentLoop
 │
 ├─ Round
 │   │
 │   ├─ LLMProvider
 │   ├─ ToolRuntime
 │   └─ RuntimeEvents
 │
 ├─ Round
 │
 └─ Final
 │
 ├─ Hook.afterRun
 │     │
 │     └─ ReviewHook
 │
 ▼
run.completed
 │
 ├─ UI
 ├─ Observation
 ├─ Stats
 └─ Memory
```

---

## 24. 重构成功的最终判据

不以“文件变少”为标准，而应满足：

1. 无需 Vue 就可以运行 `runtime.run(...)`；
2. Chat 页面关闭或切换，不影响 Runtime 本身生命周期；
3. 一次 Agent 请求存在明确的 `runId / roundId / toolCallId`；
4. Runtime 可以输出完整事件轨迹；
5. 新增一个 Hook 不需要修改 AgentLoop、chatStore、Tool Executor；
6. 未来新增 CLI、Mobile、Background Task、Sub-Agent 时可以直接复用同一个 AgentRuntime。

---

## 25. 最重要的实施策略

这次重构不要理解为：

> 把 `useToolLoop.ts` 搬到 `electron/runtime`。

真正需要完成的是：

```text
隐式 Runtime
        ↓
显式 Runtime Domain
        ↓
稳定 Runtime API
        ↓
事件驱动 Runtime
        ↓
可插拔 Hook Runtime
```

当前项目已经有比较完整的 Agent execution 能力。

这轮工作的核心，是把这些能力从“Chat 功能内部的实现细节”，提升成 deepseek-desktop 自己的一层基础设施：

**Agent Runtime。**
