# Tavily 作为主搜索源设计

日期：2026-06-17

## 背景

当前 `web_search` 的底层搜索主要依赖 `searchWebLight`（Bing/DDG HTML 抓取）和部分知乎摘要。近期 benchmark 与真实 tool 探针暴露出几个问题：

- 中文 entity 查询在 Bing/DDG 上容易被拆词，例如“黄仁勋”变成“黄”，“马斯克”变成“马”。
- 中文法规类 query 需要 tool 层 policy fallback 才能召回正确法规内容。
- HTML 抓取结果会有漂移、限流和解析维护成本。
- 已有 benchmark/replay 可以评估底层质量，但真实 `web_search` tool 层还需要稳定结构化来源。

用户希望接入 Tavily，并将其作为主要搜索来源，用于测试搜索质量。

## 目标

1. Tavily 成为 `web_search` 的优先搜索源。
2. 未配置 Tavily key、Tavily 请求失败或 Tavily 返回空时，自动回退现有 Bing/DDG 搜索，不让搜索功能失效。
3. Tavily API key 走设置页 + `safeStorage` 加密存储，不硬编码、不使用 env 作为桌面端主配置。
4. 保留现有 `filterResults`、`scoreAndRank`、tool-level quality filter 与 policy rerank。
5. 新增测试覆盖 Tavily 响应映射、fallback 行为和 tool 层主源选择。

## 非目标

- 不移除现有 Bing/DDG 搜索。
- 不接入 Tavily raw content、answer 或图片能力。
- 不在单元测试中调用真实 Tavily API。
- 不把 Tavily key 写入 git、localStorage 明文或默认配置。
- 不重写 benchmark 架构；第一版让 benchmark 在配置 key 时自然走 Tavily，否则回退旧源。

## Tavily API

Tavily Search API 使用：

- Endpoint：`POST https://api.tavily.com/search`
- Auth：`Authorization: Bearer <TAVILY_API_KEY>`
- Request body：至少包含 `query`
- 关键参数：`search_depth`、`max_results`、`topic`、`include_answer`、`include_raw_content`
- Response：`results[]` 包含 `title`、`url`、`content`、`score`

第一版默认请求：

```json
{
  "query": "...",
  "search_depth": "basic",
  "max_results": 8,
  "include_answer": false,
  "include_raw_content": false,
  "topic": "general"
}
```

对 `news` 类 query 可在后续扩展为 `topic: "news"`；第一版先保持简单，只实现 general。

## 架构

新增 `electron/search/tavily.ts`：

- `setTavilyApiKey(key: string): void`
- `searchTavilyLight(query: string, opts?: TavilySearchOptions): Promise<SearchHit[]>`
- `searchTavilyThenFallback(query: string): Promise<SearchHit[]>`

`searchTavilyLight` 负责：

1. 没有 key 时返回空数组。
2. 调用 Tavily `/search`。
3. 把 `results[]` 映射成现有 `SearchHit`：
   - `title = result.title`
   - `url = result.url`
   - `snippet = result.content`
4. HTTP 错误、网络错误或响应结构异常时返回空数组并打印 warning。

`searchTavilyThenFallback` 负责：

1. 调 Tavily。
2. 如果 Tavily 返回非空结果，直接返回。
3. 如果 Tavily 返回空或失败，调用现有 `searchWebLight(query)`。

`web-search.ts` 调整：

- 默认 `deps.search` 从 `searchWebLight` 改为 `searchTavilyThenFallback`。
- 测试仍可通过依赖注入传入 fake search，不受真实 Tavily 影响。
- `expandQueries`、merge、dedupe、filter、rank、quality filter、policy rerank 维持现状。

## 配置与安全

新增设置字段：

- `settings.tavilyApiKey`
- secure key：`ds_tavily_api_key`

改动点：

- `src/stores/settings.ts`
  - 新增 `tavilyApiKey` ref。
  - `loadSecrets()` 从 secure-storage 读取。
  - watch 后写入 secure-storage。
  - `clearAllData()` 删除。
- `src/views/SettingsView.vue`
  - 新增“Tavily API Key”输入框。
  - 使用现有 `showKey` 控制 password/text。
- `electron/main.ts`
  - `app.whenReady()` 后从 `readSecret('ds_tavily_api_key')` 读取并 `setTavilyApiKey()` 注入。

安全要求：

- 不硬编码 key。
- 不把 key 写入日志。
- 没有 key 时只回退旧搜索源，不报错打断工具调用。

## 数据流

```text
web_search.execute(args)
  → queryList
  → expandQueries(query)
  → preprocessQuery(variant)
  → searchTavilyThenFallback(processedQuery)
      → Tavily 有 key且有结果：返回 Tavily SearchHit[]
      → 否则：searchWebLight(processedQuery)
  → merge/dedupe
  → filterResults
  → scoreAndRank
  → quality filter + rerank
  → 格式化输出
```

## 错误处理

- Tavily 无 key：静默返回空，触发 fallback。
- Tavily HTTP 非 2xx：`console.warn('[tavily] HTTP ...')`，返回空，触发 fallback。
- Tavily 响应 JSON 解析失败：warning，返回空，触发 fallback。
- Tavily 返回空 `results`：返回空，触发 fallback。
- fallback 也失败：维持现有行为，返回空结果提示。

## 测试计划

### 单元测试：`tests/tavily-search.test.ts`

覆盖：

1. 没 key 时 `searchTavilyLight()` 返回空且不调用 fetch。
2. 有 key 且 Tavily 成功时，正确映射 `title/url/content → SearchHit`。
3. HTTP 失败时返回空。
4. 响应 results 缺失或格式错误时返回空。

实现方式：临时替换 `globalThis.fetch`，测试结束恢复。

### Tool 层测试：`tests/web-search-e2e.test.ts`

覆盖：

1. 默认 search 依赖仍可注入 fake search，不打真实网络。
2. 新增一条：Tavily fake 结果优先于 fallback fake 结果。
3. 新增一条：Tavily 空结果时使用 fallback。

如为避免重构过大，可在 `tavily-search.test.ts` 直接测试 `searchTavilyThenFallback` 的优先/fallback 行为。

### 集成验证

实现后运行：

```bash
npm test
npm run bench:selftest
npx vue-tsc --noEmit
```

用户手动填 Tavily key 后可运行：

```bash
npm run bench:search
```

观察 Tavily 主源下的 `gen-1/gen-2/news-5` 是否改善。

## 风险与取舍

- Tavily 需要 API key 和额度；未配置时回退旧搜索，避免不可用。
- Tavily 中文效果未知，需要实际 key 测试。
- Tavily 结果可能与现有 rank 口径不同，仍经过统一 filter/rank 以保持输出一致。
- benchmark 配置 key 后会打 Tavily API，可能产生额度消耗；不配置 key 则走旧源。

## 验收标准

1. 未配置 Tavily key 时，`web_search` 仍能使用旧搜索源。
2. 配置 Tavily key 后，默认优先使用 Tavily 结果。
3. Tavily key 在设置页可填写并加密保存。
4. `npm test`、`bench:selftest`、`vue-tsc --noEmit` 通过。
5. 真实测试时，Tavily 主源能返回结构化结果并进入现有排序/输出链路。
