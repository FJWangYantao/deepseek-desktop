import { ref } from 'vue'
import type { MemoryItem, MemoryLayer, MemoryStore, DreamLog } from '@/types/memory'

const STORAGE_KEY = 'ds_memory'
const AUTO_DREAM_THRESHOLD = 10   // 累计10条新记忆自动 dreaming
const SESSION_DREAM_THRESHOLD = 20 // 会话切换时超过20条触发

const TOKEN_BUDGET: Record<MemoryLayer, number> = {
  short: 3000,
  medium: 10000,
  long: 5000,
}

// ---------- 工具函数 ----------

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function tokenCount(text: string): number {
  const chinese = (text.match(/[一-鿿]/g) || []).length
  const english = (text.match(/\b[a-zA-Z]+\b/g) || []).length
  return Math.ceil(chinese * 1.5 + english * 1.3)
}

function extractKeywords(text: string): string[] {
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

function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a)
  const setB = new Set(b)
  let intersection = 0
  for (const item of setA) {
    if (setB.has(item)) intersection++
  }
  const union = new Set([...setA, ...setB]).size
  return union === 0 ? 0 : intersection / union
}

function relevanceScore(item: MemoryItem, queryKeywords: string[]): number {
  const keywordScore = queryKeywords.length > 0
    ? jaccardSimilarity(item.keywords, queryKeywords)
    : 0
  const daysAgo = (Date.now() - item.lastAccessedAt) / (1000 * 60 * 60 * 24)
  const recencyScore = Math.exp(-daysAgo / 30)
  const freqScore = Math.min(item.accessCount / 20, 1)
  return keywordScore * 0.5 + recencyScore * 0.3 + freqScore * 0.2
}

// ---------- 持久化 ----------

function loadStore(): MemoryStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw)
      // 兼容旧数据
      if (!data.dreamLogs) data.dreamLogs = []
      if (data.newSinceLastDream === undefined) data.newSinceLastDream = data.items?.length ?? 0
      // 兼容旧 item 无 category
      for (const item of data.items || []) {
        if (!item.category) item.category = '未分类'
      }
      return data
    }
  } catch {}
  return { items: [], lastExtractionAt: 0, dreamLogs: [], newSinceLastDream: 0 }
}

function saveStore(store: MemoryStore) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)) } catch {}
}

// ---------- 记忆去重 ----------

function mergeMemories(existing: MemoryItem[], incoming: MemoryItem[]): MemoryItem[] {
  const merged = [...existing]
  for (const item of incoming) {
    const dup = merged.find(m =>
      jaccardSimilarity(m.keywords, item.keywords) > 0.7 &&
      jaccardSimilarity(extractKeywords(m.content), extractKeywords(item.content)) > 0.5
    )
    if (dup) {
      dup.content = item.content
      dup.keywords = item.keywords
      dup.category = item.category
      dup.lastAccessedAt = Date.now()
      dup.accessCount++
    } else {
      merged.push(item)
    }
  }
  return merged
}

// ---------- 提取 prompt ----------

const EXTRACTION_PROMPT = `从对话中提取值得记住的信息，分三层输出：

[短期] 当前任务目标、临时的偏好或决定
[中期] 技术栈偏好、项目背景、工作习惯、审美偏好
[长期] 用户身份角色、知识领域、长期不变的偏好

规则：
- 每层一行一条，每条5-60字
- 提取真正有用的信息：身份、偏好、项目背景、技术选型
- 不提取：纯技术知识点（API用法、语法细节）、bug描述、代码片段
- 举例：可提"用户用Electron开发桌面应用"；不提"__getattr__用于属性委托"
- 无信息写"无"`

// ---------- Dreaming prompt ----------

const DREAM_PROMPT = `你是记忆整理助手。用户记忆分三层：短期(当前会话)、中期(几周内)、长期(永久)。

请整理以下记忆列表：

1. 归类：将相关记忆归入主题，每个主题起一个简短的名称（如"个人身份"、"技术偏好"、"项目背景"、"工作习惯"等）
2. 合并：同主题下重复/相似的记忆合并为一条精炼表述
3. 分级：根据信息的重要性和持久性重新分配 short/medium/long
4. 删除：过时、矛盾、琐碎无价值的条目

输出格式：
[归类]
主题名1：一句话描述
主题名2：一句话描述

[记忆]
内容 | 层级(short/medium/long) | 所属主题名

[删除]
id1, id2`

// ---------- Composable ----------

export function useMemory() {
  const store = ref<MemoryStore>(loadStore())
  let dreaming = false // 防止并发 dreaming

  function getByLayer(layer: MemoryLayer): MemoryItem[] {
    const threshold = getPromotionThreshold(layer)
    return store.value.items
      .filter(i => i.layer === layer && i.lastAccessedAt > threshold)
      .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
  }

  function getPromotionThreshold(layer: MemoryLayer): number {
    const now = Date.now()
    switch (layer) {
      case 'short': return now - 7 * 24 * 60 * 60 * 1000
      case 'medium': return now - 60 * 24 * 60 * 60 * 1000
      case 'long': return 0
    }
  }

  /** 按分类分组 */
  function getCategories(): Map<string, MemoryItem[]> {
    const map = new Map<string, MemoryItem[]>()
    for (const item of store.value.items) {
      const cat = item.category || '未分类'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(item)
    }
    return map
  }

  /** 构建记忆注入上下文 */
  function buildMemoryContext(userText: string): string {
    const queryKeywords = extractKeywords(userText)
    const layers: MemoryLayer[] = ['long', 'medium', 'short']
    const sections: string[] = []

    for (const layer of layers) {
      const items = getByLayer(layer)
      if (items.length === 0) continue

      let sorted: MemoryItem[]
      if (layer === 'short') {
        sorted = items
      } else {
        sorted = items
          .map(i => ({ item: i, score: relevanceScore(i, queryKeywords) }))
          .sort((a, b) => b.score - a.score)
          .map(x => x.item)
      }

      let budget = TOKEN_BUDGET[layer]
      const selected: string[] = []
      for (const item of sorted) {
        const cost = tokenCount(item.content) + 4
        if (budget - cost < 0) break
        selected.push(`- ${item.content}`)
        budget -= cost
        item.lastAccessedAt = Date.now()
        item.accessCount++
      }

      if (selected.length === 0) continue

      const label = layer === 'short' ? '短期记忆（本次对话）'
        : layer === 'medium' ? '中期记忆（近期相关）'
        : '长期记忆（核心信息）'

      sections.push(`[${label}]\n${selected.join('\n')}`)
    }

    saveStore(store.value)
    return sections.length > 0
      ? `[系统提示] 以下是与用户相关的记忆信息：\n\n${sections.join('\n\n')}\n\n请基于这些记忆理解用户背景。`
      : ''
  }

  /** 从对话中提取记忆 */
  async function extractFromExchange(
    userContent: string,
    assistantContent: string,
    apiKey: string,
  ): Promise<void> {
    if (!apiKey) return

    const exchangeText = `用户：${userContent}\n\nAI：${assistantContent.slice(0, 2000)}`

    try {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: [
            { role: 'system', content: EXTRACTION_PROMPT },
            { role: 'user', content: exchangeText },
          ],
          thinking: { type: 'disabled' },
          max_tokens: 800,
        }),
      })

      if (!res.ok) return
      const data = await res.json()
      const text = data.choices?.[0]?.message?.content?.trim()
      if (!text) { console.log('[Memory] 提取结果为空'); return }
      console.log('[Memory] 原始提取:\n', text)

      const parsed = parseExtraction(text)
      if (parsed.length === 0) { console.log('[Memory] 解析后无有效条目'); return }

      const now = Date.now()
      const incoming: MemoryItem[] = parsed.map(p => ({
        id: generateId(),
        content: p.content,
        layer: p.layer,
        category: '未分类',
        keywords: extractKeywords(p.content),
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
      }))

      store.value.items = mergeMemories(store.value.items, incoming)
      store.value.lastExtractionAt = now
      store.value.newSinceLastDream += incoming.length
      saveStore(store.value)
      console.log('[Memory] 提取完成，新增', incoming.length, '条，总计', store.value.items.length, '条')

      // 自动 dreaming
      if (store.value.newSinceLastDream >= AUTO_DREAM_THRESHOLD && !dreaming) {
        console.log('[Memory] 达到 dreaming 阈值，自动触发...')
        dream(apiKey)
      }
    } catch (e) {
      console.warn('[Memory] 提取失败:', e)
    }
  }

  function parseExtraction(text: string): { layer: MemoryLayer; content: string }[] {
    const result: { layer: MemoryLayer; content: string }[] = []
    const sections = text.split(/\n(?=\[)/)
    const layerMap: Record<string, MemoryLayer> = {
      '短期': 'short', '中期': 'medium', '长期': 'long',
      'short': 'short', 'medium': 'medium', 'long': 'long',
    }

    for (const section of sections) {
      const headerMatch = section.match(/\[(短期|中期|长期|short|medium|long)\]/i)
      if (!headerMatch) continue
      const layer = layerMap[headerMatch[1].toLowerCase()] || layerMap[headerMatch[1]] || 'short'

      const lines = section.split('\n').slice(1)
      for (const line of lines) {
        const cleaned = line.replace(/^[-*•\d.]+\s*/, '').trim()
        if (cleaned && cleaned !== '无' && cleaned.length >= 5 && cleaned.length <= 80) {
          result.push({ layer, content: cleaned })
        }
      }
    }
    return result
  }

  /** Dreaming：AI 驱动的记忆整理（纯自动，fire-and-forget） */
  async function dream(apiKey: string): Promise<void> {
    if (dreaming || store.value.items.length === 0) return
    dreaming = true

    const beforeCount = store.value.items.length
    const memoryList = store.value.items
      .map(i => `[${i.id}] (${i.layer}) ${i.content}`)
      .join('\n')

    try {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: [
            { role: 'system', content: DREAM_PROMPT },
            { role: 'user', content: memoryList },
          ],
          thinking: { type: 'disabled' },
          max_tokens: 1000,
        }),
      })

      if (!res.ok) { dreaming = false; return }
      const data = await res.json()
      const text = data.choices?.[0]?.message?.content?.trim()
      if (!text) { dreaming = false; return }

      const result = parseDreamResult(text, store.value.items)
      const afterCount = result.items.length

      const log: DreamLog = {
        timestamp: Date.now(),
        beforeCount,
        afterCount,
        categories: result.categories,
      }

      store.value.items = result.items
      store.value.dreamLogs.push(log)
      store.value.newSinceLastDream = 0
      saveStore(store.value)
      console.log('[Dream] 梦境整理完成：', beforeCount, '→', afterCount, '条，', result.categories.length, '个分类')
    } catch (e) {
      console.warn('[Dream] 梦境整理失败:', e)
    } finally {
      dreaming = false
    }
  }

  function parseDreamResult(text: string, oldItems: MemoryItem[]): {
    items: MemoryItem[]
    categories: string[]
  } {
    const now = Date.now()
    const categories: string[] = []

    // 解析 [归类] 块
    const catMatch = text.match(/\[归类\]([\s\S]*?)(?=\[记忆\]|$)/i)
    if (catMatch) {
      const catLines = catMatch[1].trim().split('\n').filter(Boolean)
      for (const line of catLines) {
        const name = line.split(/：|:/)[0].trim()
        if (name) categories.push(name)
      }
    }

    // 解析 [记忆] 块
    const memMatch = text.match(/\[记忆\]([\s\S]*?)(?=\[删除\]|$)/i)
    const newItems: MemoryItem[] = []
    if (memMatch) {
      const memLines = memMatch[1].trim().split('\n').filter(Boolean)
      for (const line of memLines) {
        const parts = line.split('|').map(s => s.trim())
        if (parts.length >= 2) {
          const content = parts[0]
          const layer = (parts[1]?.toLowerCase() || 'short') as MemoryLayer
          const category = parts[2] || '未分类'
          if (content.length >= 4) {
            newItems.push({
              id: generateId(),
              content,
              layer: ['short', 'medium', 'long'].includes(layer) ? layer : 'short',
              category,
              keywords: extractKeywords(content),
              createdAt: now,
              lastAccessedAt: now,
              accessCount: 0,
            })
          }
        }
      }
    }

    // 解析 [删除] 块，保留未删除的旧条目
    const delMatch = text.match(/\[删除\]([\s\S]*)/i)
    const deleteIds = new Set<string>()
    if (delMatch) {
      const ids = delMatch[1].split(/[,\s]+/).filter(Boolean)
      for (const id of ids) deleteIds.add(id)
    }

    // 保留 AI 未提及删除的旧条目
    for (const old of oldItems) {
      if (!deleteIds.has(old.id)) {
        // 检查是否被新条目覆盖（相似度判定）
        const similar = newItems.find(n =>
          jaccardSimilarity(n.keywords, old.keywords) > 0.6
        )
        if (!similar) {
          newItems.push({ ...old })
        }
      }
    }

    return { items: newItems, categories }
  }

  /** 检查是否需要 dreaming（会话切换时调用） */
  function checkAutoDream(apiKey: string) {
    if (!dreaming && store.value.items.length >= SESSION_DREAM_THRESHOLD && store.value.newSinceLastDream >= AUTO_DREAM_THRESHOLD) {
      console.log('[Dream] 会话切换触发 dreaming')
      dream(apiKey)
    }
  }

  /** 更新单条记忆 */
  function updateItem(id: string, updates: Partial<Pick<MemoryItem, 'content' | 'layer' | 'category'>>) {
    const item = store.value.items.find(i => i.id === id)
    if (!item) return
    if (updates.content !== undefined) {
      item.content = updates.content
      item.keywords = extractKeywords(updates.content)
    }
    if (updates.layer !== undefined) item.layer = updates.layer
    if (updates.category !== undefined) item.category = updates.category
    saveStore(store.value)
  }

  /** 删除单条记忆 */
  function deleteItem(id: string) {
    store.value.items = store.value.items.filter(i => i.id !== id)
    saveStore(store.value)
  }

  /** 清除所有记忆 */
  function clearAll() {
    store.value = { items: [], lastExtractionAt: 0, dreamLogs: [], newSinceLastDream: 0 }
    saveStore(store.value)
  }

  /** 升级短期记忆到中期 */
  function promoteShortTerm() {
    const now = Date.now()
    const threshold = now - 7 * 24 * 60 * 60 * 1000
    let changed = false
    for (const item of store.value.items) {
      if (item.layer === 'short' && item.createdAt < threshold && item.accessCount >= 2) {
        item.layer = 'medium'
        changed = true
      }
    }
    if (changed) saveStore(store.value)
  }

  return {
    store,
    getByLayer,
    getCategories,
    buildMemoryContext,
    extractFromExchange,
    dream,
    checkAutoDream,
    updateItem,
    deleteItem,
    promoteShortTerm,
    clearAll,
    tokenCount,
  }
}
