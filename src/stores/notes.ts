import { defineStore } from 'pinia'
import { ref, watch, computed } from 'vue'
import { INSIGHT_COLORS } from '@/types/notes'
import type { Insight, InsightInput, Notebook } from '@/types/notes'

const STORAGE_KEY = 'ds_notes'
const NOTEBOOKS_KEY = 'ds_notebooks'

function loadInsights(): Insight[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function loadNotebooks(): Notebook[] {
  try {
    const raw = localStorage.getItem(NOTEBOOKS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Partial<Notebook>[]
    // 兼容旧数据：缺失 parentId 时补 null
    return parsed.map(nb => ({
      id: nb.id!,
      name: nb.name!,
      color: nb.color!,
      createdAt: nb.createdAt ?? Date.now(),
      order: nb.order ?? 0,
      parentId: nb.parentId ?? null,
    }))
  } catch { return [] }
}

/** 生成唯一 ID */
function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export const useNotesStore = defineStore('notes', () => {
  const insights = ref<Insight[]>(loadInsights())
  const notebooks = ref<Notebook[]>(loadNotebooks())

  // 持久化到 localStorage
  watch(insights, (val) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(val)) }
    catch { /* quota exceeded — 静默失败 */ }
  }, { deep: true })

  watch(notebooks, (val) => {
    try { localStorage.setItem(NOTEBOOKS_KEY, JSON.stringify(val)) }
    catch { /* quota exceeded — 静默失败 */ }
  }, { deep: true })

  // ===== 计算属性 =====

  /** 所有去重标签 */
  const allTags = computed(() => {
    const set = new Set<string>()
    for (const ins of insights.value) {
      for (const tag of ins.tags) set.add(tag)
    }
    return [...set].sort()
  })

  /** insight 总数 */
  const count = computed(() => insights.value.length)

  /** 按 order 排序的笔记本列表 */
  const allNotebooks = computed(() =>
    [...notebooks.value].sort((a, b) => a.order - b.order)
  )

  /** 顶级笔记本（parentId === null） */
  const topLevelNotebooks = computed(() =>
    allNotebooks.value.filter(nb => nb.parentId === null)
  )

  /** 获取某个父笔记本的所有子笔记本 */
  function childrenOf(parentId: string): Notebook[] {
    return allNotebooks.value.filter(nb => nb.parentId === parentId)
  }

  /** 获取指定笔记本下的笔记数量（仅自身） */
  function notebookCount(notebookId: string): number {
    return insights.value.filter(i => i.notebookId === notebookId).length
  }

  /** 获取指定笔记本下的笔记数量（自身 + 所有子笔记本） */
  function notebookCountDeep(notebookId: string): number {
    const childIds = childrenOf(notebookId).map(c => c.id)
    const allowed = new Set([notebookId, ...childIds])
    return insights.value.filter(i => i.notebookId !== null && allowed.has(i.notebookId)).length
  }

  // ===== Insight 操作 =====

  /** 添加 insight */
  function addInsight(input: InsightInput): Insight {
    const insight: Insight = {
      ...input,
      id: genId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      note: '',
      notebookId: input.notebookId ?? null,
    }
    insights.value = [insight, ...insights.value]
    return insight
  }

  /** 创建空白笔记（手动新建，content 为空） */
  function createBlankInsight(notebookId: string | null): Insight {
    return addInsight({
      content: '',
      sourceMessageId: '',
      sourceSessionId: '',
      sourceRole: 'user',
      tags: [],
      color: INSIGHT_COLORS[3],
      notebookId,
    })
  }

  /** 更新 insight */
  function updateInsight(id: string, updates: Partial<Pick<Insight, 'content' | 'note' | 'tags' | 'color' | 'notebookId'>>) {
    const idx = insights.value.findIndex(i => i.id === id)
    if (idx === -1) return
    insights.value[idx] = {
      ...insights.value[idx],
      ...updates,
      updatedAt: Date.now(),
    }
  }

  /** 删除 insight */
  function deleteInsight(id: string) {
    insights.value = insights.value.filter(i => i.id !== id)
  }

  /** 批量删除 */
  function deleteMultiple(ids: string[]) {
    const set = new Set(ids)
    insights.value = insights.value.filter(i => !set.has(i.id))
  }

  /** 批量添加标签 */
  function addTagToMultiple(ids: string[], tag: string) {
    const set = new Set(ids)
    for (const ins of insights.value) {
      if (set.has(ins.id) && !ins.tags.includes(tag)) {
        ins.tags = [...ins.tags, tag]
        ins.updatedAt = Date.now()
      }
    }
  }

  /** 清空所有 */
  function clearAll() {
    insights.value = []
    localStorage.removeItem(STORAGE_KEY)
  }

  // ===== 笔记本操作 =====

  /** 创建笔记本（可选 parentId 指向顶级笔记本） */
  function createNotebook(name: string, color: string, parentId: string | null = null): Notebook {
    const maxOrder = notebooks.value.reduce((max, nb) => Math.max(max, nb.order), 0)
    const notebook: Notebook = {
      id: genId(),
      name,
      color,
      createdAt: Date.now(),
      order: maxOrder + 1,
      parentId,
    }
    notebooks.value = [...notebooks.value, notebook]
    return notebook
  }

  /** 重命名笔记本 */
  function renameNotebook(id: string, name: string) {
    const idx = notebooks.value.findIndex(nb => nb.id === id)
    if (idx === -1) return
    notebooks.value[idx] = { ...notebooks.value[idx], name }
  }

  /** 删除笔记本（解绑关联笔记；若是父笔记本，子笔记本提升为顶级） */
  function deleteNotebook(id: string) {
    // 子笔记本提升为顶级
    notebooks.value = notebooks.value.map(nb =>
      nb.parentId === id ? { ...nb, parentId: null } : nb
    )
    // 删除自身
    notebooks.value = notebooks.value.filter(nb => nb.id !== id)
    // 关联笔记的 notebookId 设为 null
    for (const ins of insights.value) {
      if (ins.notebookId === id) {
        ins.notebookId = null
        ins.updatedAt = Date.now()
      }
    }
  }

  /** 重排笔记本顺序 */
  function reorderNotebooks(orderedIds: string[]) {
    const map = new Map(notebooks.value.map(nb => [nb.id, nb]))
    notebooks.value = orderedIds
      .map((id, i) => {
        const nb = map.get(id)
        return nb ? { ...nb, order: i } : null
      })
      .filter(Boolean) as Notebook[]
  }

  return {
    insights,
    notebooks,
    allTags,
    count,
    allNotebooks,
    topLevelNotebooks,
    childrenOf,
    notebookCount,
    notebookCountDeep,
    addInsight,
    createBlankInsight,
    updateInsight,
    deleteInsight,
    deleteMultiple,
    addTagToMultiple,
    clearAll,
    createNotebook,
    renameNotebook,
    deleteNotebook,
    reorderNotebooks,
  }
})
