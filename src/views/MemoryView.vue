<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useMemory } from '@/composables/useMemory'
import { useSettingsStore } from '@/stores/settings'
import type { MemoryLayer, MemoryItem } from '@/types/memory'
import MemoryCard from '@/components/memory/MemoryCard.vue'

const router = useRouter()
const memory = useMemory()
const settings = useSettingsStore()

const filterLayer = ref<MemoryLayer | 'all'>('all')
const expandedCats = ref<Set<string>>(new Set())

const layerLabels: Record<MemoryLayer, string> = { short: '短期', medium: '中期', long: '长期' }
const layerTabs: { key: MemoryLayer | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'short', label: '短期' },
  { key: 'medium', label: '中期' },
  { key: 'long', label: '长期' },
]

const filteredItems = computed(() => {
  let items = memory.store.value.items
  if (filterLayer.value !== 'all') {
    items = items.filter(i => i.layer === filterLayer.value)
  }
  return items.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
})

const groupedByCategory = computed(() => {
  const map = new Map<string, MemoryItem[]>()
  for (const item of filteredItems.value) {
    const cat = item.category || '未分类'
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat)!.push(item)
  }
  return map
})

const layerCounts = computed(() => {
  const all = memory.store.value.items
  return {
    all: all.length,
    short: all.filter(i => i.layer === 'short').length,
    medium: all.filter(i => i.layer === 'medium').length,
    long: all.filter(i => i.layer === 'long').length,
  }
})

const lastDreamLog = computed(() => {
  const logs = memory.store.value.dreamLogs
  return logs.length > 0 ? logs[logs.length - 1] : null
})

function toggleCategory(cat: string) {
  if (expandedCats.value.has(cat)) {
    expandedCats.value.delete(cat)
  } else {
    expandedCats.value.add(cat)
  }
}

function handleUpdate(id: string, updates: Partial<Pick<MemoryItem, 'content' | 'layer' | 'category'>>) {
  memory.updateItem(id, updates)
}

function handleDelete(id: string) {
  memory.deleteItem(id)
}
</script>

<template>
  <div class="flex-1 flex flex-col min-w-0 bg-app-bg">
    <!-- 顶栏 -->
    <div class="flex items-center gap-3 px-5 py-3 border-b border-app-border">
      <button
        @click="router.push('/')"
        class="w-7 h-7 flex items-center justify-center rounded-md text-app-muted hover:bg-app-card transition-colors"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <h1 class="text-base font-semibold text-app-text">记忆管理</h1>
    </div>

    <!-- 内容区 -->
    <div class="flex-1 overflow-y-auto px-8 py-6">
      <!-- 统计条 -->
      <div class="mb-4 flex items-center justify-between">
        <div class="flex items-center gap-4 text-sm text-app-muted">
          <span>共 <b class="text-app-text">{{ layerCounts.all }}</b> 条记忆</span>
          <span class="text-blue-600">短期 {{ layerCounts.short }}</span>
          <span class="text-amber-600">中期 {{ layerCounts.medium }}</span>
          <span class="text-emerald-600">长期 {{ layerCounts.long }}</span>
        </div>
        <div v-if="lastDreamLog" class="text-xs text-app-muted">
          上次整理：{{ new Date(lastDreamLog.timestamp).toLocaleString('zh-CN') }}，
          从 {{ lastDreamLog.beforeCount }} → {{ lastDreamLog.afterCount }} 条
        </div>
      </div>

      <!-- 层级筛选 -->
      <div class="flex gap-1.5 mb-5">
        <button
          v-for="tab in layerTabs"
          :key="tab.key"
          @click="filterLayer = tab.key"
          class="px-3 py-1 text-xs rounded-full border transition-colors"
          :class="filterLayer === tab.key
            ? 'border-app-accent bg-app-accent-soft text-app-accent font-medium'
            : 'border-app-border text-app-muted hover:text-app-text hover:border-app-text'"
        >
          {{ tab.label }}
          <span class="ml-0.5 opacity-60">({{ layerCounts[tab.key] }})</span>
        </button>
      </div>

      <!-- 空状态 -->
      <div v-if="filteredItems.length === 0" class="text-center py-20">
        <svg class="w-12 h-12 mx-auto text-app-muted/40 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        <p class="text-sm text-app-muted">还没有记忆</p>
        <p class="text-xs text-app-muted mt-1">多聊几句，AI 会自动提取记忆</p>
      </div>

      <!-- 按分类展示 -->
      <div v-else class="space-y-4">
        <div
          v-for="[cat, items] in groupedByCategory"
          :key="cat"
          class="border border-app-border rounded-xl overflow-hidden"
        >
          <button
            @click="toggleCategory(cat)"
            class="w-full flex items-center justify-between px-4 py-2.5 bg-app-card hover:bg-app-hover transition-colors text-left"
          >
            <div class="flex items-center gap-2">
              <svg
                class="w-3.5 h-3.5 text-app-muted transition-transform"
                :class="{ 'rotate-90': expandedCats.has(cat) }"
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
              <span class="text-sm font-medium text-app-heading">{{ cat }}</span>
              <span class="text-xs text-app-muted">({{ items.length }})</span>
            </div>
          </button>
          <div v-if="expandedCats.has(cat)" class="px-4 pb-3 space-y-2">
            <MemoryCard
              v-for="item in items"
              :key="item.id"
              :item="item"
              @update="handleUpdate"
              @delete="handleDelete"
            />
          </div>
        </div>
      </div>

    </div>
  </div>
</template>
