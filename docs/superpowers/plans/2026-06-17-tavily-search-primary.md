# Tavily Primary Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Tavily 接入为 `web_search` 的优先搜索源，未配置或失败时自动回退现有 Bing/DDG，并通过设置页 + safeStorage 管理 Tavily API key。

**Architecture:** 新增独立 `electron/search/tavily.ts`，负责 Tavily key 注入、API 调用、结果映射和 fallback 包装。`web-search.ts` 默认搜索依赖改为 `searchTavilyThenFallback`，保留现有 query 扩展、过滤、排序和包装。设置页、Pinia settings store 与 `main.ts` 复用已有知乎 token/safeStorage 模式接入 `ds_tavily_api_key`。

**Tech Stack:** TypeScript, Electron main process, Vue 3/Pinia, Electron `safeStorage`, native `fetch`, existing hand-written `tsx` tests.

---

## File Structure

- Create: `electron/search/tavily.ts`
  - Owns Tavily API key in module memory.
  - Exposes `setTavilyApiKey`, `searchTavilyLight`, `searchTavilyThenFallback`.
  - Converts Tavily `results[]` into existing `SearchHit`.
  - Does not import Electron APIs, so tests can import it under `tsx`.

- Create: `tests/tavily-search.test.ts`
  - Pure unit tests for Tavily module.
  - Stubs `globalThis.fetch` and restores it.
  - Does not call real Tavily API.

- Modify: `electron/tools/builtins/web-search.ts`
  - Import `searchTavilyThenFallback`.
  - Default `deps.search` changes from `searchWebLight` to `searchTavilyThenFallback`.
  - Keep `searchWebLight` import only if still needed by fallback tests; otherwise remove unused import.

- Modify: `tests/run-all.ts`
  - Add `tavily-search.test.ts` to suites.

- Modify: `src/stores/settings.ts`
  - Add `tavilyApiKey` ref, load, persist, clear, return.
  - Use secure key `ds_tavily_api_key`.

- Modify: `src/views/SettingsView.vue`
  - Add “Tavily API Key” input near other sensitive search/tool tokens.
  - Use existing `settings.showKey` for password/text toggle.

- Modify: `electron/main.ts`
  - Import `setTavilyApiKey` from `./search/tavily`.
  - In `app.whenReady()`, read `ds_tavily_api_key` via `readSecret()` and inject.

---

## Task 1: Tavily Module — RED Tests

**Files:**
- Create: `tests/tavily-search.test.ts`
- Later Create: `electron/search/tavily.ts`

- [ ] **Step 1: Write failing Tavily unit tests**

Create `tests/tavily-search.test.ts` with this content:

```ts
/**
 * Tavily 搜索模块测试（离线，不调用真实 Tavily API）。
 * 用法：npx tsx tests/tavily-search.test.ts
 */
import {
  setTavilyApiKey,
  searchTavilyLight,
  searchTavilyThenFallback,
} from '../electron/search/tavily'
import type { SearchHit } from '../electron/search/duckduckgo'

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, cond: unknown, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

const originalFetch = globalThis.fetch
let fetchCalls = 0

function setFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  fetchCalls = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls++
    return handler(input, init)
  }) as typeof fetch
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

console.log('\n[1] searchTavilyLight — no key')
{
  setTavilyApiKey('')
  setFetch(async () => jsonResponse({ results: [] }))
  const hits = await searchTavilyLight('黄仁勋 女儿 订婚')
  check('无 key 返回空数组', Array.isArray(hits) && hits.length === 0)
  check('无 key 不调用 fetch', fetchCalls === 0, `fetchCalls=${fetchCalls}`)
}

console.log('\n[2] searchTavilyLight — success mapping')
{
  setTavilyApiKey('tvly-test')
  setFetch(async (input, init) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    const body = JSON.parse(String(init?.body))
    check('调用 Tavily endpoint', url === 'https://api.tavily.com/search', url)
    check('使用 Bearer token', headers.get('Authorization') === 'Bearer tvly-test')
    check('请求体含 query', body.query === 'Elon Musk Twitter acquisition price')
    check('默认 max_results=8', body.max_results === 8)
    check('默认 search_depth=basic', body.search_depth === 'basic')
    check('默认不请求 answer', body.include_answer === false)
    check('默认不请求 raw content', body.include_raw_content === false)
    return jsonResponse({
      results: [
        { title: 'Elon Musk completes Twitter acquisition', url: 'https://example.com/musk-twitter', content: 'Musk bought Twitter for $44 billion.', score: 0.9 },
      ],
    })
  })
  const hits = await searchTavilyLight('Elon Musk Twitter acquisition price')
  check('映射 title', hits[0]?.title === 'Elon Musk completes Twitter acquisition')
  check('映射 url', hits[0]?.url === 'https://example.com/musk-twitter')
  check('映射 content→snippet', hits[0]?.snippet === 'Musk bought Twitter for $44 billion.')
}

console.log('\n[3] searchTavilyLight — error handling')
{
  setTavilyApiKey('tvly-test')
  setFetch(async () => jsonResponse({ error: 'bad' }, 500))
  const httpFail = await searchTavilyLight('x')
  check('HTTP 非 2xx 返回空', httpFail.length === 0)

  setFetch(async () => jsonResponse({ nope: [] }))
  const badShape = await searchTavilyLight('x')
  check('results 缺失返回空', badShape.length === 0)

  setFetch(async () => { throw new Error('network down') })
  const networkFail = await searchTavilyLight('x')
  check('网络错误返回空', networkFail.length === 0)
}

console.log('\n[4] searchTavilyThenFallback — priority/fallback')
{
  setTavilyApiKey('tvly-test')
  setFetch(async () => jsonResponse({
    results: [{ title: 'Tavily hit', url: 'https://tavily.example', content: 'from tavily' }],
  }))
  const fallback = async (): Promise<SearchHit[]> => [{ title: 'Fallback hit', url: 'https://fallback.example', snippet: 'from fallback' }]
  const tavilyHits = await searchTavilyThenFallback('q', fallback)
  check('Tavily 有结果时优先 Tavily', tavilyHits[0]?.title === 'Tavily hit')

  setFetch(async () => jsonResponse({ results: [] }))
  const fallbackHits = await searchTavilyThenFallback('q', fallback)
  check('Tavily 空结果时回退 fallback', fallbackHits[0]?.title === 'Fallback hit')
}

globalThis.fetch = originalFetch
setTavilyApiKey('')

console.log(`\n${failed === 0 ? '✓' : '✗'} ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\n失败项：')
  failures.forEach(f => console.log('  - ' + f))
}
process.exit(failed > 0 ? 1 : 0)
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx tsx tests/tavily-search.test.ts
```

Expected: FAIL with module-not-found for `../electron/search/tavily`, because production module does not exist yet.

---

## Task 2: Tavily Module — GREEN Implementation

**Files:**
- Create: `electron/search/tavily.ts`
- Test: `tests/tavily-search.test.ts`

- [ ] **Step 1: Create minimal Tavily module**

Create `electron/search/tavily.ts`:

```ts
import { searchWebLight, type SearchHit } from './duckduckgo'

const TAVILY_URL = 'https://api.tavily.com/search'
let tavilyApiKey = ''

export interface TavilySearchOptions {
  maxResults?: number
  searchDepth?: 'basic' | 'advanced' | 'fast' | 'ultra-fast'
}

interface TavilyResult {
  title?: unknown
  url?: unknown
  content?: unknown
}

interface TavilyResponse {
  results?: TavilyResult[]
}

export function setTavilyApiKey(key: string): void {
  tavilyApiKey = key.trim()
}

function toHit(r: TavilyResult): SearchHit | null {
  if (typeof r.title !== 'string' || typeof r.url !== 'string') return null
  const snippet = typeof r.content === 'string' ? r.content : ''
  if (!r.title.trim() || !r.url.trim()) return null
  return { title: r.title.trim(), url: r.url.trim(), snippet: snippet.trim() }
}

export async function searchTavilyLight(query: string, opts: TavilySearchOptions = {}): Promise<SearchHit[]> {
  if (!tavilyApiKey) return []
  const q = query.trim()
  if (!q) return []

  try {
    const resp = await fetch(TAVILY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tavilyApiKey}`,
      },
      body: JSON.stringify({
        query: q,
        search_depth: opts.searchDepth ?? 'basic',
        max_results: opts.maxResults ?? 8,
        include_answer: false,
        include_raw_content: false,
      }),
    })

    if (!resp.ok) {
      const err = await resp.text().catch(() => '')
      console.warn(`[tavily] HTTP ${resp.status}: ${err.slice(0, 200)}`)
      return []
    }

    const data = await resp.json() as TavilyResponse
    if (!Array.isArray(data.results)) return []
    return data.results.map(toHit).filter((h): h is SearchHit => h !== null)
  } catch (e) {
    console.warn('[tavily] 调用失败:', e instanceof Error ? e.message : e)
    return []
  }
}

export async function searchTavilyThenFallback(
  query: string,
  fallback: (q: string) => Promise<SearchHit[]> = searchWebLight,
): Promise<SearchHit[]> {
  const tavilyHits = await searchTavilyLight(query)
  if (tavilyHits.length > 0) return tavilyHits
  return fallback(query)
}
```

- [ ] **Step 2: Run Tavily test to verify pass**

Run:

```bash
npx tsx tests/tavily-search.test.ts
```

Expected: PASS, output ends with `✓ ... passed, 0 failed`.

- [ ] **Step 3: Add Tavily test suite to run-all**

Modify `tests/run-all.ts`. In the `suites` array, add `tavily-search.test.ts` after `web-search-e2e.test.ts`:

```ts
const suites = [
  'skills-frontmatter.test.ts',
  'path-safety.test.ts',
  'clawhub-installer.test.ts',
  'skill-runtime.test.ts',
  'mode-policy.test.ts',
  'web-search-units.test.ts',
  'web-search-e2e.test.ts',
  'tavily-search.test.ts',
  'markdown-math.test.ts',
  'assistant-chat.test.ts',
]
```

- [ ] **Step 4: Run all tests**

Run:

```bash
npm test
```

Expected: all suites pass. The final line should be `✓ 全部 10 个套件通过` after adding the new suite.

- [ ] **Step 5: Commit Tavily module and tests**

Run:

```bash
git add electron/search/tavily.ts tests/tavily-search.test.ts tests/run-all.ts
git commit -m "feat(search): add Tavily search module"
```

---

## Task 3: Make web_search Use Tavily First

**Files:**
- Modify: `electron/tools/builtins/web-search.ts`
- Test: `tests/tavily-search.test.ts`, `tests/web-search-e2e.test.ts`

- [ ] **Step 1: Write failing test for default search dependency if needed**

The direct priority/fallback behavior is already covered by `tests/tavily-search.test.ts` in Task 1. Do not add a brittle test that reaches into `runWebSearch` internals. This task only wires the default dependency.

- [ ] **Step 2: Change default dependency in web-search.ts**

Modify imports at the top of `electron/tools/builtins/web-search.ts`:

Replace:

```ts
import { searchWebLight, type SearchHit } from '../../search/duckduckgo'
```

With:

```ts
import type { SearchHit } from '../../search/duckduckgo'
import { searchTavilyThenFallback } from '../../search/tavily'
```

Then change the default deps in `runWebSearch`:

Replace:

```ts
  deps: SearchDeps = { search: searchWebLight, zhihu: searchAll },
```

With:

```ts
  deps: SearchDeps = { search: searchTavilyThenFallback, zhihu: searchAll },
```

- [ ] **Step 3: Run relevant tests**

Run:

```bash
npx tsx tests/web-search-e2e.test.ts
npx tsx tests/tavily-search.test.ts
```

Expected: both pass. `web-search-e2e` uses injected fake search and should not call real Tavily.

- [ ] **Step 4: Run benchmark selftest**

Run:

```bash
npm run bench:selftest
```

Expected: pass. With no Tavily key injected, Tavily returns empty and fallback path should preserve existing behavior.

- [ ] **Step 5: Commit web_search Tavily wiring**

Run:

```bash
git add electron/tools/builtins/web-search.ts
git commit -m "feat(search): use Tavily before HTML search"
```

---

## Task 4: Store and Inject Tavily API Key

**Files:**
- Modify: `src/stores/settings.ts`
- Modify: `src/views/SettingsView.vue`
- Modify: `electron/main.ts`
- Test: `npx vue-tsc --noEmit`, `npm test`

- [ ] **Step 1: Add Tavily key to settings store**

In `src/stores/settings.ts`, near existing `mimoApiKey` and `zhihuToken`, add:

```ts
  // Tavily 搜索 API key（web_search 主搜索源）；同样走 safeStorage 加密
  const tavilyApiKey = ref('')
```

In `loadSecrets()` secure-storage branch, change:

```ts
          apiKey.value = await api.secureGet('ds_api_key')
          mimoApiKey.value = await api.secureGet('ds_mimo_api_key')
          zhihuToken.value = await api.secureGet('ds_zhihu_token')
```

To:

```ts
          apiKey.value = await api.secureGet('ds_api_key')
          mimoApiKey.value = await api.secureGet('ds_mimo_api_key')
          zhihuToken.value = await api.secureGet('ds_zhihu_token')
          tavilyApiKey.value = await api.secureGet('ds_tavily_api_key')
```

In both localStorage fallback branches, after `zhihuToken.value = ...`, add:

```ts
        tavilyApiKey.value = localStorage.getItem('ds_tavily_api_key') ?? ''
```

or with matching indentation in the browser branch:

```ts
      tavilyApiKey.value = localStorage.getItem('ds_tavily_api_key') ?? ''
```

After the existing watchers:

```ts
  watch(zhihuToken, (val) => { persistSecret('ds_zhihu_token', val) })
```

Add:

```ts
  watch(tavilyApiKey, (val) => { persistSecret('ds_tavily_api_key', val) })
```

In `clearAllData()`, after deleting `ds_zhihu_token`, add:

```ts
        await api.secureDelete('ds_tavily_api_key')
```

After `zhihuToken.value = ''`, add:

```ts
    tavilyApiKey.value = ''
```

In returned object, add `tavilyApiKey` next to `zhihuToken`:

```ts
    apiKey, defaultModel, fontSize, fontFamily, codeTheme, systemPrompt, showKey, mimoApiKey, mimoBaseUrl, mimoModel, zhihuToken, tavilyApiKey, models, codeThemes, fontOptions, promptTemplates, activeRoleId, selectRole, secureStorageAvailable, secretsReady,
```

- [ ] **Step 2: Add Tavily input to SettingsView**

In `src/views/SettingsView.vue`, below the “知乎搜索 Token” section, add:

```vue
        <!-- Tavily API Key -->
        <section class="pt-6 border-t border-app-border/30">
          <label class="text-xs font-medium text-app-muted mb-1 block">Tavily API Key</label>
          <p class="text-xs text-app-muted/60 mb-3">用于 web_search 的主搜索源；留空则自动回退现有 Bing/DDG 搜索。修改后重启生效。</p>
          <input
            :type="settings.showKey ? 'text' : 'password'"
            :value="settings.tavilyApiKey"
            @input="settings.tavilyApiKey = ($event.target as HTMLInputElement).value"
            placeholder="tvly-...（可选）"
            class="w-full px-3.5 py-2.5 text-sm border border-app-border/50 rounded-lg bg-transparent text-app-text placeholder:text-app-muted/50 focus:outline-none focus:border-app-text/60 transition-colors font-mono"
          />
        </section>
```

- [ ] **Step 3: Inject Tavily key in Electron main**

In `electron/main.ts`, add import:

```ts
import { setTavilyApiKey } from './search/tavily'
```

In `app.whenReady().then(() => { ... })`, after the existing Zhihu token injection:

```ts
  const _tavilyApiKey = readSecret('ds_tavily_api_key')
  setTavilyApiKey(_tavilyApiKey)
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
npx vue-tsc --noEmit
```

Expected: exit 0, no TypeScript errors.

- [ ] **Step 5: Run tests**

Run:

```bash
npm test
```

Expected: all suites pass.

- [ ] **Step 6: Commit settings and injection**

Run:

```bash
git add src/stores/settings.ts src/views/SettingsView.vue electron/main.ts
git commit -m "feat(search): configure Tavily API key securely"
```

---

## Task 5: Final Verification and Manual Test Instructions

**Files:**
- No production changes expected.
- May update docs only if needed.

- [ ] **Step 1: Run complete automated verification**

Run:

```bash
npm test
npm run bench:selftest
npx vue-tsc --noEmit
```

Expected:

- `npm test`: all suites pass.
- `bench:selftest`: `✓ 自检全部通过`.
- `vue-tsc`: exit 0.

- [ ] **Step 2: Verify no Tavily key is committed**

Run:

```bash
grep -RIn "tvly-" electron src tests docs package.json 2>/dev/null || true
```

Expected: no output. If docs mention placeholder `tvly-...`, that is acceptable only in UI placeholder/documentation, not an actual key. Check manually that no real key appears.

- [ ] **Step 3: Provide manual test command to user**

Tell the user:

```text
在设置页填写 Tavily API Key 后重启应用，再用 web_search 测试：
- 黄仁勋 女儿 订婚
- 马斯克 推特 收购 价格
- 比特币 价格 今日

如果想用 benchmark 对比，先确认 Tavily key 已配置，再运行：
npm run bench:search
注意：这会消耗 Tavily 额度。
```

- [ ] **Step 4: Commit any verification doc updates if made**

If no docs changed, skip commit. If docs changed, run:

```bash
git add docs/path-you-edited.md
git commit -m "docs(search): add Tavily manual verification notes"
```

---

## Self-Review

- Spec coverage:
  - Tavily priority source: Task 2 + Task 3.
  - Fallback to Bing/DDG: Task 2 `searchTavilyThenFallback` test and implementation.
  - safeStorage setting: Task 4.
  - existing filter/rank retained: Task 3 only changes default search dependency.
  - tests: Task 1, Task 2, Task 3, Task 5.
- Placeholder scan: no TBD/TODO/“implement later” placeholders remain.
- Type consistency:
  - `setTavilyApiKey`, `searchTavilyLight`, `searchTavilyThenFallback` names are consistent across tests, module, and `main.ts`.
  - secure key is consistently `ds_tavily_api_key`.
  - settings field is consistently `tavilyApiKey`.
