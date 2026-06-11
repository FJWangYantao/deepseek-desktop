# Step 2：IndexedDB 大对象迁移与 useMemory 拆分设计

## 背景

当前项目的大体量用户数据仍主要存放在 `localStorage`：

- 会话与全部消息：`src/stores/session.ts` 使用 `ds_sessions`
- 记忆系统：`src/composables/useMemory.ts` 使用 `ds_memory`

`localStorage` 容量通常约 5MB，且 `session.ts` 通过 deep watch 全量序列化会话数据，长期使用会触发容量上限和写放大问题。API Key 已在前序 P0 中迁移到 Electron `safeStorage`，但非敏感大对象仍需要迁移。

本阶段目标是：

1. 将 **会话/消息** 与 **记忆系统** 迁移到 IndexedDB。
2. 保持现有业务 API 尽量不变，降低回归风险。
3. 拆分 893 行的 `useMemory.ts`，把持久化、提取、Dreaming、检索等职责分离。
4. 为后续对话搜索、会话管理增强、手机端同步打基础。

## 范围

### 本阶段包含

- 迁移 `ds_sessions` 到 IndexedDB。
- 迁移 `ds_current_session` 到 IndexedDB。
- 迁移 `ds_memory` 到 IndexedDB。
- 启动时从旧 localStorage 自动迁移到 IndexedDB，并删除旧 key。
- 改造 `clearAllData()`，确保 IndexedDB 中的大对象也会被清空。
- 拆分 `src/composables/useMemory.ts` 为多个职责清晰的模块。
- 保留 `src/composables/useMemory.ts` 作为兼容 re-export，避免大范围修改引用。

### 本阶段不包含

- settings/theme/stats 的 IndexedDB 迁移。
- 会话分页加载。
- 全文搜索索引。
- 手机端同步协议。
- 新增测试框架。

这些后续可以在 IndexedDB 基础层稳定后单独推进。

## 推荐方案

采用“只迁大对象”的渐进式方案：

- `sessions`、`currentSessionId`、`memoryStore` 放入 IndexedDB。
- settings、theme、stats 继续使用 localStorage。
- API Key 继续使用 Electron `safeStorage`。

理由：

- 解决最主要的容量风险和写放大风险。
- 改动集中在 `session.ts`、`useMemory.ts` 及其拆分模块。
- 避免 settings/theme/stats 全部异步化导致大范围回归。

## IndexedDB 基础层

新增：

```text
src/storage/idb.ts
```

职责：

- 打开数据库 `deepseek-desktop`。
- 使用一个通用 object store：`kv`。
- 提供类型化 KV API：
  - `idbGet<T>(key: string): Promise<T | null>`
  - `idbSet<T>(key: string, value: T): Promise<void>`
  - `idbRemove(key: string): Promise<void>`
  - `idbClearKnownKeys(keys: string[]): Promise<void>`

依赖选择：`idb-keyval`。

原因：当前只需要 key-value 存取，不需要 Dexie 级别的索引查询能力。若后续做全文搜索或分页，再升级 schema。

建议定义统一 key 常量：

```ts
export const IDB_KEYS = {
  sessions: 'sessions',
  currentSessionId: 'currentSessionId',
  memoryStore: 'memoryStore',
} as const
```

## 会话存储设计

修改：

```text
src/stores/session.ts
```

### 启动流程

1. store 创建时 `sessions` 先为空数组，`currentId` 先为空。
2. 调用 `hydrate()` 异步加载 IndexedDB。
3. 若 IndexedDB 中存在 `sessions`，使用 IndexedDB 数据。
4. 若 IndexedDB 中没有 `sessions`，读取旧 localStorage：
   - `ds_sessions`
   - `ds_current_session`
5. 迁移成功后：
   - 写入 IndexedDB。
   - 删除旧 localStorage key。
6. 设置 `hydrated = true`。

### 写入流程

- `watch(sessions, ..., { deep: true })` 仍保留，但写入目标改为 IndexedDB。
- watcher 在 `hydrated` 为 false 时直接返回，避免初始化时空数组覆盖旧数据。
- `currentId` watcher 同理写入 IndexedDB。

### 对外 API

保持现有函数名不变：

- `createSession`
- `switchSession`
- `deleteSession`
- `updateSessionTitle`
- `getCurrentSession`
- `ensureSession`

新增可选状态：

- `hydrated`：用于 UI 或调试判断会话是否完成加载。

现有 `chat.ts` 尽量不改，继续通过 `sessionStore.sessions` 与 `sessionStore.currentId` 工作。

## 记忆系统拆分设计

现有 `src/composables/useMemory.ts` 承担持久化、提取、Dreaming、检索、统计、导入导出等多重职责，文件过大。拆分为：

```text
src/composables/memory/
  index.ts              # 对外导出 useMemory()
  memory-store.ts       # store、持久化、CRUD、import/export/clear
  memory-search.ts      # tokenCount、相关度、上下文构建、搜索、统计查询
  memory-extractor.ts   # EXTRACTION_PROMPT、extractFromExchange、parseExtraction
  memory-dreamer.ts     # DREAM_PROMPT、dream/dryRun/approve/reject/status
  memory-utils.ts       # genId、keywords、jaccard 等纯工具函数
```

兼容层：

```text
src/composables/useMemory.ts
```

改为：

```ts
export { useMemory } from './memory'
```

这样现有调用方不需要在本阶段改 import 路径。

### memory-store.ts

职责：

- 定义/持有模块级 `store = ref<MemoryStore>()`。
- `hydrateMemoryStore()`：从 IndexedDB 或旧 localStorage 加载。
- `saveStore()`：写入 IndexedDB。
- `mergeMemories()`。
- `updateItem()`、`deleteItem()`、`togglePin()`。
- `exportData()`、`importFromJSON()`、`selectiveClear()`、`clearAll()`。
- `downloadFile()` 如仍被导出/导入逻辑使用，可留在此模块或拆到 utils。

### memory-search.ts

职责：

- `tokenCount()`。
- `extractKeywords()`。
- `relevance()`。
- `buildMemoryContext()`。
- `searchItems()`。
- `getGrowthData()`、`getLayerDistribution()`、`getTopAccessed()`、`getDreamTimeline()`。

只依赖 memory-store 暴露的 store/ref，不直接关心 IndexedDB 实现。

### memory-extractor.ts

职责：

- `EXTRACTION_PROMPT`。
- `extractFromExchange()`。
- `parseExtraction()`。

依赖：

- `mergeMemories()` / `saveStore()`。
- DeepSeek API 调用所需的 settings。

### memory-dreamer.ts

职责：

- `DREAM_PROMPT`。
- `_runDream()`。
- `dream()`。
- `dreamDryRun()`。
- `approveDream()`。
- `rejectDream()`。
- `getDreamStatus()`。
- `checkAutoDream()`。
- `promoteShortTerm()` 如它和 Dreaming 时机强相关，也可放在此模块；若更偏 CRUD，可放 `memory-store.ts`。

## 记忆迁移流程

1. `hydrateMemoryStore()` 先读 IndexedDB 的 `memoryStore`。
2. 如果没有，再读旧 localStorage 的 `ds_memory`。
3. 若旧 localStorage 有有效数据：
   - 写入 IndexedDB。
   - 删除 `ds_memory`。
4. 如果都没有，使用默认空 store。
5. 初始化完成前，`saveStore()` 不写入，避免空 store 覆盖旧数据。

## clearAllData 适配

新增：

```text
src/storage/app-data.ts
```

职责：

- `clearLargeStores()`：清除 `sessions`、`currentSessionId`、`memoryStore`。

修改：

```text
src/stores/settings.ts
```

`clearAllData()` 在 `localStorage.clear()` 和 safeStorage 删除之外，还要调用 `clearLargeStores()`。

注意：`clearAllData()` 当前是 async，保留 async 形式。

## 错误处理

- IndexedDB 读取失败：回退到旧 localStorage 数据；若仍失败，使用空数据并在 console 输出警告。
- IndexedDB 写入失败：不阻塞 UI，但 console 警告，避免静默吞掉。
- 迁移后删除旧 localStorage 失败：不影响主流程，下次启动仍会优先读 IndexedDB。
- 数据 JSON 解析失败：使用默认空数据，不崩溃。

## 验证方案

### 构建验证

```bash
npm run build
```

### 手动迁移验证

1. 在旧 localStorage 中保留：
   - `ds_sessions`
   - `ds_current_session`
   - `ds_memory`
2. 启动新版本。
3. 确认会话、消息、记忆仍可见。
4. DevTools 中确认旧 key 已删除。
5. 重启应用，确认数据仍存在。

### 写入验证

1. 新建会话并发送消息。
2. 重启应用，消息仍存在。
3. 新增/编辑/删除记忆。
4. 重启应用，记忆变更仍存在。

### 清空验证

1. 调用设置页“清空全部数据”。
2. 重启应用。
3. 会话列表为空或回到默认空会话状态。
4. 记忆列表为空。
5. API Key 被清空。

## 风险与缓解

### 风险：Pinia store 初始化变异步

缓解：保留同步空初始值，加 `hydrated` 标志，并在 watcher 中跳过初始化阶段写入。

### 风险：chat.ts 在 session hydrate 前读取空会话

缓解：`session.ts` 继续提供 `ensureSession()`，hydrate 完成后再恢复 `currentId`；必要时在 App 启动处或 chat store 初始化处观察 `hydrated`。

### 风险：拆分 useMemory 引入循环依赖

缓解：

- `memory-store.ts` 是底层，只依赖类型和 IndexedDB。
- `memory-search.ts` 可依赖 `memory-store.ts`。
- `memory-extractor.ts` 和 `memory-dreamer.ts` 依赖 store/search/utils，但 store 不反向依赖它们。
- `index.ts` 负责组合并暴露原来的 `useMemory()` 返回对象。

### 风险：IndexedDB 在隐私/异常环境中不可用

缓解：读写失败时保留 localStorage fallback，并输出 console warning。大多数 Electron Chromium 环境下 IndexedDB 可用。

## 成功标准

- `npm run build` 通过。
- 旧数据自动迁移且不丢失。
- 旧 localStorage 的 `ds_sessions` / `ds_current_session` / `ds_memory` 在迁移后被移除。
- 新增会话/消息/记忆可跨重启保留。
- `useMemory.ts` 变成薄 re-export，主体逻辑拆分到 `src/composables/memory/`。
- 现有 UI 和调用方无需大面积修改。
