# 划词对话（selection-as-context floating chat）

## 背景与动机

当前划词助手（`AssistantView.vue`）是**单次查询**模式：划词 → 翻译/解释（一次 API 调用）→ 显示结果。用户希望新增"对话"模式——划选内容作为上下文，在助手小窗口里和大模型多轮快速交互（追问、换角度、深入举例）。

这是经典的 "selection-as-context floating chat" 模式（Raycast AI、Cursor selection chat、Bob 的方向）。本应用已有完整资产可复用：流式 API、markdown/公式渲染、流式渲染分离。

## 已确认决策

| 维度 | 决策 |
|---|---|
| 范围 | 完整版 |
| 上下文展示 | 注入 system；窗内**不显示原文**（顶栏标题"✦ 划词对话"标识模式） |
| 入口 | bar 加"对话"按钮，顺序：复制 \| 翻译 \| 解释 \| 对话 |
| 会话模型 | 每次划词重置（新 system + 清空历史）；划新词回 bar |
| 上下文注入 | system role |
| model | `deepseek-v4-flash`（快速） |
| 持久化 | 不持久化，窗口关闭清空 |

## 架构

助手窗口（渲染进程）**直接流式调 API**，复用主聊天同条管线，不走主进程 IPC（流式 IPC 复杂且无必要；`assistant:query` 保留给翻译/解释单次）。

```
划词 → onText(capturedText) → bar 长条
点"对话" → phase='chat' → initContext(capturedText) + 清空 messages + resize 窗口
用户输入 / 点 chip → send(text) → push user → deepSeekChat 流式 → push assistant
划新词 → onText → phase='bar' + 清空 messages（重选动作，上下文不串）
```

### 数据流

- `systemContext: string` — 划选内容（完整传入，不截断）
- `messages: ChatMessage[]` — 对话历史（仅 user/assistant，不含 system）
- 发送时组装：`[{role:'system', content: 上下文提示 + systemContext}, ...trimmedMessages, {role:'user', content: 本次输入}]`

### 上下文注入（system message）

```
以下划选内容作为讨论背景，回答时据此为准：

{systemContext}            ← 划选内容完整传入，不截断
```

放 system role 的好处：上下文始终在场（不会被多轮稀释），对话流保持干净。

## 组件

### 新建 `src/composables/useAssistantChat.ts`

封装对话逻辑，让 `AssistantView` 聚焦 UI。导出：

- `messages: Ref<ChatMessage[]>` — 对话历史
- `streaming: Ref<boolean>` — 是否正在流式
- `streamingText: Ref<string>` — 当前流式累积文本
- `initContext(text: string)` — 重置 messages（存 systemContext，完整不截断）（划词/进对话时调）
- `send(text: string)` — 发送一条：push user、流式调 API、push assistant
- `clear()` — 清空历史（system 上下文保留）

内部：
- `apiKey` 取自 `useSettingsStore`（`loadSecrets` 异步填充，发送前判空）
- 流式：`deepSeekChat({ messages, model: 'deepseek-v4-flash', thinking: 'disabled', apiKey, onToken })`
- 历史裁剪：`trimHistory(messages, 20)` 超过 20 条丢弃最早（**纯函数，可单测**）

### 修改 `src/views/AssistantView.vue`

- `phase` 类型加 `'chat'`（现有 `'bar' | 'panel'`）
- bar 加"对话"按钮（`explain` 后；顺序：复制 \| 翻译 \| 解释 \| 对话）
- chat 模式 UI：
  - 顶栏：`✦ 划词对话` + `清空` + `✕`
  - 消息流：user/assistant 气泡；assistant 用 `renderMarkdown`，流式中用 `useStreamRender.processChunk` 做 safe/pending 分离（未闭合 `$...$` 不闪现）
  - 快捷 chip：`总结` / `详细说明` / `举个例子` / `换个角度`（点击 = `send(chip 文本)`）
  - 输入框：textarea，Enter 发送 / Shift+Enter 换行
- `doAction('chat')`：`phase='chat'` + `assistantResize(460, 520)` + `initContext(capturedText.value)`
- `onText` handler 增补：清空 `messages`（划新词重置）

### 复用（不改）

- `useDeepSeek.deepSeekChat` — 流式 API（渲染进程函数，助手窗口可直接用）
- `renderMarkdown` — 渲染（含公式/链接/填空横线）
- `useStreamRender.processChunk` — safe/pending 分离
- `settings.apiKey` + `settings.defaultModel`

## 关键交互细节

1. **划新词重置**：`onText` → `phase='bar'` + 清空 messages。用户再点"对话"重开（`initContext` 新内容）。保证上下文不串。
2. **apiKey 未就绪**：`send` 前 `if (!apiKey)` → 输入框提示"正在准备…"并禁用发送按钮；`loadSecrets` 完成后自动恢复。
3. **流式滚动**：流式中消息流自动滚到底；流式结束后用户可自由上滚。
4. **快捷 chip**：点击即 `send(chip)`，输入框不受影响。
5. **快捷键**：Enter 发送、Shift+Enter 换行、Esc 关窗口（沿用现有 `onKeydown`）。
6. **历史裁剪**：messages 超 20 条（10 轮）丢弃最早的 user/assistant，system 上下文不动。
7. **清空**：顶栏"清空"→ `clear()`（保留 system 上下文，清对话历史）。

## 边界与错误处理

- **API 失败 / 流式空返回**：assistant 消息显示"（请求失败，请重试）"，`streaming` 复位。
- **空输入**：`send('')` 直接忽略。
- **apiKey 缺失**（用户未配置）：输入区提示"请先在设置配置 API Key"。
- **中途取消**：暂不做（窗口小、轮次短，YAGNI）。如需可后续加 Esc 中断流式。
- **窗口尺寸**：chat 模式 `460×520`（比翻译面板 `420×340` 大，容纳对话）；复用现有 `assistantResize` IPC，主进程无需改。

## 测试要点

- `trimHistory(messages, max)` 纯函数：超限时丢弃最早、保留近期 + system；未超时原样返回。**可单测**（注册到 `run-all`）。
- 流式 / UI / API 交互：手动验证。

## 非目标（YAGNI）

- 不做会话持久化（临时上下文工具）。
- 不做多上下文累积（每次划词重置）。
- 不做 tool calling（助手对话是纯文本问答）。
- 不做 thinking 显示（flash + 快速交互场景）。
- 不做流式中途取消。

## 影响文件

| 文件 | 改动 |
|---|---|
| `src/composables/useAssistantChat.ts` | 新建：对话状态 + 流式 + 裁剪 |
| `src/views/AssistantView.vue` | 加 chat 模式（phase / template / script）+ bar "对话"按钮 |
| `tests/assistant-chat.test.ts` | 新建：`trimHistory` 纯函数测试（超限丢最早、未超原样），注册 run-all |
| 主进程 | 无改动（复用 `assistantResize`） |
