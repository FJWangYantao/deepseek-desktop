import { ref } from 'vue'
import type { MemoryItem, MemoryLayer, MemoryStore, DreamLog, DreamPreview, SortMode, ExportOptions, SelectiveClearOptions, GrowthPoint, LayerDistribution, TopAccessed } from '@/types/memory'

const STORAGE_KEY = 'ds_memory'
const AUTO_DREAM_THRESHOLD = 5    // 累计5条新记忆自动 dreaming
const SESSION_DREAM_THRESHOLD = 10 // 会话切换时超过10条触发

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
      if (data.pendingPreview === undefined) data.pendingPreview = null
      // 兼容旧 item
      for (const item of data.items || []) {
        if (!item.category) item.category = '未分类'
        if (item.pinned === undefined) item.pinned = false
      }
      // 兼容旧 dreamLog 无 manual
      for (const log of data.dreamLogs) {
        if (log.manual === undefined) log.manual = false
      }
      return data
    }
  } catch {}
  return { items: [], lastExtractionAt: 0, dreamLogs: [], newSinceLastDream: 0, pendingPreview: null }
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

// ---------- 垃圾内容过滤 ----------

const JUNK_PATTERNS = [
  /^合并[:：]/,
  /^重分类[:：]/,
  /^删除[:：]/,
  /^新增[:：]/,
  /\bmq[a-z0-9]{10,}/,       // 记忆 ID 格式
  /[a-z0-9]{12,}\s*\+\s*/,   // ID + ID 合并格式
  /->\s*(新内容|short|medium|long)/,
]

function isJunkContent(content: string): boolean {
  return JUNK_PATTERNS.some(p => p.test(content))
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

// ---------- Observation 提取 prompt ----------

const OBSERVATION_EXTRACTION_PROMPT = `你是行为流记忆提取器。输入是一段 Observation（包含消息完成、工具请求/结果、LLM 用量等事件）。

只提取关于"用户本人"未来对话中可能有用的事实，并对每条候选打置信度。

严格输出 JSON 数组，不要 Markdown，不要任何额外文字：
[
  {
    "content": "用户正在开发 Electron + Vue 的 DeepSeek 桌面客户端",
    "layer": "medium",
    "category": "项目背景",
    "confidence": 0.86,
    "evidence": "用户在消息中明确提到项目"
  }
]

可提取：身份/职业/项目/技术栈/偏好/工作习惯。
不可提取：纯技术知识、网页/工具结果中的外部事实、AI 的建议、闲聊。
禁止包含：API Key、token、密码、cookie、完整本地路径。

字段规则：
- content：自然语言陈述，8-80 字
- layer：short | medium | long
- category：简短主题词（如"项目背景"/"技术栈"/"个人身份"/"偏好习惯"）
- confidence：0 到 1 的浮点数；只有用户本人明确表达的事实才能 >= 0.85；来自工具结果的推断 confidence 不得超过 0.7
- evidence：一句话说明依据来自哪条事件

没有任何可提取内容时，输出 []。`

// ---------- Dreaming prompt ----------

const DREAM_PROMPT = `你是记忆整理助手。用户记忆分三层：短期(当前会话)、中期(几周内)、长期(永久)。

请按以下步骤整理记忆列表：

1. 归类：将相关记忆归入2-5个主题，每个主题起简短名称（如"个人身份"、"技术栈"、"项目背景"、"部署偏好"、"工作习惯"）
2. 合并：同一主题下内容相似/重复的记忆必须合并为一条精炼表述，不要保留多条相似内容
3. 分级：根据重要性分配层级——身份/长期偏好→long，项目/技术→medium，临时信息→short
4. 删除：过时、矛盾、无实质信息的条目（列出其id）
5. 短期记忆如果包含有价值的信息应升级为 medium 或 long，不要大量堆积在短期

重要规则：
- 每条记忆都必须分配一个分类
- 压缩比应控制在50-80%（10条整理为5-8条）
- [记忆] 块中只放整理后的记忆内容，绝对不要混入操作指令、ID编号、合并说明等元信息
- 记忆内容应当是自然语言描述，不包含任何系统标记

输出格式（严格遵循）：
[归类]
个人身份：用户的基本身份信息
技术栈：用户的编程语言和框架偏好

[记忆]
用户叫李明，在北京一家互联网公司担任前端工程师 | long | 个人身份
用户主要使用React和TypeScript，也在学习Vue3 | medium | 技术栈
用户用Electron开发内部桌面工具 | medium | 项目背景

[操作]
合并: abc123 + def456 -> 新内容 | 层级 | 分类
重分类: ghi789 -> 新层级
删除: jkl012

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
    // 清理已有的垃圾条目
    const before = store.value.items.length
    store.value.items = store.value.items.filter(i => !isJunkContent(i.content))
    if (store.value.items.length < before) {
      saveStore(store.value)
    }

    const queryKeywords = extractKeywords(userText)
    const layers: MemoryLayer[] = ['long', 'medium', 'short']
    const sections: string[] = []

    for (const layer of layers) {
      const items = getByLayer(layer)
      if (items.length === 0) continue

      let sorted: { item: MemoryItem; score: number }[]
      if (layer === 'short') {
        // 短期记忆不加门槛：当前会话中提取的直接注入
        sorted = items.map(i => ({ item: i, score: 1 }))
      } else {
        // 中/长期记忆：需要关键词相关度达到最低门槛
        sorted = items
          .map(i => ({ item: i, score: relevanceScore(i, queryKeywords) }))
          .filter(x => x.score >= 0.15)  // 至少 0.15 相关度才注入
          .sort((a, b) => b.score - a.score)
      }

      let budget = TOKEN_BUDGET[layer]
      const selected: string[] = []
      for (const { item } of sorted) {
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
        pinned: false,
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

  /** 从 Observation 批量提炼记忆，按置信度路由：高置信自动写入，低置信进入 pendingPreview */
  async function extractFromObservationBatch(
    observationsText: string,
    apiKey: string,
    options?: { mode?: 'light' | 'batch'; autoThreshold?: number; previewThreshold?: number },
  ): Promise<{ autoAdded: number; previewAdded: number; total: number; rawText?: string; error?: string }> {
    if (!apiKey) return { autoAdded: 0, previewAdded: 0, total: store.value.items.length, error: '无 API Key' }
    if (!observationsText || !observationsText.trim()) {
      return { autoAdded: 0, previewAdded: 0, total: store.value.items.length, error: '无可提炼内容' }
    }

    const AUTO = options?.autoThreshold ?? 0.82
    const PREVIEW = options?.previewThreshold ?? 0.55

    let rawText = ''
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
            { role: 'system', content: OBSERVATION_EXTRACTION_PROMPT },
            { role: 'user', content: observationsText.slice(0, 8000) },
          ],
          thinking: { type: 'disabled' },
          max_tokens: 1200,
        }),
      })
      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        return { autoAdded: 0, previewAdded: 0, total: store.value.items.length, error: `API 返回 ${res.status}: ${errBody.slice(0, 200)}` }
      }
      const data = await res.json()
      rawText = (data.choices?.[0]?.message?.content ?? '').trim()
      if (!rawText) {
        return { autoAdded: 0, previewAdded: 0, total: store.value.items.length, error: 'API 返回内容为空' }
      }

      // 提取 JSON 数组（容忍模型偶尔包裹 markdown）
      const m = rawText.match(/\[[\s\S]*\]/)
      if (!m) {
        console.warn('[ObservationMemory] 未匹配到 JSON 数组:\n', rawText.slice(0, 500))
        return { autoAdded: 0, previewAdded: 0, total: store.value.items.length, rawText, error: '未匹配到 JSON 数组' }
      }
      let candidates: Array<{ content: string; layer: string; category: string; confidence: number; evidence: string }>
      try {
        candidates = JSON.parse(m[0])
      } catch (e) {
        return { autoAdded: 0, previewAdded: 0, total: store.value.items.length, rawText, error: `JSON 解析失败: ${e instanceof Error ? e.message : String(e)}` }
      }
      if (!Array.isArray(candidates) || candidates.length === 0) {
        return { autoAdded: 0, previewAdded: 0, total: store.value.items.length, rawText }
      }

      const now = Date.now()
      const autoItems: MemoryItem[] = []
      const previewItems: Array<{ content: string; layer: MemoryLayer; category: string }> = []

      for (const c of candidates) {
        if (!c || typeof c.content !== 'string') continue
        const content = c.content.trim()
        if (!content || content.length < 4 || content.length > 120) continue
        if (isJunkContent(content)) continue
        const layer: MemoryLayer = (['short', 'medium', 'long'].includes(c.layer) ? c.layer : 'short') as MemoryLayer
        const category = (c.category && typeof c.category === 'string' ? c.category : '未分类').trim() || '未分类'
        const conf = typeof c.confidence === 'number' ? c.confidence : 0
        const evidence = typeof c.evidence === 'string' ? c.evidence : ''

        // long 层要求更高置信度
        const minAuto = layer === 'long' ? Math.max(AUTO, 0.9) : AUTO
        // 主要来自工具结果的候选不自动写入
        const fromTool = /工具结果|工具请求|tool\./i.test(evidence)

        if (conf >= minAuto && !fromTool) {
          autoItems.push({
            id: generateId(),
            content,
            layer,
            category,
            keywords: extractKeywords(content),
            createdAt: now,
            lastAccessedAt: now,
            accessCount: 0,
            pinned: false,
          })
        } else if (conf >= PREVIEW) {
          previewItems.push({ content, layer, category })
        }
        // < PREVIEW 丢弃
      }

      let autoAdded = 0
      if (autoItems.length > 0) {
        autoAdded = autoItems.length
        store.value.items = mergeMemories(store.value.items, autoItems)
        store.value.lastExtractionAt = now
        store.value.newSinceLastDream += autoItems.length
        saveStore(store.value)
      }

      let previewAdded = 0
      if (previewItems.length > 0) {
        if (store.value.pendingPreview) {
          console.warn('[ObservationMemory] 已有 pendingPreview，跳过', previewItems.length, '条低置信候选')
        } else {
          // 构造一个最小可被 DreamPreviewModal 渲染的 DreamPreview
          const ops: DreamPreview['operations'] = previewItems.map(p => ({
            type: 'new' as const,
            description: `新增：${p.content}`,
            targetIds: [],
            resultContent: p.content,
            resultLayer: p.layer,
            resultCategory: p.category,
          }))
          const memBlock = previewItems.map(p => `${p.content} | ${p.layer} | ${p.category}`).join('\n')
          const opBlock = previewItems.map(p => `新增: ${p.content} | ${p.layer} | ${p.category}`).join('\n')
          const fakeRaw = `[归类]\n${[...new Set(previewItems.map(p => p.category))].map(c => `${c}：观测候选`).join('\n')}\n\n[记忆]\n${memBlock}\n\n[操作]\n${opBlock}\n\n[删除]\n`
          const beforeCount = store.value.items.length
          const preview: DreamPreview = {
            timestamp: now,
            operations: ops,
            beforeCount,
            afterCount: beforeCount + previewItems.length,
            categories: [...new Set(previewItems.map(p => p.category))],
            rawText: fakeRaw,
          }
          store.value.pendingPreview = preview
          saveStore(store.value)
          previewAdded = previewItems.length
        }
      }

      console.log(`[ObservationMemory] mode=${options?.mode ?? 'light'} auto=${autoAdded} preview=${previewAdded}`)
      return { autoAdded, previewAdded, total: store.value.items.length, rawText }
    } catch (e: any) {
      console.warn('[ObservationMemory] 提取失败:', e)
      return { autoAdded: 0, previewAdded: 0, total: store.value.items.length, rawText, error: `异常: ${e.message || String(e)}` }
    }
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

    return result.filter(r => !isJunkContent(r.content))
  }

  /** 内部：执行一次 dreaming API 调用，返回 DreamPreview（不修改 store） */
  async function _runDream(apiKey: string): Promise<DreamPreview | null> {
    const pinnedItems = store.value.items.filter(i => i.pinned)
    const unpinnedItems = store.value.items.filter(i => !i.pinned)
    const memoryList = unpinnedItems
      .map(i => `[${i.id}] (${i.layer}) ${i.content}`)
      .join('\n')

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

    if (!res.ok) return null
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content?.trim()
    if (!text) return null

    const parsed = parseDreamResult(text, unpinnedItems)
    parsed.items = [...parsed.items, ...pinnedItems]
    const ops = parseDreamOps(text)

    return {
      timestamp: Date.now(),
      operations: ops,
      beforeCount: unpinnedItems.length,
      afterCount: parsed.items.length,
      categories: parsed.categories,
      rawText: text,
    }
  }

  /** 解析 [操作] 块 */
  function parseDreamOps(text: string): DreamPreview['operations'] {
    const ops: DreamPreview['operations'] = []
    const opMatch = text.match(/\[操作\]([\s\S]*?)(?=\[删除\]|$)/i)
    if (!opMatch) return ops
    const lines = opMatch[1].trim().split('\n').filter(Boolean)
    for (const line of lines) {
      const trimmed = line.replace(/^[-*•\d.]+\s*/, '').trim()
      if (trimmed.startsWith('合并')) {
        const m = trimmed.match(/合并[：:]\s*(.+?)\s*->\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+)/)
        if (m) {
          const ids = m[1].split('+').map(s => s.trim())
          const count = ids.length
          ops.push({
            type: 'merge',
            description: `合并 ${count} 条记忆 → ${m[2].trim()}`,
            targetIds: ids,
            resultContent: m[2].trim(),
            resultLayer: (['short', 'medium', 'long'].includes(m[3].trim()) ? m[3].trim() : 'short') as MemoryLayer,
            resultCategory: m[4].trim(),
          })
        }
      } else if (trimmed.startsWith('重分类')) {
        const m = trimmed.match(/重分类[：:]\s*(.+?)\s*->\s*(.+)/)
        if (m) {
          ops.push({
            type: 'reclassify',
            description: `重分类为 ${m[2].trim()}`,
            targetIds: [m[1].trim()],
            resultLayer: (['short', 'medium', 'long'].includes(m[2].trim()) ? m[2].trim() : 'short') as MemoryLayer,
          })
        }
      } else if (trimmed.startsWith('删除')) {
        const m = trimmed.match(/删除[：:]\s*(.+)/)
        if (m) {
          const ids = m[1].split(/[,，\s]+/).filter(Boolean)
          ops.push({
            type: 'delete',
            description: `删除 ${ids.length} 条记忆`,
            targetIds: ids,
          })
        }
      } else if (trimmed.startsWith('新增')) {
        const m = trimmed.match(/新增[：:]\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+)/)
        if (m) {
          ops.push({
            type: 'new',
            description: `新增：${m[1].trim()}`,
            targetIds: [],
            resultContent: m[1].trim(),
            resultLayer: (['short', 'medium', 'long'].includes(m[2].trim()) ? m[2].trim() : 'short') as MemoryLayer,
            resultCategory: m[3].trim(),
          })
        }
      }
    }
    return ops
  }

  /** Dreaming：AI 驱动的记忆整理 */
  async function dream(apiKey: string, force = false): Promise<void> {
    if (dreaming) return
    if (!force && store.value.items.length === 0) return
    dreaming = true

    try {
      const preview = await _runDream(apiKey)
      if (!preview) { dreaming = false; return }
      approveDream(preview, false)
    } catch (e) {
      console.warn('[Dream] 梦境整理失败:', e)
    } finally {
      dreaming = false
    }
  }

  /** 干跑：调用 API 但不应用结果，存入 pendingPreview */
  async function dreamDryRun(apiKey: string): Promise<DreamPreview | null> {
    if (dreaming) return null
    dreaming = true
    try {
      const preview = await _runDream(apiKey)
      if (preview) {
        store.value.pendingPreview = preview
        saveStore(store.value)
      }
      return preview
    } finally {
      dreaming = false
    }
  }

  /** 确认整理预览 */
  function approveDream(preview: DreamPreview, isManual = true) {
    const result = parseDreamResult(preview.rawText, store.value.items.filter(i => !i.pinned))
    const pinnedItems = store.value.items.filter(i => i.pinned)
    result.items = [...result.items, ...pinnedItems]

    const log: DreamLog = {
      timestamp: Date.now(),
      beforeCount: store.value.items.length,
      afterCount: result.items.length,
      categories: result.categories,
      manual: isManual,
    }

    store.value.items = result.items
    store.value.dreamLogs.push(log)
    store.value.newSinceLastDream = 0
    store.value.pendingPreview = null
    saveStore(store.value)
    console.log('[Dream] 整理完成：', log.beforeCount, '→', log.afterCount, '条')
  }

  /** 拒绝整理预览 */
  function rejectDream() {
    store.value.pendingPreview = null
    saveStore(store.value)
  }

  /** 获取 dreaming 状态 */
  function getDreamStatus() {
    return {
      dreaming,
      pendingPreview: store.value.pendingPreview !== null,
      newSinceLastDream: store.value.newSinceLastDream,
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
    const memMatch = text.match(/\[记忆\]([\s\S]*?)(?=\[操作\]|\[删除\]|$)/i)
    const newItems: MemoryItem[] = []
    if (memMatch) {
      const memLines = memMatch[1].trim().split('\n').filter(Boolean)
      for (const line of memLines) {
        const parts = line.split('|').map(s => s.trim())
        if (parts.length >= 2) {
          const content = parts[0].replace(/^[-*•\d.]+\s*/, '').trim()
          const layer = (parts[1]?.toLowerCase() || 'short') as MemoryLayer
          const category = parts[2] || '未分类'
          // 过滤掉操作性文本和含 ID 的垃圾内容
          if (content.length >= 4 && !isJunkContent(content)) {
            newItems.push({
              id: generateId(),
              content,
              layer: ['short', 'medium', 'long'].includes(layer) ? layer : 'short',
              category,
              keywords: extractKeywords(content),
              createdAt: now,
              lastAccessedAt: now,
              accessCount: 0,
              pinned: false,
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

  /** 切换置顶状态 */
  function togglePin(id: string) {
    const item = store.value.items.find(i => i.id === id)
    if (!item) return
    item.pinned = !item.pinned
    saveStore(store.value)
  }

  /** 搜索记忆（空格分词，每词全部命中才返回） */
  function searchItems(query: string): MemoryItem[] {
    if (!query.trim()) return [...store.value.items]
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return store.value.items.filter(item => {
      const content = item.content.toLowerCase()
      const keywords = item.keywords.join(' ').toLowerCase()
      return terms.every(t => content.includes(t) || keywords.includes(t))
    })
  }

  /** 获取所有分类名 */
  function getAllCategories(): string[] {
    const cats = new Set<string>()
    for (const item of store.value.items) {
      if (item.category && item.category !== '未分类') cats.add(item.category)
    }
    return [...cats].sort()
  }

  /** 按模式排序 */
  function sortItems(items: MemoryItem[], mode: SortMode): MemoryItem[] {
    return [...items].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (mode === 'createdAt') return b.createdAt - a.createdAt
      if (mode === 'lastAccessedAt') return b.lastAccessedAt - a.lastAccessedAt
      return b.accessCount - a.accessCount
    })
  }

  /** 清除所有记忆 */
  function clearAll() {
    store.value = { items: [], lastExtractionAt: 0, dreamLogs: [], newSinceLastDream: 0, pendingPreview: null }
    saveStore(store.value)
  }

  /** 导出记忆数据 */
  function exportData(options: ExportOptions): string {
    let items = [...store.value.items]
    if (options.layers && options.layers.length > 0) {
      items = items.filter(i => options.layers!.includes(i.layer))
    }
    if (options.categories && options.categories.length > 0) {
      items = items.filter(i => options.categories!.includes(i.category))
    }
    if (options.format === 'markdown') {
      const layerLabel: Record<string, string> = { short: '短期', medium: '中期', long: '长期' }
      const groups = new Map<string, MemoryItem[]>()
      for (const item of items) {
        const cat = item.category || '未分类'
        if (!groups.has(cat)) groups.set(cat, [])
        groups.get(cat)!.push(item)
      }
      const md = [`# 记忆导出`, `> 导出时间：${new Date().toLocaleString('zh-CN')}`, `> 共 ${items.length} 条记忆`, '']
      for (const [cat, catItems] of groups) {
        md.push(`## ${cat}`)
        for (const item of catItems) {
          const layer = layerLabel[item.layer] || item.layer
          md.push(`- [${layer}] ${item.content}${item.pinned ? ' 📌' : ''}`)
        }
        md.push('')
      }
      return md.join('\n')
    }
    // JSON
    return JSON.stringify(items, null, 2)
  }

  /** 从 JSON 字符串导入记忆 */
  function importFromJSON(jsonStr: string): { added: number; skipped: number; error?: string } {
    try {
      const incoming = JSON.parse(jsonStr)
      if (!Array.isArray(incoming)) return { added: 0, skipped: 0, error: 'JSON 格式错误：需要数组' }
      const valid = incoming.filter((item: any) => typeof item.content === 'string' && item.content.length >= 4)
      const skipped = incoming.length - valid.length
      const before = store.value.items.length
      store.value.items = mergeMemories(store.value.items, valid.map((item: any) => ({
        id: generateId(),
        content: item.content,
        layer: (['short', 'medium', 'long'].includes(item.layer) ? item.layer : 'short') as MemoryLayer,
        category: item.category || '未分类',
        keywords: extractKeywords(item.content),
        createdAt: item.createdAt || Date.now(),
        lastAccessedAt: item.lastAccessedAt || Date.now(),
        accessCount: item.accessCount || 0,
        pinned: item.pinned ?? false,
      })))
      const added = store.value.items.length - before
      saveStore(store.value)
      return { added, skipped }
    } catch (e: any) {
      return { added: 0, skipped: 0, error: e.message || String(e) }
    }
  }

  /** 选择性清除记忆 */
  function selectiveClear(options: SelectiveClearOptions): number {
    let items = store.value.items
    const before = items.length
    if (options.layers && options.layers.length > 0) {
      items = items.filter(i => !options.layers!.includes(i.layer))
    }
    if (options.categories && options.categories.length > 0) {
      items = items.filter(i => !options.categories!.includes(i.category))
    }
    if (options.olderThanDays !== undefined && options.olderThanDays > 0) {
      const cutoff = Date.now() - options.olderThanDays * 24 * 60 * 60 * 1000
      items = items.filter(i => i.lastAccessedAt >= cutoff)
    }
    const removed = before - items.length
    store.value.items = items
    if (removed > 0) saveStore(store.value)
    return removed
  }

  /** 触发文件下载 */
  function downloadFile(filename: string, content: string) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  /** 记忆增长数据 */
  function getGrowthData(days: 7 | 14 | 30): GrowthPoint[] {
    const now = Date.now()
    const result: GrowthPoint[] = []
    for (let d = days - 1; d >= 0; d--) {
      const dayStart = new Date(now - d * 24 * 60 * 60 * 1000)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = dayStart.getTime() + 24 * 60 * 60 * 1000
      const count = store.value.items.filter(i => i.createdAt < dayEnd).length
      const date = `${dayStart.getMonth() + 1}/${dayStart.getDate()}`
      result.push({ date, count })
    }
    return result
  }

  /** 层级分布 */
  function getLayerDistribution(): LayerDistribution[] {
    const labelMap: Record<MemoryLayer, string> = { short: '短期', medium: '中期', long: '长期' }
    return (['short', 'medium', 'long'] as MemoryLayer[]).map(layer => ({
      layer,
      count: store.value.items.filter(i => i.layer === layer).length,
      label: labelMap[layer],
    }))
  }

  /** 最常访问 Top N */
  function getTopAccessed(limit: number): TopAccessed[] {
    return [...store.value.items]
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, limit)
      .map(i => ({ id: i.id, content: i.content, accessCount: i.accessCount }))
  }

  /** Dreaming 时间线 */
  function getDreamTimeline(): DreamLog[] {
    return [...store.value.dreamLogs].reverse()
  }

  /** 升级短期记忆到中期 */
  function promoteShortTerm() {
    const now = Date.now()
    const dayOld = now - 24 * 60 * 60 * 1000
    let changed = false
    for (const item of store.value.items) {
      if (item.layer === 'short' && (item.createdAt < dayOld || item.accessCount >= 2)) {
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
    searchItems,
    getAllCategories,
    sortItems,
    extractFromExchange,
    extractFromObservationBatch,
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
