# Step 2 Storage + Memory Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move large user data (`ds_sessions`, `ds_current_session`, `ds_memory`) from `localStorage` to IndexedDB and split the 893-line `useMemory.ts` into focused modules without changing existing UI imports.

**Architecture:** Add a small IndexedDB KV layer using `idb-keyval`, then migrate session and memory stores with localStorage fallback and one-time cleanup. Keep Pinia/composable public APIs stable; split memory internals into store/search/extractor/dreamer/utils modules and keep `src/composables/useMemory.ts` as a compatibility re-export.

**Tech Stack:** Vue 3, Pinia, TypeScript, Electron renderer, `idb-keyval`, existing `npm run build` validation.

---

## File Structure

### Create

- `src/storage/idb.ts` — IndexedDB KV wrapper and shared `IDB_KEYS` constants.
- `src/storage/app-data.ts` — app-level large-store clearing helper used by settings.
- `src/composables/memory/memory-utils.ts` — pure helpers: `generateId`, `tokenCount`, `extractKeywords`, `jaccardSimilarity`, `relevanceScore`, `significantTokenOverlap`.
- `src/composables/memory/memory-store.ts` — singleton memory store ref, IndexedDB/localStorage hydration, save, CRUD/import/export/clear/category/sort helpers.
- `src/composables/memory/memory-search.ts` — memory context construction, layer filtering, search, stats queries.
- `src/composables/memory/memory-extractor.ts` — extraction prompt, API extraction, parsing.
- `src/composables/memory/memory-dreamer.ts` — Dreaming prompt, dream run, preview approve/reject/status, auto dream, promotion.
- `src/composables/memory/index.ts` — composes and returns the existing `useMemory()` public API.

### Modify

- `package.json` / `package-lock.json` — add direct dependency `idb-keyval`.
- `src/stores/session.ts` — async IndexedDB hydrate, migration from legacy localStorage, IndexedDB persistence.
- `src/stores/settings.ts` — call `clearLargeStores()` from `clearAllData()`.
- `src/composables/useMemory.ts` — replace body with `export { useMemory } from './memory'`.

### Do Not Modify Unless Needed

- `src/stores/chat.ts` — should keep working through stable `sessionStore.sessions/currentId` API.
- UI components using `useMemory()` — imports should remain valid through the compatibility re-export.

---

## Task 1: Add IndexedDB KV Storage Layer

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/storage/idb.ts`

- [ ] **Step 1: Install direct dependency**

Run:

```bash
npm install idb-keyval
```

Expected:

- `package.json` contains `"idb-keyval"` under dependencies.
- `package-lock.json` updates.

- [ ] **Step 2: Create `src/storage/idb.ts`**

Write this complete file:

```ts
import { createStore, get, set, del } from 'idb-keyval'

export const IDB_KEYS = {
  sessions: 'sessions',
  currentSessionId: 'currentSessionId',
  memoryStore: 'memoryStore',
} as const

const appStore = createStore('deepseek-desktop', 'kv')

export async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const value = await get<T>(key, appStore)
    return value ?? null
  } catch (e) {
    console.warn(`[IDB] 读取失败: ${key}`, e)
    return null
  }
}

export async function idbSet<T>(key: string, value: T): Promise<boolean> {
  try {
    await set(key, value, appStore)
    return true
  } catch (e) {
    console.warn(`[IDB] 写入失败: ${key}`, e)
    return false
  }
}

export async function idbRemove(key: string): Promise<boolean> {
  try {
    await del(key, appStore)
    return true
  } catch (e) {
    console.warn(`[IDB] 删除失败: ${key}`, e)
    return false
  }
}

export async function idbClearKnownKeys(keys: string[]): Promise<void> {
  await Promise.all(keys.map(key => idbRemove(key)))
}
```

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: build succeeds. Warnings about dynamic imports/plugin timings are acceptable if there are no TypeScript errors.

- [ ] **Step 4: Review diff**

Run:

```bash
git diff -- package.json package-lock.json src/storage/idb.ts
```

Expected: only the dependency and the new storage wrapper are changed.

---

## Task 2: Add App-Level Large Store Clearing Helper

**Files:**
- Create: `src/storage/app-data.ts`

- [ ] **Step 1: Create `src/storage/app-data.ts`**

Write this complete file:

```ts
import { IDB_KEYS, idbClearKnownKeys } from './idb'

const LARGE_STORE_KEYS = [
  IDB_KEYS.sessions,
  IDB_KEYS.currentSessionId,
  IDB_KEYS.memoryStore,
]

export async function clearLargeStores(): Promise<void> {
  await idbClearKnownKeys(LARGE_STORE_KEYS)
}
```

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: build succeeds.

---

## Task 3: Migrate Session Store to IndexedDB

**Files:**
- Modify: `src/stores/session.ts`

- [ ] **Step 1: Replace imports**

In `src/stores/session.ts`, replace current imports with:

```ts
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { ChatSession } from '@/types'
import { useSettingsStore } from './settings'
import { IDB_KEYS, idbGet, idbRemove, idbSet } from '@/storage/idb'
```

- [ ] **Step 2: Replace `loadSessions()` with legacy helpers**

Replace the current `loadSessions()` function with these complete helpers:

```ts
const LEGACY_SESSIONS_KEY = 'ds_sessions'
const LEGACY_CURRENT_SESSION_KEY = 'ds_current_session'

function normalizeSessions(sessions: ChatSession[]): ChatSession[] {
  for (const session of sessions) {
    for (const msg of session.messages) {
      if ((msg as any).quote && !msg.quotes) {
        msg.quotes = [(msg as any).quote]
        delete (msg as any).quote
      }
    }
  }
  return sessions
}

function loadLegacySessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(LEGACY_SESSIONS_KEY)
    const sessions: ChatSession[] = raw ? JSON.parse(raw) : []
    return normalizeSessions(sessions)
  } catch {
    return []
  }
}

function loadLegacyCurrentId(): string {
  try {
    return localStorage.getItem(LEGACY_CURRENT_SESSION_KEY) ?? ''
  } catch {
    return ''
  }
}
```

- [ ] **Step 3: Replace store initialization and add hydrate**

Inside `defineStore('session', () => { ... })`, replace the initial state block:

```ts
const sessions = ref<ChatSession[]>(loadSessions())
const currentId = ref<string>('')
```

with:

```ts
const sessions = ref<ChatSession[]>([])
const currentId = ref<string>('')
const hydrated = ref(false)

async function hydrate() {
  const idbSessions = await idbGet<ChatSession[]>(IDB_KEYS.sessions)
  const idbCurrentId = await idbGet<string>(IDB_KEYS.currentSessionId)

  if (idbSessions) {
    sessions.value = normalizeSessions(idbSessions)
    currentId.value = idbCurrentId ?? sessions.value[0]?.id ?? ''
  } else {
    const legacySessions = loadLegacySessions()
    const legacyCurrentId = loadLegacyCurrentId()
    sessions.value = legacySessions
    currentId.value = legacyCurrentId || legacySessions[0]?.id || ''

    if (legacySessions.length > 0) {
      await idbSet(IDB_KEYS.sessions, legacySessions)
    }
    if (currentId.value) {
      await idbSet(IDB_KEYS.currentSessionId, currentId.value)
    }
    await idbRemove(LEGACY_SESSIONS_KEY)
    await idbRemove(LEGACY_CURRENT_SESSION_KEY)
    try {
      localStorage.removeItem(LEGACY_SESSIONS_KEY)
      localStorage.removeItem(LEGACY_CURRENT_SESSION_KEY)
    } catch { /* ignore */ }
  }

  hydrated.value = true
}

hydrate()
```

- [ ] **Step 4: Replace sessions watcher**

Replace the existing `watch(sessions, ...)` block with:

```ts
watch(sessions, async (val) => {
  if (!hydrated.value) return
  const ok = await idbSet(IDB_KEYS.sessions, val)
  if (!ok) {
    alert('会话存储写入失败，部分数据可能无法在重启后保留。建议导出重要会话后重试。')
  }
}, { deep: true })
```

- [ ] **Step 5: Replace currentId watcher**

Replace the existing `watch(currentId, ...)` block with:

```ts
watch(currentId, async (val) => {
  if (!hydrated.value) return
  if (val) await idbSet(IDB_KEYS.currentSessionId, val)
  else await idbRemove(IDB_KEYS.currentSessionId)
})
```

- [ ] **Step 6: Return `hydrated`**

Replace the return block with:

```ts
return {
  sessions, currentId, hydrated,
  createSession, switchSession, deleteSession, updateSessionTitle, getCurrentSession, ensureSession,
}
```

- [ ] **Step 7: Run build**

Run:

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 8: Manual migration smoke test**

Run app:

```bash
npm run dev
```

In DevTools Console, before refresh/restart, seed legacy data if needed:

```js
localStorage.setItem('ds_sessions', JSON.stringify([{ id: 'legacy1', title: 'Legacy', model: 'deepseek-v4-pro', messages: [], createdAt: Date.now(), updatedAt: Date.now() }]))
localStorage.setItem('ds_current_session', 'legacy1')
location.reload()
```

Expected after reload:

```js
localStorage.getItem('ds_sessions')      // null
localStorage.getItem('ds_current_session') // null
```

The session list should still contain the seeded `Legacy` session.

---

## Task 4: Wire `clearAllData()` to Clear IndexedDB Large Stores

**Files:**
- Modify: `src/stores/settings.ts`

- [ ] **Step 1: Add import**

At the top of `src/stores/settings.ts`, add:

```ts
import { clearLargeStores } from '@/storage/app-data'
```

The import block should include:

```ts
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { ModelOption } from '@/types'
import { useStatsStore } from './stats'
import { promptTemplates, DEFAULT_ROLE_ID } from '@/data/prompts'
import { clearLargeStores } from '@/storage/app-data'
```

- [ ] **Step 2: Update `clearAllData()`**

Inside `async function clearAllData()`, after `localStorage.clear()` add:

```ts
await clearLargeStores()
```

The beginning of the function should be:

```ts
async function clearAllData() {
  useStatsStore().clearAllStats()
  localStorage.clear()
  await clearLargeStores()
  // 同步清空加密存储
  const api = window.electronAPI
```

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: build succeeds.

---

## Task 5: Split Memory Pure Utilities

**Files:**
- Create: `src/composables/memory/memory-utils.ts`

- [ ] **Step 1: Create utility module**

Create `src/composables/memory/memory-utils.ts` with this complete content copied from the existing implementation:

```ts
import type { MemoryItem } from '@/types/memory'

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function tokenCount(text: string): number {
  const chinese = (text.match(/[一-鿿]/g) || []).length
  const english = (text.match(/\b[a-zA-Z]+\b/g) || []).length
  return Math.ceil(chinese * 1.5 + english * 1.3)
}

export function extractKeywords(text: string): string[] {
  const result: string[] = []
  const chineseWords = text.match(/[一-鿿]{2,}/g)
  if (chineseWords) {
    for (const w of chineseWords) {
      for (let i = 0; i < w.length - 1; i++) {
        result.push(w.slice(i, i + 2))
      }
    }
  }
  const englishWords = text.match(/\b[a-zA-Z]{2,}\b/g)
  if (englishWords) result.push(...englishWords.map(w => w.toLowerCase()))
  return [...new Set(result)]
}

export function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a)
  const setB = new Set(b)
  let intersection = 0
  for (const item of setA) {
    if (setB.has(item)) intersection++
  }
  const union = new Set([...setA, ...setB]).size
  return union === 0 ? 0 : intersection / union
}

export function relevanceScore(item: MemoryItem, queryKeywords: string[]): number {
  const keywordScore = queryKeywords.length > 0
    ? jaccardSimilarity(item.keywords, queryKeywords)
    : 0
  const daysAgo = (Date.now() - item.lastAccessedAt) / (1000 * 60 * 60 * 24)
  const recencyScore = Math.exp(-daysAgo / 30)
  const freqScore = Math.min(item.accessCount / 20, 1)
  return keywordScore * 0.5 + recencyScore * 0.3 + freqScore * 0.2
}

export function significantTokenOverlap(a: string, b: string): boolean {
  const tokensA = (a.match(/[a-zA-Z0-9]{2,}/g) || []).map(t => t.toLowerCase())
  const tokensB = (b.match(/[a-zA-Z0-9]{2,}/g) || []).map(t => t.toLowerCase())
  if (tokensA.length === 0 || tokensB.length === 0) return false
  return tokensA.some(t => tokensB.includes(t))
}
```

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: build succeeds because this module is not imported yet.

---

## Task 6: Create Memory Store Module with IndexedDB Migration

**Files:**
- Create: `src/composables/memory/memory-store.ts`

- [ ] **Step 1: Create `memory-store.ts` shell and move store-level code**

Create `src/composables/memory/memory-store.ts` with these imports, constants, default store, hydration, save, merge, CRUD, export/import/clear helpers. Use the existing implementation from `src/composables/useMemory.ts` for bodies of `mergeMemories`, `getCategories`, `getAllCategories`, `sortItems`, `updateItem`, `deleteItem`, `togglePin`, `clearAll`, `exportData`, `importFromJSON`, `selectiveClear`, and `downloadFile`.

```ts
import { ref } from 'vue'
import type { ExportOptions, MemoryItem, MemoryLayer, MemoryStore, SelectiveClearOptions, SortMode } from '@/types/memory'
import { IDB_KEYS, idbGet, idbRemove, idbSet } from '@/storage/idb'
import { extractKeywords, generateId, jaccardSimilarity, significantTokenOverlap } from './memory-utils'

const LEGACY_MEMORY_KEY = 'ds_memory'

function emptyMemoryStore(): MemoryStore {
  return { items: [], lastExtractionAt: 0, dreamLogs: [], newSinceLastDream: 0, pendingPreview: null }
}

function normalizeMemoryStore(data: any): MemoryStore {
  const normalized: MemoryStore = {
    items: Array.isArray(data?.items) ? data.items : [],
    lastExtractionAt: typeof data?.lastExtractionAt === 'number' ? data.lastExtractionAt : 0,
    dreamLogs: Array.isArray(data?.dreamLogs) ? data.dreamLogs : [],
    newSinceLastDream: data?.newSinceLastDream === undefined ? (data?.items?.length ?? 0) : data.newSinceLastDream,
    pendingPreview: data?.pendingPreview === undefined ? null : data.pendingPreview,
  }

  for (const item of normalized.items) {
    if (!item.category) item.category = '未分类'
    if (item.pinned === undefined) item.pinned = false
  }
  for (const log of normalized.dreamLogs) {
    if (log.manual === undefined) log.manual = false
  }

  return normalized
}

function loadLegacyMemoryStore(): MemoryStore | null {
  try {
    const raw = localStorage.getItem(LEGACY_MEMORY_KEY)
    if (!raw) return null
    return normalizeMemoryStore(JSON.parse(raw))
  } catch {
    return null
  }
}

export const memoryStore = ref<MemoryStore>(emptyMemoryStore())
export const memoryHydrated = ref(false)

export async function hydrateMemoryStore() {
  const idbStore = await idbGet<MemoryStore>(IDB_KEYS.memoryStore)
  if (idbStore) {
    memoryStore.value = normalizeMemoryStore(idbStore)
  } else {
    const legacyStore = loadLegacyMemoryStore()
    if (legacyStore) {
      memoryStore.value = legacyStore
      await idbSet(IDB_KEYS.memoryStore, legacyStore)
      try { localStorage.removeItem(LEGACY_MEMORY_KEY) } catch { /* ignore */ }
    }
  }
  memoryHydrated.value = true
}

hydrateMemoryStore()

export async function saveStore(store: MemoryStore = memoryStore.value) {
  if (!memoryHydrated.value) return
  const ok = await idbSet(IDB_KEYS.memoryStore, store)
  if (!ok) console.warn('[Memory] IndexedDB 写入失败')
}

export async function removeMemoryStore() {
  memoryStore.value = emptyMemoryStore()
  await idbRemove(IDB_KEYS.memoryStore)
  try { localStorage.removeItem(LEGACY_MEMORY_KEY) } catch { /* ignore */ }
}
```

Then append exact existing helper/function bodies from `src/composables/useMemory.ts`:

- `mergeMemories` from lines `101-125`, export it as `export function mergeMemories(...)`.
- `getCategories` from lines `226-235`, export it and replace `store.value` with `memoryStore.value`.
- `getAllCategories` from lines `695-702`, export it and replace `store.value` with `memoryStore.value`.
- `sortItems` from lines `704-712`, export it unchanged.
- `updateItem` from lines `657-668`, export it, replace `store.value` with `memoryStore.value`, and call `saveStore(memoryStore.value)`.
- `deleteItem` from lines `670-674`, export it and replace `store.value` with `memoryStore.value`.
- `togglePin` from lines `676-682`, export it and replace `store.value` with `memoryStore.value`.
- `clearAll` from lines `714-718`, export it and set `memoryStore.value = emptyMemoryStore()`.
- `exportData` from lines `720-750`, export it and replace `store.value` with `memoryStore.value`.
- `importFromJSON` from lines `752-777`, export it and replace `store.value` with `memoryStore.value`.
- `selectiveClear` from lines `779-797`, export it and replace `store.value` with `memoryStore.value`.
- `downloadFile` from lines `799-808`, export it unchanged.

- [ ] **Step 2: Ensure all save calls are async-safe**

In this module, calls to `saveStore(memoryStore.value)` do not need `await` in synchronous public functions. Keep the call fire-and-forget exactly like existing localStorage persistence:

```ts
saveStore(memoryStore.value)
```

Expected: UI behavior remains synchronous; IndexedDB persistence happens asynchronously.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: build succeeds or only reports unused exports if the bundler is stricter. If unused export errors occur, they are acceptable only if `noUnusedLocals` remains false; do not change tsconfig.

---

## Task 7: Create Memory Search Module

**Files:**
- Create: `src/composables/memory/memory-search.ts`

- [ ] **Step 1: Create `memory-search.ts`**

Create this module by moving search/context/stats functions out of `useMemory.ts`.

Start with this header:

```ts
import type { DreamLog, GrowthPoint, LayerDistribution, MemoryItem, MemoryLayer, TopAccessed } from '@/types/memory'
import { memoryStore, saveStore } from './memory-store'
import { extractKeywords, relevanceScore, tokenCount } from './memory-utils'

const TOKEN_BUDGET: Record<MemoryLayer, number> = {
  short: 3000,
  medium: 10000,
  long: 5000,
}
```

Then append exported versions of these existing function bodies:

- `getByLayer` from `useMemory.ts:210-215`; replace `store.value` with `memoryStore.value`.
- `getPromotionThreshold` from `useMemory.ts:217-224`; export it because `getByLayer` and `promoteShortTerm` use it.
- `buildMemoryContext` from `useMemory.ts:238-283`; replace `store.value` with `memoryStore.value`; keep `saveStore(memoryStore.value)`.
- `searchItems` from `useMemory.ts:684-693`; replace `store.value` with `memoryStore.value`.
- `getGrowthData` from `useMemory.ts:810-823`; replace `store.value` with `memoryStore.value`.
- `getLayerDistribution` from `useMemory.ts:825-833`; replace `store.value` with `memoryStore.value`.
- `getTopAccessed` from `useMemory.ts:835-841`; replace `store.value` with `memoryStore.value`.
- `getDreamTimeline` from `useMemory.ts:843-846`; replace `store.value` with `memoryStore.value`.

The module must export `tokenCount` too, by adding this line at the bottom:

```ts
export { tokenCount }
```

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: build succeeds.

---

## Task 8: Create Memory Extractor Module

**Files:**
- Create: `src/composables/memory/memory-extractor.ts`

- [ ] **Step 1: Create `memory-extractor.ts`**

Create this module with these imports:

```ts
import type { MemoryItem, MemoryLayer } from '@/types/memory'
import { extractKeywords, generateId } from './memory-utils'
import { memoryStore, mergeMemories, saveStore } from './memory-store'
import { dream, isDreaming } from './memory-dreamer'
```

Move these exact blocks from `src/composables/useMemory.ts`:

- `AUTO_DREAM_THRESHOLD` from line `5`.
- `EXTRACTION_PROMPT` from lines `129-166`.
- `extractFromExchange` from lines `285-359`, exported as `export async function extractFromExchange(...)`.
- `parseExtraction` from lines `361-404`, exported as `export function parseExtraction(...)`.

Apply these mechanical replacements in moved code:

- Replace `store.value` with `memoryStore.value`.
- Replace `saveStore(store.value)` with `saveStore(memoryStore.value)`.
- Replace `if (store.value.newSinceLastDream >= AUTO_DREAM_THRESHOLD && !dreaming)` with:

```ts
if (memoryStore.value.newSinceLastDream >= AUTO_DREAM_THRESHOLD && !isDreaming()) {
  console.log('[Memory] 达到 dreaming 阈值，自动触发...')
  dream(apiKey)
}
```

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: build succeeds after `memory-dreamer.ts` exists. If this task is implemented before Task 9, build may fail with missing module; in that case proceed directly to Task 9 before validating.

---

## Task 9: Create Memory Dreamer Module

**Files:**
- Create: `src/composables/memory/memory-dreamer.ts`

- [ ] **Step 1: Create `memory-dreamer.ts`**

Create this module with these imports and state:

```ts
import type { DreamLog, DreamPreview, MemoryItem, MemoryLayer } from '@/types/memory'
import { extractKeywords, generateId, jaccardSimilarity, significantTokenOverlap } from './memory-utils'
import { memoryStore, saveStore } from './memory-store'

const AUTO_DREAM_THRESHOLD = 10
const SESSION_DREAM_THRESHOLD = 20
let dreaming = false

export function isDreaming() {
  return dreaming
}
```

Move these exact blocks from `src/composables/useMemory.ts`:

- `DREAM_PROMPT` from lines `170-200`.
- `_runDream` from lines `406-448`, exported as `async function runDream(...)` or kept private as `_runDream`.
- `parseDreamOps` from lines `450-507`.
- `dream` from lines `509-524`.
- `dreamDryRun` from lines `526-540`.
- `approveDream` from lines `542-562`.
- `rejectDream` from lines `564-568`.
- `getDreamStatus` from lines `570-577`.
- `parseDreamResult` from lines `579-647`.
- `checkAutoDream` from lines `649-655`.
- `promoteShortTerm` from lines `848-860`.

Apply these mechanical replacements in moved code:

- Replace `store.value` with `memoryStore.value`.
- Replace `saveStore(store.value)` with `saveStore(memoryStore.value)`.
- In `promoteShortTerm`, use the same threshold calculation currently in the function; do not import `getPromotionThreshold` to avoid a cycle.
- Export public functions: `dream`, `checkAutoDream`, `dreamDryRun`, `approveDream`, `rejectDream`, `getDreamStatus`, `promoteShortTerm`, `isDreaming`.

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: build succeeds once both extractor and dreamer modules exist.

---

## Task 10: Compose Public `useMemory()` API and Add Compatibility Re-export

**Files:**
- Create: `src/composables/memory/index.ts`
- Modify: `src/composables/useMemory.ts`

- [ ] **Step 1: Create `src/composables/memory/index.ts`**

Write this complete file:

```ts
import { memoryStore } from './memory-store'
import {
  clearAll,
  deleteItem,
  downloadFile,
  exportData,
  getAllCategories,
  getCategories,
  importFromJSON,
  selectiveClear,
  sortItems,
  togglePin,
  updateItem,
} from './memory-store'
import {
  buildMemoryContext,
  getByLayer,
  getDreamTimeline,
  getGrowthData,
  getLayerDistribution,
  getTopAccessed,
  searchItems,
  tokenCount,
} from './memory-search'
import { extractFromExchange } from './memory-extractor'
import {
  approveDream,
  checkAutoDream,
  dream,
  dreamDryRun,
  getDreamStatus,
  promoteShortTerm,
  rejectDream,
} from './memory-dreamer'

export function useMemory() {
  return {
    store: memoryStore,
    getByLayer,
    getCategories,
    buildMemoryContext,
    searchItems,
    getAllCategories,
    sortItems,
    extractFromExchange,
    dream,
    checkAutoDream,
    dreamDryRun,
    approveDream,
    rejectDream,
    getDreamStatus,
    updateItem,
    deleteItem,
    togglePin,
    promoteShortTerm,
    clearAll,
    exportData,
    importFromJSON,
    selectiveClear,
    downloadFile,
    getGrowthData,
    getLayerDistribution,
    getTopAccessed,
    getDreamTimeline,
    tokenCount,
  }
}
```

- [ ] **Step 2: Replace `src/composables/useMemory.ts` with compatibility export**

Replace the entire file with:

```ts
export { useMemory } from './memory'
```

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: build succeeds. If TypeScript reports missing exports, check the corresponding memory module and export the function named in the error.

- [ ] **Step 4: Verify no import changes are required**

Run:

```bash
rg "useMemory" src
```

Expected: existing callers may still import from `@/composables/useMemory`; that is correct.

---

## Task 11: Verify Legacy Memory Migration

**Files:**
- No code changes unless verification reveals a bug.

- [ ] **Step 1: Run app**

Run:

```bash
npm run dev
```

- [ ] **Step 2: Seed legacy memory data in DevTools Console**

Paste:

```js
localStorage.setItem('ds_memory', JSON.stringify({
  items: [{
    id: 'legacy-memory-1',
    content: '用户偏好使用 IndexedDB 存储大对象',
    layer: 'medium',
    category: '项目偏好',
    keywords: ['用户', '偏好', 'IndexedDB'],
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    accessCount: 0,
    pinned: false
  }],
  lastExtractionAt: 0,
  dreamLogs: [],
  newSinceLastDream: 1,
  pendingPreview: null
}))
location.reload()
```

Expected:

- Memory view still shows the seeded memory.
- Console check returns:

```js
localStorage.getItem('ds_memory') // null
```

- [ ] **Step 3: Restart app and verify persistence**

Stop dev server and run again:

```bash
npm run dev
```

Expected: seeded memory still exists even though `localStorage.ds_memory` is gone.

---

## Task 12: Verify Session Persistence and Clear-All Behavior

**Files:**
- No code changes unless verification reveals a bug.

- [ ] **Step 1: Verify session write persistence**

In the running app:

1. Create a new session.
2. Send a short message.
3. Restart the app with `npm run dev`.

Expected: the session and message are still visible.

- [ ] **Step 2: Verify localStorage cleanup**

In DevTools Console:

```js
localStorage.getItem('ds_sessions')
localStorage.getItem('ds_current_session')
localStorage.getItem('ds_memory')
```

Expected: all three return `null` after migration.

- [ ] **Step 3: Verify clear all data**

Use the app's existing settings clear-all control.

Expected after restart:

- Sessions are cleared or app returns to an empty/default session state.
- Memory list is empty.
- API keys are cleared by existing safeStorage delete logic.
- localStorage settings are reset to defaults.

- [ ] **Step 4: Run final build**

Run:

```bash
npm run build
```

Expected: build succeeds.

---

## Task 13: Final Review

**Files:**
- Review all changed files.

- [ ] **Step 1: Review changed files**

Run:

```bash
git status --short
git diff -- src/storage src/stores/session.ts src/stores/settings.ts src/composables/useMemory.ts src/composables/memory package.json package-lock.json
```

Expected:

- `src/composables/useMemory.ts` is only a re-export.
- `src/composables/memory/` contains focused modules.
- `src/stores/session.ts` reads/writes IndexedDB and only uses localStorage for legacy migration.
- `src/stores/settings.ts` calls `clearLargeStores()` inside `clearAllData()`.
- `package.json` includes `idb-keyval`.

- [ ] **Step 2: Search for legacy large-object localStorage writes**

Run:

```bash
rg "ds_sessions|ds_current_session|ds_memory" src
```

Expected:

- `ds_sessions` and `ds_current_session` only appear in session legacy migration constants.
- `ds_memory` only appears in memory legacy migration constant.
- No `localStorage.setItem('ds_sessions'...)` or `localStorage.setItem('ds_memory'...)` remains.

- [ ] **Step 3: Do not commit unless explicitly requested**

The normal project rule for this session is: do not commit unless the user asks. If the user asks for a commit, use a message like:

```bash
git add package.json package-lock.json src/storage src/stores/session.ts src/stores/settings.ts src/composables/useMemory.ts src/composables/memory docs/superpowers/specs/2026-06-10-step2-storage-memory-design.md docs/superpowers/plans/2026-06-10-step2-storage-memory.md
git commit -m "feat: migrate large stores to IndexedDB"
```

Commit body must end with:

```text
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

---

## Self-Review Notes

- Spec coverage: IndexedDB wrapper, session migration, memory migration, useMemory split, clearAllData adaptation, fallback handling, and verification are all mapped to tasks.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation steps remain. Refactor tasks use exact source line ranges and replacement rules to avoid duplicating 893 lines of existing code in the plan.
- Type consistency: storage keys are centralized in `IDB_KEYS`; memory singleton is `memoryStore`; public API from `useMemory()` matches the original return object.
