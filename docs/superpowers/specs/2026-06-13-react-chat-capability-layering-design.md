# 工作模式能力分层 + ReAct 多轮轨迹

## 背景与动机

当前 `chat` / `react` / `plan` 三种工作模式的唯一差异是注入 system prompt 的 `promptBlock` 措辞(`src/data/workModes.ts`、`src/stores/chat.ts:338-343`)。底层 `useToolLoop` 被所有模式共用:工具集、轮次上限(`MAX_TOOL_ROUNDS = 100`)、工具调用行的展示方式完全相同。结果是三种模式体感几乎无差别。

更关键的是 `useToolLoop.ts:117` 每轮循环开头 `activeToolCalls.splice(0, activeToolCalls.length)` 清空工具调用数组 —— **每一轮的工具调用会被下一轮覆盖,用户始终只看到"当前这一轮"**,ReAct 宣称的"多步推理轨迹"在展示上根本不成立。

本次改造的目标是让工作模式真正改变两件事:

1. **能做什么**(能力分层):Chat = 轻量只读工具 + 低轮次;ReAct/Plan = 全部工具 + 高轮次。
2. **怎么展示**(轨迹形态):ReAct/Plan 的工具调用行多轮累积堆叠;Chat 维持现状的简洁展示。

## 已确认的决策

| 维度 | 决策 |
|---|---|
| 展示形态 | ReAct/Plan 工具调用行多轮累积;Chat 维持每轮覆盖。Thought 仍走现有 `thinking` 折叠区,不显式标注、不污染正文。 |
| Chat 工具 | 白名单 5 个只读工具:`web_search`、`web_fetch`、`skill_load`、`skill_read_resource`、`skill_check_deps` |
| Chat 轮次 | 上限 3 轮 |
| ReAct/Plan 工具 | 全部 9 个 |
| ReAct/Plan 轮次 | 上限 100 轮(维持现状) |
| 轮次收尾(软兜底) | 达到 `maxRounds` 仍想调工具时,注入"工具预算已用尽,请作答"提醒,循环继续到 `maxRounds + 2`(始终带 tools);模型可文字作答或继续调工具,跑满才返回兜底文字 |
| Plan 展示 | 跟随 ReAct(累积 + 全工具) |

## 行为矩阵

| | Chat | ReAct | Plan |
|---|---|---|---|
| 工具集(9 选) | 5 个只读 | 全部 9 个 | 全部 9 个 |
| 工具轮次上限 | 3 | 100 | 100 |
| 生成中工具行 | 每轮覆盖(现状) | **多轮累积堆叠** | 多轮累积堆叠 |
| 完成后归档位置 | 正文上方(现状) | 正文上方(多条) | 正文上方(多条) |
| 达上限行为 | 软兜底(3→5 轮,保证作答) | 正常 100 轮 | 正常 100 轮 |

## 工具清单与分组

全部 9 个内置工具(注册于 `electron/tools/index.ts`):

```
web_search, web_fetch,                          // 网络(只读)
file_read, file_write, list_dir,                // 文件(含写)
skill_load, skill_read_resource,                // Skill 入口 + 资源(只读)
skill_check_deps, skill_script_run              // Skill 依赖检查(只读) + 脚本执行(有副作用)
```

- **Chat 白名单(5)**:`web_search`、`web_fetch`、`skill_load`、`skill_read_resource`、`skill_check_deps` —— 全部只读 / 无副作用,符合"轻量"定位。
- **ReAct/Plan 独享(+4)**:`file_read`、`file_write`、`list_dir`、`skill_script_run`。

## 设计

### 1. 能力策略中心(`src/data/workModes.ts`)

新增能力策略类型,并在每个模式上声明 `capabilities`:

```ts
export interface ModeCapabilities {
  /** 工具调用轮次上限 */
  maxRounds: number
  /** 允许的工具:'all' 或工具名白名单 */
  allowedTools: string[] | 'all'
  /** 工具调用行是否多轮累积(ReAct/Plan=true);false=每轮覆盖(Chat 现状) */
  accumulate: boolean
}

export interface WorkModeDefinition {
  value: WorkMode
  label: string
  desc: string
  promptBlock: string
  capabilities: ModeCapabilities   // 新增
}
```

各模式的 `capabilities`:

```ts
chat:  { maxRounds: 3,   allowedTools: ['web_search','web_fetch','skill_load','skill_read_resource','skill_check_deps'], accumulate: false }
react: { maxRounds: 100, allowedTools: 'all',                                                                        accumulate: true  }
plan:  { maxRounds: 100, allowedTools: 'all',                                                                        accumulate: true  }
```

集中声明的好处:新增/调整模式只改这一处映射,`useToolLoop` 和 `chat.ts` 都不必感知具体模式名。

### 2. `useToolLoop.ts` 改造(改动焦点)

`ToolLoopOptions` 增加必填参数 `modePolicy: ModeCapabilities`。`run()` 内部四处变化:

**(a) 工具 schema 过滤** —— `loadToolsSchema()` 拿到全部工具后,按白名单过滤:

```ts
const all = resp.tools.map(...)  // 现状
toolsSchema.value = options.modePolicy.allowedTools === 'all'
  ? all
  : all.filter(t => options.modePolicy.allowedTools.includes(t.function.name))
```

function calling 的天然保证:不暴露给模型的工具,模型根本看不到、不会尝试调用,无需运行时拦截。

**(b) 轮次参数化** —— 循环上限用策略值:

```ts
for (let round = 0; round < options.modePolicy.maxRounds; round++) { ... }
```

**(c) 累积逻辑** —— 循环开头当前是 `activeToolCalls.splice(0, activeToolCalls.length)`。改为:

```ts
if (!options.modePolicy.accumulate) {
  activeToolCalls.splice(0, activeToolCalls.length)  // Chat:每轮覆盖(现状)
}
// accumulate=true 时不清空,后续 push 自然累积
```

`onToolCallUpdate` 回调传出的数组在累积模式下会越来越长;`chat.ts` 的整包覆盖式赋值(`activeToolCalls.value = [...calls]`)原样照抄,天然支持。

**(d) 达上限收尾(软兜底)** —— 循环上界用 `absoluteLimit = maxRounds + 2`(绝对上限),而非 `maxRounds` 硬截断。当 `round >= maxRounds` 时,**仅注入一次** system 提醒:

```
工具预算已用尽。现在必须用文字回答用户:已查到的信息就总结呈现;没查到就明确回复「未找到相关内容」并简要说明原因(如搜索结果被干扰)。禁止再调用任何工具。
```

注入后**循环继续**(始终带 `tools`,避免 DeepSeek 在无 tools 时把内部 DSML 工具标记泄漏为正文):模型既可文字作答(`finishReason !== 'tool_calls'` 即 `return`),也可继续调工具(仍正常执行、喂回结果)。只有跑到 `absoluteLimit` 仍只调工具不出文字,才返回代码兜底文字(`未能查到相关内容…`)。

> 设计演进:最初用「硬截断 + 单轮收尾(不带 tools)」,暴露两个问题——无 tools 时模型把 DSML 标记当正文输出(乱码);单轮收尾模型仍调工具但不执行、无文本输出(空答)。软兜底 + 始终带 tools + 加强作答提醒同时解决两端。

### 3. `src/stores/chat.ts`(最小改动)

仅在 `toolLoop.run({...})` 调用处(`chat.ts:406-453`)增加两步:

```ts
const policy = workModes.find(m => m.value === settingsStore.workMode)?.capabilities
              ?? workModes[0].capabilities  // 兜底 chat

const loopResult = await toolLoop.run({
  ...,
  modePolicy: policy,   // 新增
})
```

其余**完全不动**:`onToolCallUpdate`、`finalToolCalls = [...activeToolCalls.value]` 归档(`chat.ts:459-461`)、消息持久化都已天然支持累积。

### 4. 展示层(`src/components/chat/MessageList.vue`)—— 零改动

- **生成中**:累积模式下 `activeToolCalls` 自然变长,`<ToolCallStatus :calls="chatStore.activeToolCalls">`(`MessageList.vue:187`)模板内已是 `v-for`,多行堆叠自动生效。
- **完成后**:ReAct/Plan 的 `msg.toolCalls` 含多轮调用,`MessageList.vue:165` 的 `<ToolCallStatus v-for>` 已支持多条渲染于正文上方 = 完整轨迹。
- **Chat 完成后**:`activeToolCalls` 每轮覆盖 → 只有最后一轮 → 正文上方"简单"显示,正是预期。

无需新组件、无需改模板。

## 类型与数据

- `WorkMode`(`src/types/index.ts:40`)不变:仍是 `'chat' | 'plan' | 'react'`。
- `Message.toolCalls`(`src/types/index.ts:19`)类型不变,ReAct 多轮只是数组变长。
- `ToolCallUIState` **不加** `round` 字段(YAGNI):用户确认的形态里不需要轮次分隔线,工具行直接堆叠即可。若日后累积过密需要视觉分组,再加。

## 边界与错误处理

- **模型调用受限工具**:不会发生。受限工具未进 schema,模型看不到。无需运行时拦截或错误提示。
- **软兜底收尾**:达到 `maxRounds` 注入作答提醒后循环继续到 `maxRounds + 2`;始终带 tools 避免 DSML 泄漏。极端情况(2 轮兜底全在调工具不出文字)返回代码兜底文字。
- **生成中切换模式**:不影响当前 `run()` —— 策略在 `run()` 开始时一次性确定。切换只影响下一次发送。
- **`skill_script_run` 不在 Chat 暴露**:Chat 模式下用户加载的 Skill 若需跑脚本,会因工具不可见而无法执行;这是"轻量模式"的有意限制,非 bug。模型会改为用文字说明或在 ReAct/Plan 下完成。
- **中断/abort**:现有 `AbortSignal` 机制不变,累积的工具调用在中断时按现状处理(归档已完成的)。

## 测试要点

1. **工具过滤**:Chat 模式 `toolsList` 返回的 schema 不含 `file_write`、`list_dir`、`skill_script_run`;ReAct/Plan 含全部 9 个。
2. **累积**:ReAct 连续多轮工具调用后,`activeToolCalls.length` = 各轮 `tool_calls` 数量之和;完成后 `msg.toolCalls.length` 同样累积。
3. **覆盖**:Chat 模式多轮后,`activeToolCalls` 只含最后一轮的调用(回归现状)。
4. **软兜底收尾**:Chat 达到 3 轮注入作答提醒,循环继续到最多 5 轮;工具未命中(如污染关键词)时模型仍明确作答(说「未找到」)或返回兜底文字,不出现空答或 DSML 乱码。
5. **回归**:Chat 单轮工具调用的生成中展示、完成后归档与改造前一致。

## 非目标(YAGNI)

- 不强制 ReAct 模式开启 `thinking` —— 深度思考保持独立 toggle,与 `workMode` 解耦。
- 不加轮次视觉分隔线(用户确认的形态里没有)。
- 不改 Plan 模式的 prompt 行为(它仅共享能力策略;计划→执行的两阶段话术保持现状)。
- 不引入新的 `round` 数据结构。

## 影响文件

| 文件 | 改动 |
|---|---|
| `src/data/workModes.ts` | 新增 `ModeCapabilities` 类型;三模式补 `capabilities` 字段 |
| `src/composables/useToolLoop.ts` | `run()` 增 `modePolicy` 参数;schema 过滤、轮次参数化、累积开关、达上限收尾 |
| `src/stores/chat.ts` | `run()` 调用处按 `workMode` 取策略并传入(约 3 行) |
| 展示层 | 无改动 |
