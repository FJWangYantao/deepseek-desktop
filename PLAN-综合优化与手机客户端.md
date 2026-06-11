# DeepSeek Desktop — 综合优化 & 手机客户端开发计划

> 版本：v1.0 | 日期：2026-06-08 | 状态：规划中

---

## 第一部分：现有功能优化

### 一、紧急 Bug 修复（P0）

#### 1.1 会话数据丢失风险
**问题**：所有会话+消息存储在 localStorage，~5MB 容量上限，长期使用必然溢出。`watch` 的 `catch {}` 静默吞掉 `quota exceeded` 错误，用户无感知丢数据。
**方案**：
- 短期：`catch` 中增加用户提示（"存储空间不足，请导出/清理旧会话"）
- 中期：迁移到 IndexedDB（容量 ~100MB+）或 Electron 文件系统存储
- 增加 `quota exceeded` 预警机制，当使用量 > 4MB 时主动提醒

#### 1.2 错误消息写入错误会话
**问题**：`chat.ts` 第 439 行，API 失败时 `messages.value.push(errMsg)` 直接写入当前显示的 `messages`，但如果用户在生成期间切换了会话，错误消息会写入错误的会话。
**方案**：错误消息通过 `sid` 定位到原始会话写入，而非写入当前 `messages.value`。

#### 1.3 retryMessage 丢失附件
**问题**：`chat.ts` 第 460-469 行，重试时只传 `userMsg.content`，不传 `files`，附件丢失。
**方案**：`sendMessage(userMsg.content, userMsg.files)` 或把附件信息保留在消息元数据中。

#### 1.4 DSL 解析器死代码
**问题**：`dsl-parser.ts` 第 161-163 行，`if (!map.has('prompt'))` 在外层 `if (map.has('prompt'))` 内永远为 false。
**方案**：修正为校验 `prompt` 字段值是否为空字符串。

#### 1.5 HTTP 重定向无限递归
**问题**：`duckduckgo.ts` 的 `httpGet` 函数遇 3xx 时递归调用自身，恶意服务器可构造 A→B→A 循环导致栈溢出。
**方案**：增加 `maxRedirects` 参数（默认 5），超出则拒绝。

---

### 二、安全加固（P0）

#### 2.1 API Key 存储安全
**现状**：API Key 明文存储在 localStorage，任何 XSS 或渲染进程漏洞都可窃取。
**方案**：
- 使用 `keytar`（系统密钥链）或 `electron-safeStorage`（Electron 内置加密 API）
- `electron-safeStorage` 无需额外依赖，Windows 上用 DPAPI 加密，推荐优先
- 迁移逻辑：首次启动检测 localStorage 中的旧 Key → 迁移到安全存储 → 清除明文

#### 2.2 XSS 风险
**现状**：`MessageList.vue` 使用 `v-html` 渲染 Markdown，`useMarkdown.ts` 中 URL 自动链接化未过滤 `javascript:` 协议。
**方案**：
- `marked` 配置 `sanitize` 或使用 DOMPurify 后处理
- URL 正则增加协议白名单（只允许 `http://`、`https://`、`mailto:`）

#### 2.3 路径白名单检查不严格
**现状**：`permissions.ts` 第 55 行 `startsWith` 检查，`/home/user` 会匹配 `/home/user2/secret`。
**方案**：拼接路径分隔符后比较，`path.resolve(allowed) + path.sep`。

---

### 三、性能优化（P1）

#### 3.1 持久化方案升级
**现状**：localStorage 存所有数据（会话+消息+记忆+统计+设置），deep watch 每次变更全量序列化。
**方案**：
- 迁移到 IndexedDB（推荐 `idb-keyval` 轻量封装）或 Electron 主进程文件存储
- 会话消息按需加载（只加载最近 N 条，滚动加载历史）
- 记忆和统计数据分离存储，减轻主 store 体积

#### 3.2 useMemory.ts 拆分（893 行 → 4 个模块）
**现状**：全项目最大文件，记忆提取/整理/检索/持久化混在一起。
**方案**：
- `memory-store.ts` — 持久化 + CRUD
- `memory-extractor.ts` — AI 提取逻辑 + prompt 管理
- `memory-dreamer.ts` — Dreaming 整理 + dry run
- `memory-search.ts` — 相关度计算 + 上下文构建

#### 3.3 搜索性能
**现状**：本地热点搜索模糊匹配 O(N) 遍历所有索引关键词；Web 搜索无缓存；页面抓取串行。
**方案**：
- 倒排索引增加 trigram 索引加速模糊匹配
- Web 搜索增加内存缓存（LRU，TTL 10 分钟）
- `fetchPageContents` 改为 `Promise.allSettled` 并行抓取

#### 3.4 统计聚合优化
**现状**：`dailyMap`/`hourlyMap`/`sessionStats` 每次 `records` 变化全量重算。
**方案**：增量计算 + `watchEffect` 只处理新增记录，或引入时间窗口只聚合最近 N 天。

#### 3.5 Token 计数优化
**现状**：`useMemory.ts` 中的 `tokenCount` 用简单公式估算（中文×1.5 + 英文×1.3），偏差 30%+。
**方案**：复用 `electron/tokenizer/` 的 HuggingFace Tokenizer，通过 IPC 调用精确计数，增加缓存。

---

### 四、功能增强（P1）

#### 4.1 对话搜索
**需求**：在历史会话中搜索关键词，高亮匹配结果。
**方案**：
- ChatView 顶部增加搜索栏（Ctrl+F 触发）
- 全文搜索所有会话的 messages.content
- 搜索结果列表 → 点击跳转到对应会话+消息位置

#### 4.2 会话管理增强
**需求**：会话分组/标签/收藏/归档。
**方案**：
- session store 增加 `tags: string[]`、`pinned: boolean`、`archived: boolean` 字段
- 侧栏增加分组视图（按标签/时间/收藏）
- 会话删除增加确认对话框

#### 4.3 消息编辑
**需求**：编辑已发送消息，从该消息点重新生成。
**方案**：
- 消息气泡增加编辑按钮
- 编辑后截断该消息之后的所有消息
- 保留被截断消息用于"撤销编辑"

#### 4.4 API 连接测试
**需求**：设置页增加"测试连接"按钮。
**方案**：发送一条简短的 test 请求到 DeepSeek API，验证 Key 有效性和网络连通性。

#### 4.5 自动更新
**需求**：应用自动检测新版本并提示更新。
**方案**：集成 `electron-updater`，配合 GitHub Releases 发布。

#### 4.6 系统托盘
**需求**：关闭窗口时最小化到托盘，而非退出应用。
**方案**：`Tray` + `contextMenu`，关闭窗口时 `event.preventDefault()` + `window.hide()`。

#### 4.7 MCP 工具桥接
**现状**：`skills.ts` 中 `mcp:tool-call` 标记 TODO 未实现。
**方案**：实现 MCP 协议客户端，支持 stdio 和 SSE 两种传输模式。

#### 4.8 首次启动引导
**需求**：新用户无 API Key 时显示配置引导页。
**方案**：检测 `settings.apiKey` 为空时渲染 OnboardingView，引导输入 Key + 选择角色模板。

---

### 五、UX 改进（P2）

#### 5.1 记忆透明度
在对话中标注"本次注入了 X 条记忆"（可折叠），让用户了解记忆系统工作状态。

#### 5.2 Skill 执行进度
DSL 执行时显示步骤进度条（当前步骤/总步骤），而非仅"执行中"占位消息。

#### 5.3 深色模式跟随系统
检测 `nativeTheme.shouldUseDarkColors`，设置增加"跟随系统"选项。

#### 5.4 统计数据展示优化
费用显示改为 2 位小数（¥0.12），清除调试文本，增加数据导出（CSV/JSON）。

#### 5.5 错误重试机制
API 调用失败后提供"重试"按钮，网络错误增加指数退避自动重试（最多 2 次）。

---

## 第二部分：手机客户端开发计划

### 一、产品定位

**产品名称**：DeepSeek Mobile（暂定）

**核心定位**：全功能移动端 AI 助手，既是独立的 DeepSeek 客户端，又能与桌面端协同工作。

**四大功能模块**：

| 模块 | 描述 | 优先级 |
|------|------|--------|
| 独立客户端 | 手机端独立使用 DeepSeek API 对话，完整聊天体验 | P0 |
| 远程对话 | 同步/继续桌面端对话，查看历史记录 | P0 |
| 控制面板 | 远程触发搜索、查看热点、管理记忆和 Skill | P1 |
| 消息中转 | 手机端文字/图片/文件快速传输到桌面端对话 | P1 |

### 二、技术选型

#### 2.1 客户端技术栈：原生开发

| 平台 | 技术 | 原因 |
|------|------|------|
| Android | Kotlin + Jetpack Compose | 性能最优，Material Design 3 原生体验 |
| iOS | Swift + SwiftUI | 最佳 iOS 体验，充分利用系统能力 |

**共享层**：
- API 通信协议（Protobuf / JSON Schema）两端共用定义
- 业务逻辑层（Kotlin Multiplatform 可选，用于共享网络/加密/数据模型逻辑）

#### 2.2 通信架构：云端中继

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│  Desktop    │◄───────►│  Relay      │◄───────►│  Mobile     │
│  (Electron) │  WSS    │  Server     │  WSS    │  (Native)   │
│             │         │  (中继+存储) │         │             │
└─────────────┘         └─────────────┘         └─────────────┘
```

**通信协议**：WebSocket Secure (WSS)，双向实时通信

**中继服务器职责**：
- 设备配对与认证（设备码 + 用户确认）
- 消息转发（不持久化内容，仅中转）
- 离线消息队列（设备不在线时缓存，上线后推送）
- 会话同步（增量同步，非全量）
- 心跳保活 + 断线重连

### 三、系统架构

#### 3.1 Desktop 端新增模块

```
electron/
  relay/
    server.ts              # 中继连接管理（WebSocket client）
    protocol.ts            # 通信协议定义（消息类型/序列化）
    auth.ts                # 设备配对 + Token 管理
    sync.ts                # 会话/消息增量同步引擎
    command-handler.ts     # 处理手机端发来的控制命令
  ipc/
    relay.ts               # 中继相关 IPC handlers
```

**Desktop 端新增能力**：
- 启动时连接中继服务器，保持长连接
- 接收手机端消息 → 注入到指定会话
- 同步本地会话变更到中继（增量）
- 响应手机端控制命令（搜索、热点查询、记忆管理）
- 离线消息接收后自动归档

#### 3.2 Relay Server 架构

```
relay-server/
  src/
    main.ts                # 服务入口
    ws/
      gateway.ts           # WebSocket 网关（连接管理/心跳/路由）
      router.ts            # 消息路由（设备配对 → 转发）
    auth/
      device-pair.ts       # 设备配对流程（扫码/验证码）
      token.ts             # JWT Token 签发+验证
    sync/
      session-sync.ts      # 会话增量同步
      message-queue.ts     # 离线消息队列（Redis）
    storage/
      redis.ts             # Redis 连接（消息队列 + 缓存）
      db.ts                # PostgreSQL（用户/设备/配对信息）
  docker-compose.yml       # Redis + PostgreSQL + Relay Server
```

**部署方案**：
- 推荐：单台 VPS（2C4G 起步） + Docker Compose
- 可选：Cloudflare Tunnel 暴露服务（免公网 IP）
- 后期：水平扩展时 WebSocket 网关用 Redis Pub/Sub 跨实例通信

#### 3.3 Mobile 端架构

**Android (Kotlin + Compose)**：
```
app/src/main/
  data/
    remote/
      RelayClient.kt       # WebSocket 连接管理
      DeepSeekApi.kt       # DeepSeek API 直连（独立模式）
      Protocol.kt          # 通信协议 Kotlin 定义
    local/
      AppDatabase.kt       # Room 数据库
      dao/                 # Session/Message/Settings DAO
    repository/
      ChatRepository.kt    # 对话数据仓库（本地+远程）
      SyncRepository.kt    # 同步状态管理
  domain/
    model/                 # 业务模型
    usecase/               # 业务用例
  ui/
    chat/                  # 对话界面
    settings/              # 设置界面
    control/               # 控制面板
    pairing/               # 设备配对
    transfer/              # 消息中转
```

**iOS (Swift + SwiftUI)**：
```
DeepSeekMobile/
  Models/                  # 数据模型
  Services/
    RelayClient.swift      # WebSocket 连接（URLSessionWebSocketTask）
    DeepSeekAPI.swift      # API 直连
    SyncEngine.swift       # 同步引擎
  Views/
    ChatView.swift         # 对话主界面
    SettingsView.swift     # 设置
    ControlPanel.swift     # 控制面板
    PairingView.swift      # 配对
    TransferView.swift     # 消息中转
  Persistence/
    SwiftDataManager.swift # SwiftData 本地存储
```

### 四、通信协议设计

#### 4.1 消息类型

```typescript
// 通用消息信封
interface RelayMessage {
  id: string                    // 消息唯一 ID
  type: MessageType             // 消息类型
  from: string                  // 发送设备 ID
  to: string                    // 目标设备 ID（'*' 表示广播）
  timestamp: number             // 时间戳
  payload: any                  // 负载数据
}

enum MessageType {
  // 配对
  PAIR_REQUEST     = 'pair:request',      // 配对请求
  PAIR_CONFIRM     = 'pair:confirm',      // 配对确认
  PAIR_REJECT      = 'pair:reject',       // 配对拒绝

  // 对话同步
  SESSION_CREATED   = 'session:created',   // 新建会话
  SESSION_UPDATED   = 'session:updated',   // 会话更新（标题等）
  SESSION_DELETED   = 'session:deleted',   // 会话删除
  MESSAGE_NEW       = 'message:new',       // 新消息
  MESSAGE_UPDATED   = 'message:updated',   // 消息更新（流式完成）

  // 控制命令
  CMD_SEARCH        = 'cmd:search',        // 触发搜索
  CMD_HOTSPOT       = 'cmd:hotspot',       // 查询热点
  CMD_MEMORY        = 'cmd:memory',        // 记忆管理
  CMD_SKILL         = 'cmd:skill',         // Skill 管理
  CMD_STATUS        = 'cmd:status',        // 查询桌面端状态

  // 文件传输
  FILE_OFFER        = 'file:offer',        // 文件传输提议
  FILE_ACCEPT       = 'file:accept',       // 接受传输
  FILE_DATA         = 'file:data',         // 文件数据块
  FILE_COMPLETE     = 'file:complete',     // 传输完成

  // 系统
  HEARTBEAT         = 'sys:heartbeat',     // 心跳
  DEVICE_ONLINE     = 'sys:online',        // 设备上线
  DEVICE_OFFLINE    = 'sys:offline',       // 设备离线
}
```

#### 4.2 配对流程

```
手机端                        中继服务器                      桌面端
  │                              │                             │
  │── 生成配对码(6位) ──────────►│                             │
  │                              │── 推送配对请求 ────────────►│
  │                              │                             │── 显示配对确认对话框
  │                              │◄────── 确认/拒绝 ──────────│
  │◄── 配对结果 ────────────────│                             │
  │                              │                             │
  │  [配对成功] 双方交换设备 Token，后续通过中继通信             │
```

### 五、分阶段实施计划

#### Phase 0：基础设施准备（Week 1-2）

**Desktop 端**：
1. 修复 P0 Bug（1.1 ~ 1.5）
2. 安全加固（2.1 ~ 2.3）
3. 实现 `electron-safeStorage` 加密 API Key

**Relay Server**：
1. 搭建项目骨架（Node.js + TypeScript）
2. WebSocket 网关 + 心跳保活
3. 设备注册 + JWT 认证
4. Docker Compose 部署（Redis + PostgreSQL）

**Mobile 端**：
1. Android 项目初始化（Kotlin + Compose + Material 3）
2. iOS 项目初始化（Swift + SwiftUI）
3. 基础 UI 框架搭建（导航/主题/暗色模式）

#### Phase 1：独立客户端 MVP（Week 3-5）

**目标**：手机端可独立使用 DeepSeek API 对话。

**Android/iOS**：
1. DeepSeek API 直连（SSE 流式）
2. 对话界面（消息列表 + 输入框 + Markdown 渲染）
3. 会话管理（创建/删除/切换/重命名）
4. 设置页面（API Key/模型/主题）
5. 本地持久化（Room / SwiftData）

**Desktop 端**：无变更

#### Phase 2：设备配对 + 消息同步（Week 6-8）

**目标**：手机与桌面端配对，会话双向同步。

**Relay Server**：
1. 配对流程（6位码 + 确认）
2. 消息路由 + 转发
3. 离线消息队列（Redis List）
4. 会话增量同步协议

**Desktop 端**：
1. `electron/relay/server.ts` — WebSocket 客户端连接中继
2. `electron/relay/sync.ts` — 本地变更监听 + 增量推送
3. `electron/relay/auth.ts` — 配对确认 UI
4. 设置页增加"手机连接"配置区

**Android/iOS**：
1. 配对界面（输入配对码 / 扫码配对）
2. `RelayClient` WebSocket 连接管理
3. 会话同步引擎（增量 merge）
4. 远程对话（在手机上继续桌面端对话）

#### Phase 3：控制面板 + 消息中转（Week 9-11）

**目标**：手机可远程控制桌面端，并实现文件中转。

**控制面板功能**：
1. 远程搜索 — 手机端输入关键词 → 桌面端执行 Web 搜索 → 返回结果
2. 热点查看 — 拉取桌面端本地热点聚合数据
3. 记忆管理 — 查看/编辑/删除桌面端记忆条目
4. Skill 管理 — 查看/启用/禁用 Skill
5. 状态监控 — 查看桌面端在线状态、当前会话数、Token 用量

**消息中转功能**：
1. 文字中转 — 手机端选中文字 → 发送到桌面端当前对话
2. 图片中转 — 手机拍照/选图 → 传输到桌面端（供后续多模态使用）
3. 文件中转 — 手机选文件 → 分块传输到桌面端 → 自动解析注入对话
4. 剪贴板同步 — 手机端复制 → 桌面端粘贴（可选）

**Relay Server**：
1. 控制命令转发 + 响应路由
2. 文件传输中继（分块，单文件 ≤ 20MB）
3. 传输进度追踪

#### Phase 4：打磨 + 高级功能（Week 12-14）

1. 推送通知（FCM / APNs）— 桌面端新消息/配对请求通知
2. 端到端加密（E2EE）— 敏感消息加密传输
3. 多设备管理 — 一个桌面端可配对多台手机，权限分级
4. 离线模式增强 — 手机端离线编辑 → 上线后自动合并
5. Widget / 快捷操作 — Android Widget / iOS Widget / 快捷指令
6. 性能优化 — 消息分页加载、图片压缩、WebSocket 压缩

### 六、技术难点 & 应对策略

| 难点 | 影响 | 应对 |
|------|------|------|
| WebSocket 断线重连 | 消息丢失 | 指数退避重连 + 消息序列号 + 离线队列补发 |
| 会话冲突合并 | 两端同时编辑同一会话 | 基于时间戳的 Last-Write-Wins + 冲突提示 |
| 文件传输可靠性 | 大文件传输中断 | 分块传输 + 断点续传 + MD5 校验 |
| 推送到达率 | Android 后台限制 | FCM + 厂商通道（小米/华为/OPPO） |
| 原生 Markdown 渲染 | 两端重复实现 | 抽取共享 Markdown 渲染规范，各端原生实现 |
| 中继服务器成本 | 长期运维费用 | 轻量部署（单 VPS）+ 按量付费 + 可选自建 |
| 双端同步开发 | 开发周期长 | 先完成 Android → 移植 iOS，共享协议和逻辑 |
| 数据安全 | 中继服务器看到明文 | Phase 4 引入 E2EE（Signal Protocol 简化版） |

### 七、成本预估

| 项目 | 费用/月 | 说明 |
|------|---------|------|
| 中继服务器 VPS | ¥50-100 | 2C4G，国内/香港节点 |
| Redis + PostgreSQL | 含在 VPS 内 | Docker 自建 |
| 域名 + SSL | ¥5-10 | Let's Encrypt 免费证书 |
| Google Play 开发者 | ¥175（一次性） | 发布 Android 应用 |
| Apple Developer | ¥688/年 | 发布 iOS 应用 |
| FCM 推送 | 免费 | Google 免费额度充足 |
| APNs 推送 | 含在开发者费内 | Apple 免费 |

**总计**：约 ¥100-150/月 + ¥863 年费（一次性 + Apple 开发者）

### 八、里程碑总览

| 阶段 | 时间 | 交付物 |
|------|------|--------|
| Phase 0 | Week 1-2 | Bug 修复 + 安全加固 + 基础设施搭建 |
| Phase 1 | Week 3-5 | Android/iOS 独立客户端 MVP |
| Phase 2 | Week 6-8 | 设备配对 + 会话双向同步 |
| Phase 3 | Week 9-11 | 控制面板 + 消息/文件中转 |
| Phase 4 | Week 12-14 | 推送 + E2EE + 多设备 + 打磨 |
| 发布 | Week 15-16 | 内测 → Google Play / App Store 提审 |

---

## 附录：现有功能优化优先级速查

| 优先级 | 编号 | 优化项 | 工作量 |
|--------|------|--------|--------|
| P0 | 1.1 | 会话数据 localStorage 溢出 | 2h |
| P0 | 1.2 | 错误消息写入错误会话 | 1h |
| P0 | 1.3 | retryMessage 丢失附件 | 0.5h |
| P0 | 1.4 | DSL 解析器死代码 | 0.5h |
| P0 | 1.5 | HTTP 重定向无限递归 | 0.5h |
| P0 | 2.1 | API Key 存储安全 | 3h |
| P0 | 2.2 | XSS 风险修复 | 2h |
| P0 | 2.3 | 路径白名单检查 | 0.5h |
| P1 | 3.1 | 持久化方案升级 IndexedDB | 8h |
| P1 | 3.2 | useMemory.ts 拆分 | 4h |
| P1 | 3.3 | 搜索性能优化 | 4h |
| P1 | 3.4 | 统计聚合优化 | 3h |
| P1 | 3.5 | Token 计数精确化 | 2h |
| P1 | 4.1 | 对话搜索功能 | 4h |
| P1 | 4.2 | 会话管理增强 | 6h |
| P1 | 4.3 | 消息编辑功能 | 3h |
| P1 | 4.4 | API 连接测试 | 1h |
| P1 | 4.5 | 自动更新 | 3h |
| P1 | 4.6 | 系统托盘 | 2h |
| P1 | 4.7 | MCP 工具桥接 | 8h |
| P1 | 4.8 | 首次启动引导 | 2h |
| P2 | 5.1 | 记忆透明度 | 2h |
| P2 | 5.2 | Skill 执行进度 | 2h |
| P2 | 5.3 | 深色模式跟随系统 | 1h |
| P2 | 5.4 | 统计数据展示优化 | 2h |
| P2 | 5.5 | 错误重试机制 | 2h |
