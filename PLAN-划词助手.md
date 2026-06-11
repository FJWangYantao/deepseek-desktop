# 划词助手 实现计划

> 版本：v1.0 | 日期：2026-06-07 | 状态：规划中

## 1. 功能定义

用户在 Windows 应用（浏览器 + 本地编辑器）中选中文本后，选中区域旁自动浮出 [翻译] [释义] 动作按钮栏。点击动作按钮后弹出悬浮窗，展示 DeepSeek Flash 生成的结果（2-3句 + 简例），底部提供 [复制] 按钮。鼠标离开窗口区域 2 秒后自动消失。

**核心约束**：完全独立模块，不写入聊天会话或记忆系统，不使用快捷键。

## 2. 技术决策

| 决策项 | 选择 | 原因 |
|--------|------|------|
| 触发方式 | 鼠标释放 + UI Automation 自动浮出 | 用户期望零操作触发 |
| 检测范围 | 本地编辑器 + 浏览器（不覆盖游戏/终端） | 主流使用场景覆盖 |
| 动作类型 | 翻译（中英互译） + 解释/释义 | 最高频需求 |
| 结果深度 | 适中：2-3句 + 简例 | 信息量够用，窗口可控 |
| 模型 | 固定 deepseek-v4-flash | 最快响应，划词场景不需要深度推理 |
| 窗口形式 | 鼠标位置悬浮窗 | 自然关联选中位置 |
| 消失逻辑 | 鼠标离开 2 秒后自动消失 | 不打扰工作流 |
| 结果交互 | 一键复制 | 最实用的唯一操作 |
| 系统集成 | 完全独立 | 降低复杂度，快速上线 |
| 快捷键 | 不使用 | 纯自动浮出体验 |

## 3. 核心技术方案

### 3.1 全局鼠标监听：koffi + SetWindowsHookEx

Electron 没有全局鼠标事件 API。使用 `koffi`（现代 Node.js FFI 库）直接调用 Windows API 注册 `WH_MOUSE_LL` 低级鼠标钩子。

**为什么选 koffi 而不选 iohook**：iohook 对 Electron 42.x 兼容性不确定，需预编译 native addon。koffi 是纯 JS 调用动态链接，更灵活可控，且支持 Node 18+。

**关键实现细节**：

- 钩子回调只在 `WM_LBUTTONUP`（左键释放）时触发，记录鼠标坐标和时间戳
- 回调必须在 300ms 内返回（Windows 系统要求），所以只做最轻量操作，选中检测异步执行
- 应用退出时必须调用 `UnhookWindowsHookEx` 卸载钩子，否则残留
- 需要防抖：忽略短时间内连续触发（如拖拽过程中多次 mouseup），设 500ms 间隔阈值

**新增文件**：
- `electron/selection/mouse-hook.ts` — koffi FFI 定义 + 钩子注册/卸载

### 3.2 选中文字提取：koffi + IUIAutomation COM 接口

鼠标释放后异步执行选中文字提取。通过 koffi 调用 Windows UI Automation COM 接口：

1. `CoCreateInstance(CUIAutomation)` → 获取 `IUIAutomation` 对象
2. `IUIAutomation.ElementFromPoint(x, y)` → 获取鼠标位置处的 UI 元素
3. 检查元素是否支持 `IUIAutomationTextPattern`
4. `TextPattern.GetSelection()` → 获取选中文本范围
5. `TextRange.GetText(-1)` → 提取选中文字内容

**兼容性预估**：
- ✅ Word、Notepad、写字板、Outlook — 完全支持 TextPattern
- ✅ Edge — 较好支持，通过 IAccessible 桥接
- ⚠️ Chrome/Firefox — 部分支持，取决于页面可访问性标注
- ❌ 终端、游戏 — 不支持，静默跳过

**降级策略**：UI Automation 提取失败时不显示浮出栏，静默跳过。不做 Ctrl+C 模拟等 hack 操作（会污染剪贴板）。

**新增文件**：
- `electron/selection/uia-extractor.ts` — koffi COM 接口定义 + 文字提取逻辑

### 3.3 悬浮窗口系统

两个独立的 frameless BrowserWindow：

**ActionBar（动作按钮栏）**
- 尺寸：160×36 px
- 样式：frameless, transparent, always-on-top
- 内容：[翻译] [释义] 两个按钮，水平排列
- 定位：鼠标释放位置下方偏右 12px
- 生命周期：鼠标离开 ActionBar 区域 → 启动 2 秒计时器 → 计时结束关闭窗口

**ResultWindow（结果悬浮窗）**
- 尺寸：360×240 px（内容自适应高度，最大 320）
- 样式：frameless, transparent, always-on-top，圆角 + 微阴影
- 内容：结果文本 + 底部 [复制] 按钮
- 定位：ActionBar 下方（如果 ActionBar 还在），否则在鼠标位置下方
- 生命周期：鼠标离开 → 2 秒计时器 → 关闭；鼠标重新进入 → 重置计时器

**窗口定位防溢出**：计算目标位置后检查是否超出屏幕边界（使用 `screen.getPrimaryDisplay().workAreaSize`），超出时向左/向上偏移。

**新增文件**：
- `electron/windows/action-bar.ts` — ActionBar BrowserWindow 创建、定位、销毁
- `electron/windows/result-window.ts` — ResultWindow BrowserWindow 创建、定位、销毁
- `quick-assist.html` — 悬浮窗口 HTML 入口（单一入口，query 参数区分模式）
- `src/quick-assist/main.ts` — 悬浮窗口 Vue 应用入口
- `src/quick-assist/ActionBar.vue` — 动作按钮栏组件
- `src/quick-assist/ResultView.vue` — 结果展示 + 复制按钮组件

### 3.4 Flash API 调用

主进程直接调用 DeepSeek API（不经过渲染进程），独立于 chat store。

**翻译 prompt**：
```
你是一个专业翻译助手。请将以下文本翻译为目标语言。

规则：
1. 如果原文是中文，翻译为英文；如果是英文或其他语言，翻译为中文
2. 只输出译文，不要多余解释
3. 译文后附一句简短的使用场景提示

原文：
{selectedText}
```

**释义 prompt**：
```
你是一个简洁的知识解释助手。请解释以下内容的含义。

规则：
1. 用 2-3 句话解释，通俗易懂
2. 给出 1 个简短的例子
3. 不输出多余内容

需要解释的内容：
{selectedText}
```

**API 参数**：model=`deepseek-v4-flash`，thinking=`disabled`，非流式调用（完整返回，不在悬浮窗内做流式渲染）。

**新增文件**：
- `electron/selection/flash-call.ts` — Flash API 调用封装

### 3.5 整体事件流

```
[用户选中文本 → 释放鼠标]
       ↓
[mouse-hook 检测 WM_LBUTTONUP]
       ↓
[500ms 防抖判断]
       ↓
[uia-extractor 尝试提取选中文字]
       ↓ 失败 → 静默跳过
       ↓ 成功 → 获得 selectedText + 鼠标坐标
       ↓
[创建 ActionBar BrowserWindow]
       ↓ 定位在鼠标位置下方
       ↓
[用户点击「翻译」或「释义」]
       ↓
[关闭 ActionBar → 创建 ResultWindow]
       ↓ 同时调用 flash-call
       ↓
[ResultWindow 显示加载状态]
       ↓ API 返回 → 更新结果文本 + [复制] 按钮
       ↓
[用户复制 / 鼠标离开 2 秒 → 关闭 ResultWindow]
```

## 4. 文件结构

新增文件（全部在 `electron/` 和 `src/quick-assist/` 下）：

```
electron/
  selection/
    mouse-hook.ts         # koffi + SetWindowsHookEx 钩子
    uia-extractor.ts      # koffi + UI Automation 文字提取
    flash-call.ts         # DeepSeek Flash API 调用
    index.ts              # 划词助手模块入口，协调上述三个模块
  windows/
    action-bar.ts         # ActionBar BrowserWindow 管理
    result-window.ts      # ResultWindow BrowserWindow 管理
  ipc/
    quick-assist.ts       # IPC handlers（enable/disable toggle）

quick-assist.html          # 悬浮窗口 HTML 入口

src/quick-assist/
  main.ts                  # 悬浮窗口 Vue 应用入口（独立于主应用）
  ActionBar.vue            # 动作按钮栏组件
  ResultView.vue           # 结果展示 + 复制按钮组件
  style.css                # 悬浮窗口样式
```

**不修改的现有文件**：chat store、session store、settings store、App.vue、router — 划词助手完全独立，不触碰任何现有模块。

**需要修改的现有文件**（最小改动）：
- `electron/main.ts` — 加 2 行：`registerQuickAssistHandlers()` + `initQuickAssist()`
- `electron/preload.ts` — 加 2 个 IPC API：`quickAssistToggle`、`quickAssistGetStatus`
- `vite.config.ts` — 加 quick-assist.html 作为额外入口点
- `package.json` — 加 `koffi` 依赖
- `src/views/SettingsView.vue` — 加划词助手开关和状态显示

## 5. 新增依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| `koffi` | ^2.8 | FFI 调用 Windows API（SetWindowsHookEx + UI Automation COM） |

仅新增 1 个依赖，koffi 是轻量的纯 JS 库，无 native 编译步骤。

## 6. 分阶段实施计划

### Phase 1：基础设施（Day 1-2）

1. 安装 koffi，验证 Electron 42 + koffi 基础可用性
2. 实现 `mouse-hook.ts`：注册 WH_MOUSE_LL，检测 WM_LBUTTONUP，记录坐标
3. 测试：在主进程中打印鼠标释放事件，确认钩子正常工作
4. 实现防抖逻辑和卸载钩子

### Phase 2：文字提取（Day 3-4）

1. 实现 `uia-extractor.ts`：koffi 定义 COM 接口
2. 实现 `ElementFromPoint` → `TextPattern.GetSelection` → `GetText` 流程
3. 测试：在 Notepad、Word、Edge 中选中文字，验证提取结果
4. 实现 fallback：提取失败时静默跳过，记录日志便于后续调试

### Phase 3：悬浮窗口（Day 5-6）

1. 创建 `quick-assist.html` 和 `src/quick-assist/` Vue 应用
2. 实现 ActionBar BrowserWindow：创建、定位、鼠标离开计时器
3. 实现 ResultWindow BrowserWindow：创建、定位、内容更新
4. 实现定位防溢出逻辑
5. 实现 [复制] 功能（`clipboard.writeText`）
6. 美化 UI：圆角、阴影、字体、按钮样式

### Phase 4：API 调用 + 串联（Day 7-8）

1. 实现 `flash-call.ts`：翻译和释义两条 prompt，非流式调用
2. 实现 `electron/selection/index.ts`：串联鼠标监听 → 文字提取 → 显示 ActionBar → 用户点击 → 调用 API → 显示 ResultWindow
3. 实现 IPC handler：enable/disable 划词助手
4. SettingsView 加开关和状态显示
5. 修改 `electron/main.ts` 和 `preload.ts` 注册新模块

### Phase 5：打磨 + 测试（Day 9-10）

1. 全流程集成测试：Notepad、Word、Edge、Chrome 中选中 → 浮出 → 翻译/释义 → 复制 → 消失
2. 边界测试：超长文本、空选中、特殊字符、屏幕边缘溢出、多显示器
3. 性能测试：钩子回调延迟、UI Automation 提取速度、Flash API 响应时间
4. 窗口闪烁/残留测试：快速切换应用、最小化/恢复、应用退出时钩子清理
5. 权限测试：Windows UAC 场景下 UI Automation 是否可用

## 7. 风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| koffi + Electron 42 兼容性 | 钩子注册失败 | Phase 1 先验证，不行则改用自定义 C++ addon |
| UI Automation 在 Chrome 中提取率低 | 浏览器体验不佳 | 长期可考虑 Chrome 插件方案，短期接受兼容性约 60-70% |
| WH_MOUSE_LL 300ms 超时限制 | 钩子被系统跳过 | 回调只做坐标记录，所有重逻辑异步 |
| 透明 frameless 窗口在 Windows 上的渲染问题 | 窗口闪烁/黑边 | 使用 `backgroundColor: '#00000000'` + `hasShadow: false`，必要时改用非透明背景 |
| 低权限场景下 UI Automation 不可用 | 部分应用提取失败 | 设置页面提示用户以管理员权限运行，或接受兼容性限制 |
| Flash API 调用失败（无 API Key、网络错误） | 悬浮窗显示错误 | ResultWindow 显示「请先配置 API Key」或「网络错误，稍后重试」 |

## 8. 未来迭代方向

- **Chrome/Firefox 插件**：为浏览器提供 Native Messaging 桥接，实现 100% 选中检测覆盖
- **自定义动作**：允许用户创建自定义 prompt 动作按钮（类似轻量 Skill）
- **划词历史**：独立记录划词助手使用历史，可在设置中查看
- **语音朗读**：结果窗口加 [朗读] 按钮，调用 TTS API
- **与记忆系统打通**：释义结果可选写入记忆，作为「学到的知识」
- **Mac 版适配**：macOS 上用 Accessibility API + `NSEvent.addGlobalMonitorForEvents` 替代方案