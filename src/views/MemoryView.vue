<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useMemory } from '@/composables/useMemory'
import { useSettingsStore } from '@/stores/settings'
import type { MemoryLayer, MemoryItem, SortMode } from '@/types/memory'
import MemoryCard from '@/components/memory/MemoryCard.vue'
import DreamPreviewModal from '@/components/memory/DreamPreviewModal.vue'
import type { DreamPreview } from '@/types/memory'

const router = useRouter()
const memory = useMemory()
const settings = useSettingsStore()

const filterLayer = ref<MemoryLayer | 'all'>('all')
const expandedCats = ref<Set<string>>(new Set())
const searchQuery = ref('')
const searchInput = ref('')   // 实际输入框绑定值
const selectedCategories = ref<Set<string>>(new Set())
const sortMode = ref<SortMode>('lastAccessedAt')
const viewMode = ref<'list' | 'insights'>('list')
const growthDays = ref<7 | 14 | 30>(14)

// 200ms 防抖
let debounceTimer: ReturnType<typeof setTimeout> | null = null
watch(searchInput, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { searchQuery.value = val }, 200)
})

const layerLabels: Record<MemoryLayer, string> = { short: '短期', medium: '中期', long: '长期' }
const layerTabs: { key: MemoryLayer | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'short', label: '短期' },
  { key: 'medium', label: '中期' },
  { key: 'long', label: '长期' },
]

const sortLabels: Record<SortMode, string> = {
  createdAt: '创建时间',
  lastAccessedAt: '最近访问',
  accessCount: '访问次数',
}

const allCategories = computed(() => memory.getAllCategories())

const searchResults = computed(() => {
  let items = memory.store.value.items
  if (filterLayer.value !== 'all') {
    items = items.filter(i => i.layer === filterLayer.value)
  }
  return memory.searchItems(searchQuery.value).filter(i => items.includes(i))
})

const filteredItems = computed(() => {
  let items = searchResults.value
  if (selectedCategories.value.size > 0) {
    items = items.filter(i => selectedCategories.value.has(i.category || '未分类'))
  }
  return memory.sortItems(items, sortMode.value)
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

function toggleCategoryFilter(cat: string) {
  const next = new Set(selectedCategories.value)
  if (next.has(cat)) { next.delete(cat) } else { next.add(cat) }
  selectedCategories.value = next
}

function clearFilters() {
  searchInput.value = ''
  searchQuery.value = ''
  selectedCategories.value = new Set()
}

// 数据管理
const importToast = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

function handleExport(format: 'json' | 'markdown') {
  const content = memory.exportData({ format })
  const ext = format === 'json' ? 'json' : 'md'
  const ts = new Date().toISOString().slice(0, 10)
  memory.downloadFile(`memory-export-${ts}.${ext}`, content)
}

function handleImportClick() {
  fileInput.value?.click()
}

function handleFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const result = memory.importFromJSON(reader.result as string)
    if (result.error) {
      importToast.value = `导入失败：${result.error}`
    } else {
      importToast.value = `导入完成：新增 ${result.added} 条，跳过重复 ${result.skipped} 条`
    }
    setTimeout(() => { importToast.value = '' }, 4000)
    input.value = ''
  }
  reader.readAsText(file)
}

const showClearPanel = ref(false)
const clearLayers = ref<MemoryLayer[]>([])
const clearDays = ref<number | null>(null)

function toggleClearLayer(layer: MemoryLayer) {
  const idx = clearLayers.value.indexOf(layer)
  if (idx >= 0) { clearLayers.value.splice(idx, 1) } else { clearLayers.value.push(layer) }
}

function handleSelectiveClear() {
  const removed = memory.selectiveClear({
    layers: clearLayers.value.length > 0 ? clearLayers.value : undefined,
    olderThanDays: clearDays.value ?? undefined,
  })
  importToast.value = `已清除 ${removed} 条记忆`
  setTimeout(() => { importToast.value = '' }, 3000)
  showClearPanel.value = false
  clearLayers.value = []
  clearDays.value = null
}

// 手动 Dreaming
const showPreview = ref(false)
const dreamingBusy = ref(false)

const dreamStatus = computed(() => memory.getDreamStatus())

async function handleManualDream() {
  if (!settings.apiKey || dreamingBusy.value) return
  dreamingBusy.value = true
  try {
    const preview = await memory.dreamDryRun(settings.apiKey)
    if (preview) {
      showPreview.value = true
    }
  } finally {
    dreamingBusy.value = false
  }
}

function handleApprove(preview: DreamPreview) {
  memory.approveDream(preview, true)
  showPreview.value = false
}

function handleReject() {
  memory.rejectDream()
  showPreview.value = false
}

// 洞察数据
const growthData = computed(() => memory.getGrowthData(growthDays.value))
const layerDist = computed(() => memory.getLayerDistribution())
const topAccessed = computed(() => memory.getTopAccessed(10))
const dreamTimeline = computed(() => memory.getDreamTimeline())

// SVG 环形图数据
const donutTotal = computed(() => layerDist.value.reduce((s, d) => s + d.count, 0) || 1)
const donutColors: Record<MemoryLayer, string> = { short: '#3b82f6', medium: '#f59e0b', long: '#10b981' }
function donutSegments() {
  let offset = 0
  const total = donutTotal.value
  return layerDist.value.filter(d => d.count > 0).map(d => {
    const pct = d.count / total
    const seg = { ...d, pct, offset }
    offset += pct
    return seg
  })
}

// 折线图数据
const chartMaxY = computed(() => Math.max(...growthData.value.map(p => p.count), 1))
function growthPolyline(): string {
  const w = 580; const h = 120; const pad = 20
  const pts = growthData.value
  if (pts.length < 2) return ''
  const xStep = (w - pad * 2) / (pts.length - 1)
  const yScale = (h - pad * 2) / (chartMaxY.value || 1)
  return pts.map((p, i) => {
    const x = pad + i * xStep
    const y = h - pad - p.count * yScale
    return `${i === 0 ? 'M' : 'L'}${x},${y}`
  }).join(' ')
}

function handleUpdate(id: string, updates: Partial<Pick<MemoryItem, 'content' | 'layer' | 'category'>>) {
  memory.updateItem(id, updates)
}

function handleDelete(id: string) {
  memory.deleteItem(id)
}

function handlePin(id: string) {
  memory.togglePin(id)
}
</script>

<template>
  <div class="flex-1 flex flex-col min-w-0 bg-app-bg">
    <!-- 顶栏 -->
    <div class="flex items-center gap-3 px-6 py-3 border-b border-app-border">
      <button
        @click="router.push('/')"
        class="w-7 h-7 flex items-center justify-center rounded-md text-app-muted hover:bg-app-card transition-colors"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <h1 class="text-base font-semibold text-app-text">记忆管理</h1>
      <div class="flex items-center gap-0.5 ml-auto bg-app-hover rounded-lg p-0.5">
        <button
          @click="viewMode = 'list'"
          class="px-3 py-1 text-xs rounded-md transition-colors"
          :class="viewMode === 'list' ? 'bg-white text-app-text shadow-sm font-medium' : 'text-app-muted hover:text-app-text'"
        >列表</button>
        <button
          @click="viewMode = 'insights'"
          class="px-3 py-1 text-xs rounded-md transition-colors"
          :class="viewMode === 'insights' ? 'bg-white text-app-text shadow-sm font-medium' : 'text-app-muted hover:text-app-text'"
        >洞察</button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto px-6 py-5">

      <!-- ===== 洞察视图 ===== -->
      <template v-if="viewMode === 'insights'">
        <div class="grid grid-cols-2 gap-5">
          <!-- 增长曲线 -->
          <div class="col-span-2 border border-app-border rounded-xl p-5 bg-app-card">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-sm font-semibold text-app-heading">记忆增长</h3>
              <div class="flex gap-1 bg-app-hover rounded-lg p-0.5">
                <button
                  v-for="d in ([7, 14, 30] as const)"
                  :key="d"
                  @click="growthDays = d"
                  class="text-[10px] px-2 py-0.5 rounded-md transition-colors"
                  :class="growthDays === d ? 'bg-white text-app-text shadow-sm font-medium' : 'text-app-muted hover:text-app-text'"
                >{{ d }}天</button>
              </div>
            </div>
            <svg viewBox="0 0 580 140" class="w-full h-32">
              <line v-for="n in 4" :key="n" :x1="20" :y1="20 + n * 25" :x2="560" :y2="20 + n * 25" class="stroke-app-border/40" stroke-width="0.5" />
              <text v-for="n in 4" :key="n" x="16" :y="24 + n * 25" text-anchor="end" class="fill-app-muted text-[8px]">{{ Math.round(chartMaxY * (4 - n) / 4) }}</text>
              <path :d="growthPolyline()" fill="none" class="stroke-app-accent" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              <circle
                v-for="(pt, i) in growthData"
                :key="i"
                :cx="20 + (i / Math.max(growthData.length - 1, 1)) * 540"
                :cy="140 - 20 - (pt.count / Math.max(chartMaxY, 1)) * 100"
                r="3"
                class="fill-app-accent"
              />
              <text
                v-for="(pt, i) in growthData"
                :key="'x'+i"
                :x="20 + (i / Math.max(growthData.length - 1, 1)) * 540"
                y="138"
                text-anchor="middle"
                class="fill-app-muted text-[7px]"
                v-show="growthData.length <= 14 || i % 2 === 0"
              >{{ pt.date }}</text>
            </svg>
          </div>

          <!-- 层级分布环形图 -->
          <div class="border border-app-border rounded-xl p-5 bg-app-card">
            <h3 class="text-sm font-semibold text-app-heading mb-4">层级分布</h3>
            <div class="flex items-center gap-4">
              <svg viewBox="0 0 120 120" class="w-28 h-28">
                <circle cx="60" cy="60" r="40" fill="none" stroke="currentColor" class="text-app-border/30" stroke-width="16" />
                <circle
                  v-for="seg in donutSegments()"
                  :key="seg.layer"
                  cx="60" cy="60" r="40"
                  fill="none"
                  :stroke="donutColors[seg.layer]"
                  stroke-width="16"
                  :stroke-dasharray="`${seg.pct * 251.3} ${(1 - seg.pct) * 251.3}`"
                  :stroke-dashoffset="251.3 - seg.offset * 251.3"
                  transform="rotate(-90 60 60)"
                  stroke-linecap="butt"
                />
                <text x="60" y="56" text-anchor="middle" class="fill-app-text font-bold text-sm">{{ donutTotal }}</text>
                <text x="60" y="70" text-anchor="middle" class="fill-app-muted text-[8px]">总计</text>
              </svg>
              <div class="space-y-2">
                <div v-for="d in layerDist" :key="d.layer" class="flex items-center gap-2 text-xs">
                  <span class="w-2.5 h-2.5 rounded-full shrink-0" :style="{ backgroundColor: donutColors[d.layer] }"></span>
                  <span class="text-app-text">{{ d.label }}</span>
                  <span class="text-app-muted">{{ d.count }} 条</span>
                  <span class="text-app-muted">({{ Math.round(d.count / donutTotal * 100) }}%)</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 最常访问 -->
          <div class="border border-app-border rounded-xl p-5 bg-app-card">
            <h3 class="text-sm font-semibold text-app-heading mb-4">最常访问</h3>
            <div v-if="topAccessed.length === 0" class="text-xs text-app-muted text-center py-6">暂无数据</div>
            <div v-else class="space-y-1.5 max-h-[200px] overflow-y-auto">
              <div
                v-for="(item, idx) in topAccessed"
                :key="item.id"
                class="flex items-center gap-2 text-xs"
              >
                <span class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium shrink-0"
                  :class="{
                    'bg-app-accent text-white': idx < 3,
                    'bg-app-hover text-app-muted': idx >= 3,
                  }"
                >{{ idx + 1 }}</span>
                <span class="text-app-text truncate flex-1">{{ item.content }}</span>
                <span class="text-app-muted shrink-0">{{ item.accessCount }} 次</span>
              </div>
            </div>
          </div>

          <!-- Dreaming 时间线 -->
          <div class="col-span-2 border border-app-border rounded-xl p-5 bg-app-card">
            <h3 class="text-sm font-semibold text-app-heading mb-4">整理记录</h3>
            <div v-if="dreamTimeline.length === 0" class="text-xs text-app-muted text-center py-6">暂无整理记录</div>
            <div v-else class="space-y-0">
              <div v-for="log in dreamTimeline" :key="log.timestamp" class="flex gap-4">
                <div class="flex flex-col items-center shrink-0">
                  <div class="w-2.5 h-2.5 rounded-full border-2"
                    :class="log.manual ? 'border-app-accent bg-app-accent-soft' : 'border-gray-300 bg-gray-100'"
                  ></div>
                  <div class="w-px flex-1 bg-app-border/60 min-h-[16px]"></div>
                </div>
                <div class="pb-4 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-app-text font-medium">
                      {{ log.beforeCount }} → {{ log.afterCount }} 条
                    </span>
                    <span v-if="log.manual" class="text-[10px] px-1 rounded bg-app-accent-soft text-app-accent">手动</span>
                    <span v-else class="text-[10px] px-1 rounded bg-gray-100 text-gray-500">自动</span>
                  </div>
                  <p class="text-[10px] text-app-muted mt-0.5">{{ new Date(log.timestamp).toLocaleString('zh-CN') }}</p>
                  <p v-if="log.categories.length > 0" class="text-[10px] text-app-muted mt-0.5">
                    分类：{{ log.categories.join('、') }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- ===== 列表视图 ===== -->
      <template v-else>

      <!-- === 工具栏 === -->
      <div class="flex items-center justify-between mb-4 pb-4 border-b border-app-border">
        <div class="flex items-center gap-2">
          <button @click="handleExport('json')" class="text-xs px-3 py-1.5 rounded-lg border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover transition-colors">
            导出 JSON
          </button>
          <button @click="handleExport('markdown')" class="text-xs px-3 py-1.5 rounded-lg border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover transition-colors">
            导出 Markdown
          </button>
          <button @click="handleImportClick" class="text-xs px-3 py-1.5 rounded-lg border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover transition-colors">
            导入
          </button>
          <input ref="fileInput" type="file" accept=".json" class="hidden" @change="handleFileChange" />
          <div class="relative">
            <button
              @click="showClearPanel = !showClearPanel"
              class="text-xs px-3 py-1.5 rounded-lg border transition-colors"
              :class="showClearPanel ? 'border-red-300 bg-red-50 text-red-600' : 'border-app-border text-app-muted hover:text-red-500 hover:border-red-300'"
            >选择性清除</button>
            <!-- 清除弹出面板 -->
            <div v-if="showClearPanel" class="absolute top-full left-0 mt-2 w-80 p-4 rounded-xl border border-app-border bg-white shadow-xl z-30">
              <p class="text-xs font-medium text-app-heading mb-3">选择性清除</p>
              <div class="flex flex-wrap items-center gap-1.5 mb-3">
                <span class="text-[10px] text-app-muted mr-1">层级：</span>
                <button
                  v-for="layer in (['short', 'medium', 'long'] as MemoryLayer[])"
                  :key="layer"
                  @click="toggleClearLayer(layer)"
                  class="text-[10px] px-2 py-0.5 rounded-full border transition-colors"
                  :class="clearLayers.includes(layer)
                    ? 'border-red-400 bg-red-50 text-red-600'
                    : 'border-app-border text-app-muted hover:text-app-text'"
                >{{ layerLabels[layer] }}</button>
              </div>
              <div class="flex items-center gap-2 mb-3">
                <span class="text-[10px] text-app-muted whitespace-nowrap">N天未访问：</span>
                <input
                  v-model.number="clearDays"
                  type="number" min="1" placeholder="如 30"
                  class="w-20 text-xs px-2 py-1 rounded border border-app-border bg-app-card text-app-text focus:outline-none focus:border-app-accent"
                />
              </div>
              <div class="flex items-center justify-between">
                <button @click="showClearPanel = false" class="text-xs text-app-muted hover:text-app-text">取消</button>
                <button
                  @click="handleSelectiveClear"
                  :disabled="clearLayers.length === 0 && !clearDays"
                  class="text-xs px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-40 transition-colors"
                >确认清除</button>
              </div>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <span v-if="lastDreamLog" class="text-[11px] text-app-muted">
            上次整理 {{ new Date(lastDreamLog.timestamp).toLocaleDateString('zh-CN', { month:'short', day:'numeric' }) }}
            · {{ lastDreamLog.beforeCount }}→{{ lastDreamLog.afterCount }} 条
          </span>
          <button
            @click="handleManualDream"
            :disabled="dreamingBusy"
            class="text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors"
            :class="dreamStatus.newSinceLastDream >= 10
              ? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
              : 'border-app-border text-app-muted hover:bg-app-hover hover:text-app-text'"
          >
            <span v-if="dreamingBusy" class="inline-flex items-center gap-1">
              <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              整理中
            </span>
            <span v-else>整理记忆
              <span v-if="dreamStatus.newSinceLastDream > 0" class="ml-0.5 opacity-70">({{ dreamStatus.newSinceLastDream }})</span>
            </span>
          </button>
        </div>
      </div>

      <!-- 提示消息 -->
      <div v-if="importToast" class="mb-4 px-4 py-2.5 rounded-xl text-xs font-medium bg-app-accent-soft text-app-accent border border-app-accent/20 flex items-center justify-between">
        <span>{{ importToast }}</span>
        <button @click="importToast = ''" class="text-app-accent/60 hover:text-app-accent">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- === 统计卡片 === -->
      <div class="grid grid-cols-4 gap-3 mb-5">
        <div
          v-for="card in [
            { key: 'all', label: '全部记忆', count: layerCounts.all, color: 'text-app-heading', bg: 'bg-app-hover' },
            { key: 'short', label: '短期记忆', count: layerCounts.short, color: 'text-blue-600', bg: 'bg-blue-50' },
            { key: 'medium', label: '中期记忆', count: layerCounts.medium, color: 'text-amber-600', bg: 'bg-amber-50' },
            { key: 'long', label: '长期记忆', count: layerCounts.long, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          ]"
          :key="card.key"
          class="rounded-xl border border-app-border px-4 py-3 cursor-pointer transition-all hover:shadow-sm"
          :class="(filterLayer === card.key || (card.key === 'all' && filterLayer === 'all')) ? 'bg-app-card shadow-sm' : 'bg-app-card/50'"
          @click="filterLayer = card.key as MemoryLayer | 'all'"
        >
          <p class="text-[10px] text-app-muted mb-0.5">{{ card.label }}</p>
          <p class="text-2xl font-bold" :class="card.color">{{ card.count }}</p>
        </div>
      </div>

      <!-- === 过滤栏 === -->
      <div class="border border-app-border rounded-xl bg-app-card p-3 mb-5">
        <div class="flex items-center gap-3">
          <!-- 搜索 -->
          <div class="relative flex-1 max-w-xs">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-app-muted/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              v-model="searchInput"
              type="text" placeholder="搜索记忆..."
              class="w-full pl-8 pr-8 py-1.5 text-xs rounded-lg border border-app-border bg-app-bg
                     text-app-text placeholder:text-app-muted/50 focus:outline-none focus:border-app-accent transition-colors"
            />
            <button
              v-if="searchInput"
              @click="searchInput = ''; searchQuery = ''"
              class="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center
                     rounded-full text-app-muted/50 hover:text-app-muted transition-colors"
            >
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- 分类标签 -->
          <div v-if="allCategories.length > 0" class="flex flex-wrap items-center gap-1 min-w-0">
            <button
              v-for="cat in allCategories.slice(0, 6)"
              :key="cat"
              @click="toggleCategoryFilter(cat)"
              class="text-[10px] px-2 py-0.5 rounded-full border whitespace-nowrap transition-colors"
              :class="selectedCategories.has(cat)
                ? 'border-app-accent bg-app-accent-soft text-app-accent'
                : 'border-app-border text-app-muted hover:text-app-text hover:border-app-text'"
            >{{ cat }}</button>
            <span v-if="allCategories.length > 6" class="text-[10px] text-app-muted">+{{ allCategories.length - 6 }}</span>
          </div>

          <!-- 排序 -->
          <select
            v-model="sortMode"
            class="text-xs px-2.5 py-1.5 rounded-lg border border-app-border bg-app-bg text-app-text
                   focus:outline-none focus:border-app-accent appearance-none cursor-pointer shrink-0"
          >
            <option v-for="(label, key) in sortLabels" :key="key" :value="key">{{ label }}</option>
          </select>

          <!-- 清除筛选 -->
          <button
            v-if="searchInput || selectedCategories.size > 0 || filterLayer !== 'all'"
            @click="clearFilters(); filterLayer = 'all'"
            class="text-[10px] text-app-accent hover:underline whitespace-nowrap shrink-0"
          >重置</button>
        </div>

        <!-- 层级筛选 -->
        <div class="flex items-center gap-1.5 mt-3 pt-3 border-t border-app-border/60">
          <span class="text-[10px] text-app-muted mr-1">层级：</span>
          <button
            v-for="tab in layerTabs"
            :key="tab.key"
            @click="filterLayer = tab.key"
            class="px-2.5 py-0.5 text-[10px] rounded-full border transition-colors"
            :class="filterLayer === tab.key
              ? 'border-app-accent bg-app-accent-soft text-app-accent font-medium'
              : 'border-transparent text-app-muted hover:text-app-text hover:bg-app-hover'"
          >
            {{ tab.label }}
            <span class="ml-0.5 opacity-50">({{ layerCounts[tab.key] }})</span>
          </button>
        </div>
      </div>

      <!-- === 内容区 === -->
      <!-- 空状态 -->
      <div v-if="filteredItems.length === 0" class="text-center py-16">
        <svg class="w-14 h-14 mx-auto text-app-muted/20 mb-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        <p class="text-sm text-app-muted font-medium">还没有记忆</p>
        <p class="text-xs text-app-muted mt-1.5">多聊几句，AI 会自动提取关于你的信息</p>
      </div>

      <!-- 按分类展示 -->
      <div v-else class="space-y-3">
        <div
          v-for="[cat, items] in groupedByCategory"
          :key="cat"
          class="border border-app-border rounded-xl overflow-hidden bg-app-card"
        >
          <button
            @click="toggleCategory(cat)"
            class="w-full flex items-center justify-between px-4 py-3 hover:bg-app-hover/50 transition-colors text-left"
          >
            <div class="flex items-center gap-2.5">
              <svg
                class="w-3.5 h-3.5 text-app-muted transition-transform"
                :class="{ 'rotate-90': expandedCats.has(cat) }"
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
              <span class="text-sm font-semibold text-app-heading">{{ cat }}</span>
              <span class="text-[11px] text-app-muted bg-app-hover px-1.5 py-0.5 rounded-full">{{ items.length }}</span>
            </div>
          </button>
          <div v-if="expandedCats.has(cat)" class="px-4 pb-4 space-y-2">
            <MemoryCard
              v-for="item in items"
              :key="item.id"
              :item="item"
              :highlight="searchQuery"
              @update="handleUpdate"
              @delete="handleDelete"
              @pin="handlePin"
            />
          </div>
        </div>
      </div>

      </template>
    </div>

    <!-- Dreaming 预览弹窗 -->
    <DreamPreviewModal
      v-if="showPreview && memory.store.value.pendingPreview"
      :preview="memory.store.value.pendingPreview"
      @approve="handleApprove"
      @reject="handleReject"
    />
  </div>
</template>
