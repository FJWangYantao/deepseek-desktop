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

function significantTokenOverlap(a: string, b: string): boolean {
  const tokensA = (a.match(/[a-zA-Z0-9]{2,}/g) || []).map(t => t.toLowerCase())
  const tokensB = (b.match(/[a-zA-Z0-9]{2,}/g) || []).map(t => t.toLowerCase())
  if (tokensA.length === 0 || tokensB.length === 0) return false
  return tokensA.some(t => tokensB.includes(t))
}

// ---------- 记忆去重 ----------

function mergeMemories(existing: MemoryItem[], incoming: MemoryItem[]): MemoryItem[] {
  const merged = [...existing]
  for (const item of incoming) {
    const dup = merged.find(m => {
      // 内容中的英文/数字 token 直接重叠（如 PM2, Docker, React）
      if (significantTokenOverlap(m.content, item.content)) return true
      // 关键词 Jaccard（降低阈值适配中文 bigram）
      const kwSim = jaccardSimilarity(m.keywords, item.keywords)
      if (kwSim > 0.3) return true
      // 内容关键词 Jaccard
      const contentSim = jaccardSimilarity(extractKeywords(m.content), extractKeywords(item.content))
      return contentSim > 0.25
    })
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

const EXTRACTION_PROMPT = `你是一个信息筛选器。只提取关于"用户本人"的实质信息——即未来对话中可能需要回忆的关于用户的事实。

严格按以下格式输出：

[短期]
- 条目1
（无则写"无"）

[中期]
- 条目1
（无则写"无"）

[长期]
- 条目1
（无则写"无"）

什么是"关于用户的实质信息"（可提取）：
- 身份信息：姓名、职业、公司、地点、职位、团队角色
- 技术选型：用户使用/偏好/学习的技术栈、工具、框架
- 项目背景：用户正在做的项目、产品、业务场景
- 偏好习惯：用户表达过的喜好、厌恶、工作习惯

什么不是"关于用户的实质信息"（不可提取）：
- 纯技术知识点：API名称、库函数用法、语法细节、配置参数
  例：不提"contextBridge用于主进程与渲染进程通信"
- 社交性闲聊：关于天气、吃饭、AI本身的对话，寒暄问候
  例：不提"用户知道AI不需要吃饭"、"用户觉得天气好"
- 简短应答："好的谢谢"、"嗯"、"哦"、"知道了"
- 对AI回复的评价：不提"用户认可AI的建议"
- 代码片段、bug描述、报错信息
- 任何不包含用户个人信息的内容

层级指南：
- 短期：本次对话中提到的临时信息、当前任务
- 中期：近期项目、阶段性偏好、正在学习的技术
- 长期：姓名、职业、长期偏好、核心技能

无信息时每层只写"无"。不要写解释性文字。`

// ---------- Dreaming prompt ----------

const DREAM_PROMPT = `你是记忆整理助手。用户记忆分三层：短期(当前会话)、中期(几周内)、长期(永久)。

请按以下步骤整理记忆列表：

1. 归类：将相关记忆归入2-5个主题，每个主题起简短名称（如"个人身份"、"技术栈"、"项目背景"、"部署偏好"、"工作习惯"）
2. 合并：同一主题下内容相似/重复的记忆必须合并为一条精炼表述，不要保留多条相似内容
3. 分级：根据重要性分配层级——身份/长期偏好→long，项目/技术→medium，临时信息→short
4. 删除：过时、矛盾、无实质信息的条目（列出其id）

重要：每条记忆都必须分配一个分类。压缩比应控制在50-80%（10条整理为5-8条）。

输出示例：
[归类]
个人身份：用户的基本身份信息
技术栈：用户的编程语言和框架偏好
项目背景：用户正在进行的项目

[记忆]
用户叫李明，在北京一家互联网公司担任前端工程师 | long | 个人身份
用户主要使用React和TypeScript，也在学习Vue3 | medium | 技术栈
用户用Electron开发内部桌面工具 | medium | 项目背景
用户偏好PM2进行项目部署，不喜欢Docker | long | 部署偏好

[删除]
abc123, def456`

// ---------- 单例状态（模块级，避免多实例不同步）----------
const store = ref<MemoryStore>(loadStore())
let dreaming = false

// ---------- Composable ----------

export function useMemory() {

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

  /** 从对话中提取记忆，返回诊断信息 */
  async function extractFromExchange(
    userContent: string,
    assistantContent: string,
    apiKey: string,
  ): Promise<{ added: number; total: number; rawText?: string; error?: string }> {
    if (!apiKey) return { added: 0, total: store.value.items.length, error: '无 API Key' }

    const exchangeText = `用户：${userContent}\n\nAI：${assistantContent.slice(0, 2000)}`
    let addedCount = 0

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

      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        return { added: 0, total: store.value.items.length, error: `API 返回 ${res.status}: ${errBody.slice(0, 200)}` }
      }
      const data = await res.json()
      const text = data.choices?.[0]?.message?.content?.trim()
      if (!text) { return { added: 0, total: store.value.items.length, error: 'API 返回内容为空' } }
      console.log('[Memory] 原始提取:\n', text)

      const parsed = parseExtraction(text)
      if (parsed.length === 0) {
        return { added: 0, total: store.value.items.length, rawText: text, error: '解析后无有效条目（格式不匹配或内容被过滤）' }
      }

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

      addedCount = incoming.length
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
    } catch (e: any) {
      console.warn('[Memory] 提取失败:', e)
      return { added: 0, total: store.value.items.length, error: `异常: ${e.message || String(e)}` }
    }

    return { added: addedCount, total: store.value.items.length }
  }

  function parseExtraction(text: string): { layer: MemoryLayer; content: string }[] {
    const result: { layer: MemoryLayer; content: string }[] = []
    const layerMap: Record<string, MemoryLayer> = {
      '短期': 'short', '中期': 'medium', '长期': 'long',
      'short': 'short', 'medium': 'medium', 'long': 'long',
    }

    // 统一处理：按层级标记 [短期]/[中期]/[长期] 分割
    // 先尝试多行格式，再尝试单行格式
    const hasNewlines = /\n/.test(text)

    if (hasNewlines) {
      // 多行格式：按 [xxx] 开头的行分段
      const sections = text.split(/\n(?=\[)/)
      for (const section of sections) {
        const headerMatch = section.match(/\[(短期|中期|长期|short|medium|long)\]/i)
        if (!headerMatch) continue
        const layer = layerMap[headerMatch[1].toLowerCase()] || 'short'

        const lines = section.split('\n').slice(1)
        for (const line of lines) {
          const cleaned = line.replace(/^[-*•\d.]+\s*/, '').trim()
          if (cleaned && cleaned !== '无' && cleaned.length >= 4 && cleaned.length <= 80) {
            result.push({ layer, content: cleaned })
          }
        }
      }
    } else {
      // 单行格式：按 [xxx] 标记用正则切分
      const parts = text.split(/(?=\[(?:短期|中期|长期|short|medium|long)\])/i)
      for (const part of parts) {
        const headerMatch = part.match(/\[(短期|中期|长期|short|medium|long)\]\s*/i)
        if (!headerMatch) continue
        const layer = layerMap[headerMatch[1].toLowerCase()] || 'short'
        // 去掉标记前缀，获取内容
        const content = part.replace(/\[(?:短期|中期|长期|short|medium|long)\]\s*/i, '').trim()
        if (content && content !== '无' && content.length >= 4 && content.length <= 80) {
          result.push({ layer, content })
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
        // 检查是否被新条目覆盖（token重叠 + 关键词相似度）
        const similar = newItems.find(n =>
          significantTokenOverlap(n.content, old.content) ||
          jaccardSimilarity(n.keywords, old.keywords) > 0.4
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
