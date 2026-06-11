<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useMemory } from '@/composables/useMemory'
import { useSettingsStore } from '@/stores/settings'
import type { MemoryLayer, MemoryItem, SortMode } from '@/types/memory'
import MemoryCard from '@/components/memory/MemoryCard.vue'
import DreamPreviewModal from '@/components/memory/DreamPreviewModal.vue'
import type { DreamPreview } from '@/types/memory'
import { useInstinct, INSTINCT_CONFIG } from '@/composables/useInstinct'
import type { Instinct } from '@/types/instinct'

const router = useRouter()
const memory = useMemory()
const settings = useSettingsStore()

const filterLayer = ref<MemoryLayer | 'all'>('all')
const expandedCats = ref<Set<string>>(new Set())
const searchQuery = ref('')
const searchInput = ref('')
const selectedCategories = ref<Set<string>>(new Set())
const sortMode = ref<SortMode>('lastAccessedAt')
const viewMode = ref<'list' | 'insights' | 'instinct'>('list')
const growthDays = ref<7 | 14 | 30>(14)
const showActions = ref(false)

let debounceTimer: ReturnType<typeof setTimeout> | null = null
watch(searchInput, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { searchQuery.value = val }, 200)
})

const layerLabels: Record<MemoryLayer, string> = { short: '短期', medium: '中期', long: '长期' }

const allCategories = computed(() => memory.getAllCategories())

const searchResults = computed(() => {
  let items = memory.store.value.items
  if (filterLayer.value !== 'all') items = items.filter(i => i.layer === filterLayer.value)
  return memory.searchItems(searchQuery.value).filter(i => items.includes(i))
})

const filteredItems = computed(() => {
  let items = searchResults.value
  if (selectedCategories.value.size > 0) items = items.filter(i => selectedCategories.value.has(i.category || '未分类'))
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
  return { all: all.length, short: all.filter(i => i.layer === 'short').length, medium: all.filter(i => i.layer === 'medium').length, long: all.filter(i => i.layer === 'long').length }
})

function toggleCategory(cat: string) {
  expandedCats.value.has(cat) ? expandedCats.value.delete(cat) : expandedCats.value.add(cat)
}

function toggleCategoryFilter(cat: string) {
  const next = new Set(selectedCategories.value)
  next.has(cat) ? next.delete(cat) : next.add(cat)
  selectedCategories.value = next
}

// 数据管理
const importToast = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

function handleExport(format: 'json' | 'markdown') {
  const content = memory.exportData({ format })
  const ext = format === 'json' ? 'json' : 'md'
  memory.downloadFile(`memory-export-${new Date().toISOString().slice(0, 10)}.${ext}`, content)
}

function handleImportClick() { fileInput.value?.click() }

function handleFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const result = memory.importFromJSON(reader.result as string)
    importToast.value = result.error ? `失败：${result.error}` : `新增 ${result.added} 条，跳过 ${result.skipped} 条`
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
  idx >= 0 ? clearLayers.value.splice(idx, 1) : clearLayers.value.push(layer)
}

function handleSelectiveClear() {
  const removed = memory.selectiveClear({ layers: clearLayers.value.length > 0 ? clearLayers.value : undefined, olderThanDays: clearDays.value ?? undefined })
  importToast.value = `已清除 ${removed} 条`
  setTimeout(() => { importToast.value = '' }, 3000)
  showClearPanel.value = false
  clearLayers.value = []
  clearDays.value = null
}

// Dreaming
const showPreview = ref(false)
const dreamingBusy = ref(false)
const dreamStatus = computed(() => memory.getDreamStatus())

async function handleManualDream() {
  if (!settings.apiKey || dreamingBusy.value) return
  dreamingBusy.value = true
  try {
    const preview = await memory.dreamDryRun(settings.apiKey)
    if (preview) showPreview.value = true
  } finally { dreamingBusy.value = false }
}

function handleApprove(preview: DreamPreview) { memory.approveDream(preview, true); showPreview.value = false }
function handleReject() { memory.rejectDream(); showPreview.value = false }

// 洞察
const growthData = computed(() => memory.getGrowthData(growthDays.value))
const layerDist = computed(() => memory.getLayerDistribution())
const topAccessed = computed(() => memory.getTopAccessed(10))
const dreamTimeline = computed(() => memory.getDreamTimeline())

const donutTotal = computed(() => layerDist.value.reduce((s, d) => s + d.count, 0) || 1)
const donutColors: Record<MemoryLayer, string> = { short: '#3b82f6', medium: '#f59e0b', long: '#10b981' }
function donutSegments() {
  let offset = 0
  return layerDist.value.filter(d => d.count > 0).map(d => {
    const pct = d.count / donutTotal.value
    const seg = { ...d, pct, offset }
    offset += pct
    return seg
  })
}

const chartMaxY = computed(() => Math.max(...growthData.value.map(p => p.count), 1))
function growthPolyline(): string {
  const w = 580; const h = 120; const pad = 20
  const pts = growthData.value
  if (pts.length < 2) return ''
  const xStep = (w - pad * 2) / (pts.length - 1)
  const yScale = (h - pad * 2) / (chartMaxY.value || 1)
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${pad + i * xStep},${h - pad - p.count * yScale}`).join(' ')
}

function handleUpdate(id: string, updates: Partial<Pick<MemoryItem, 'content' | 'layer' | 'category'>>) { memory.updateItem(id, updates) }
function handleDelete(id: string) { memory.deleteItem(id) }
function handlePin(id: string) { memory.togglePin(id) }

// ===== Instinct（直觉） =====
const instinct = useInstinct()
const instinctSubTab = ref<'active' | 'observing' | 'deprecated'>('active')

const instinctsActive = computed<Instinct[]>(() =>
  instinct.store.value.instincts
    .filter(i => !i.deprecated && i.confidence >= INSTINCT_CONFIG.INJECT_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence)
)
const instinctsObserving = computed<Instinct[]>(() =>
  instinct.store.value.instincts
    .filter(i => !i.deprecated && i.confidence < INSTINCT_CONFIG.INJECT_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence)
)
const instinctsDeprecated = computed<Instinct[]>(() =>
  instinct.store.value.instincts
    .filter(i => i.deprecated)
    .sort((a, b) => b.lastObservedAt - a.lastObservedAt)
)
const instinctsCurrent = computed<Instinct[]>(() => {
  if (instinctSubTab.value === 'active') return instinctsActive.value
  if (instinctSubTab.value === 'observing') return instinctsObserving.value
  return instinctsDeprecated.value
})

const domainLabels: Record<string, string> = {
  'tool-strategy': '工具策略',
  'workflow': '工作流',
  'tool-preference': '工具偏好',
  'search-pattern': '搜索习惯',
  'context-pattern': '项目上下文',
}

function formatInstinctTime(ts: number): string {
  if (!ts) return '—'
  const days = Math.floor((Date.now() - ts) / 86400000)
  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  return new Date(ts).toLocaleDateString('zh-CN')
}

function handleInstinctDelete(id: string) { instinct.deleteInstinct(id) }
function handleInstinctToggle(id: string) { instinct.toggleDeprecated(id) }
</script>

<template>
  <div class="flex-1 flex flex-col min-w-0 bg-app-bg">
    <!-- 顶栏 -->
    <div class="flex items-center gap-3 px-5 py-3 border-b border-app-border/40">
      <button @click="router.push('/')" class="w-7 h-7 flex items-center justify-center rounded-md text-app-muted hover:text-app-text transition-colors">
        <svg class="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 19l-7-7 7-7" /></svg>
      </button>
      <h1 class="text-sm font-medium text-app-text">记忆</h1>
      <div class="flex items-center gap-3 ml-auto text-xs">
        <button @click="viewMode = 'list'" class="pb-0.5 transition-colors" :class="viewMode === 'list' ? 'text-app-text border-b border-app-text' : 'text-app-muted/60 hover:text-app-text'">列表</button>
        <button @click="viewMode = 'insights'" class="pb-0.5 transition-colors" :class="viewMode === 'insights' ? 'text-app-text border-b border-app-text' : 'text-app-muted/60 hover:text-app-text'">洞察</button>
        <button @click="viewMode = 'instinct'" class="pb-0.5 transition-colors" :class="viewMode === 'instinct' ? 'text-app-text border-b border-app-text' : 'text-app-muted/60 hover:text-app-text'">直觉</button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto">
      <div class="max-w-xl mx-auto px-6 py-8">

        <!-- 待审批的 Observation 提取候选 -->
        <div
          v-if="memory.store.value.pendingPreview && !showPreview"
          class="mb-6 flex items-center justify-between px-4 py-3 border border-app-border/40 rounded-lg text-xs"
        >
          <span class="text-app-text/80">有待确认的记忆提取预览（{{ memory.store.value.pendingPreview.operations.length }} 条）</span>
          <button @click="showPreview = true" class="text-app-text hover:opacity-70 transition-opacity">查看 →</button>
        </div>

        <!-- ═══ 直觉视图（Instinct Engine） ═══ -->
        <template v-if="viewMode === 'instinct'">
          <!-- 头部说明 -->
          <div class="mb-6">
            <p class="text-xs text-app-muted/70 leading-relaxed">
              基于历史会话自动学习的"触发条件→建议行为"规则。置信度 ≥ {{ INSTINCT_CONFIG.INJECT_THRESHOLD }} 的规则会自动注入到对话上下文。
            </p>
          </div>

          <!-- 子 tab 切换 -->
          <div class="flex items-baseline gap-8 mb-6">
            <button
              v-for="t in [
                { key: 'active', label: '激活中', count: instinctsActive.length },
                { key: 'observing', label: '观察中', count: instinctsObserving.length },
                { key: 'deprecated', label: '已废弃', count: instinctsDeprecated.length },
              ]" :key="t.key"
              @click="instinctSubTab = t.key as 'active' | 'observing' | 'deprecated'"
              class="text-center transition-opacity"
              :class="instinctSubTab === t.key ? 'opacity-100' : 'opacity-30 hover:opacity-60'"
            >
              <p class="text-lg font-medium text-app-text tabular-nums">{{ t.count }}</p>
              <p class="text-xs text-app-muted/60 mt-0.5">{{ t.label }}</p>
            </button>
          </div>

          <!-- 列表 -->
          <div v-if="instinctsCurrent.length === 0" class="text-center py-16">
            <svg class="w-12 h-12 mx-auto text-app-muted/20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            <p class="text-sm text-app-muted/60 mt-3">
              {{ instinctSubTab === 'active' ? '还没有激活的直觉，继续对话以积累' : instinctSubTab === 'observing' ? '暂无观察中的直觉' : '暂无已废弃的直觉' }}
            </p>
          </div>

          <div v-else class="space-y-3">
            <div
              v-for="i in instinctsCurrent" :key="i.id"
              class="group border border-app-border/40 rounded-lg p-4 transition-colors"
              :class="i.deprecated ? 'opacity-50' : ''"
            >
              <!-- trigger → action -->
              <div class="text-xs text-app-text/90 leading-relaxed mb-3">
                <span class="text-app-muted">当 </span>{{ i.trigger.replace(/^当/, '').replace(/时$/, '') }}<span class="text-app-muted"> 时 → </span>{{ i.action }}
              </div>

              <!-- 元信息 -->
              <div class="flex items-center justify-between text-xs">
                <div class="flex items-center gap-3 text-app-muted/60">
                  <!-- 置信度条 -->
                  <div class="flex items-center gap-1.5">
                    <div class="w-16 h-1 rounded-full bg-app-border/30 overflow-hidden">
                      <div
                        class="h-full transition-all"
                        :style="{
                          width: `${(i.confidence / INSTINCT_CONFIG.CONFIDENCE_CAP) * 100}%`,
                          backgroundColor: i.confidence >= INSTINCT_CONFIG.INJECT_THRESHOLD ? '#10b981' : '#f59e0b'
                        }"
                      ></div>
                    </div>
                    <span class="tabular-nums">{{ i.confidence.toFixed(2) }}</span>
                  </div>
                  <!-- domain -->
                  <span class="px-1.5 py-0.5 rounded border border-app-border/40 text-app-muted/70">
                    {{ domainLabels[i.domain] ?? i.domain }}
                  </span>
                  <!-- source -->
                  <span class="text-app-muted/40">
                    {{ i.source === 'statistical' ? '统计' : '语义' }}
                  </span>
                  <!-- 出现次数 -->
                  <span class="text-app-muted/40">观察 {{ i.observedCount }}×</span>
                  <!-- 最近触发 -->
                  <span class="text-app-muted/40">{{ formatInstinctTime(i.lastObservedAt) }}</span>
                </div>

                <!-- 操作 -->
                <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    @click="handleInstinctToggle(i.id)"
                    class="text-app-muted/60 hover:text-app-text transition-colors"
                  >{{ i.deprecated ? '激活' : '废弃' }}</button>
                  <button
                    @click="handleInstinctDelete(i.id)"
                    class="text-app-muted/60 hover:text-red-500 transition-colors"
                  >删除</button>
                </div>
              </div>

              <!-- evidence（可折叠时显示） -->
              <div v-if="i.evidence" class="mt-2 text-xs text-app-muted/50 italic">
                {{ i.evidence }}
              </div>
            </div>
          </div>
        </template>

        <!-- ═══ 洞察视图 ═══ -->
        <template v-if="viewMode === 'insights'">
          <div class="space-y-8">
            <!-- 增长曲线 -->
            <section>
              <div class="flex items-center justify-between mb-3">
                <p class="text-xs font-medium text-app-muted">记忆增长</p>
                <div class="flex gap-3 text-xs">
                  <button v-for="d in ([7, 14, 30] as const)" :key="d" @click="growthDays = d" class="pb-0.5 transition-colors" :class="growthDays === d ? 'text-app-text border-b border-app-text' : 'text-app-muted/60 hover:text-app-text'">{{ d }}天</button>
                </div>
              </div>
              <div class="border border-app-border/30 rounded-lg p-5">
                <svg viewBox="0 0 580 140" class="w-full h-32">
                  <line v-for="n in 4" :key="n" :x1="20" :y1="20 + n * 25" :x2="560" :y2="20 + n * 25" class="stroke-app-border/30" stroke-width="0.5" />
                  <path :d="growthPolyline()" fill="none" class="stroke-app-text/60" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                  <circle v-for="(pt, i) in growthData" :key="i" :cx="20 + (i / Math.max(growthData.length - 1, 1)) * 540" :cy="140 - 20 - (pt.count / Math.max(chartMaxY, 1)) * 100" r="2.5" class="fill-app-text/60" />
                </svg>
              </div>
            </section>

            <!-- 层级分布 + 最常访问 -->
            <div class="grid grid-cols-2 gap-4">
              <section class="border border-app-border/30 rounded-lg p-5">
                <p class="text-xs font-medium text-app-muted mb-4">层级分布</p>
                <div class="flex items-center gap-4">
                  <svg viewBox="0 0 120 120" class="w-20 h-20">
                    <circle cx="60" cy="60" r="40" fill="none" stroke="currentColor" class="text-app-border/20" stroke-width="14" />
                    <circle v-for="seg in donutSegments()" :key="seg.layer" cx="60" cy="60" r="40" fill="none" :stroke="donutColors[seg.layer]" stroke-width="14" :stroke-dasharray="`${seg.pct * 251.3} ${(1 - seg.pct) * 251.3}`" :stroke-dashoffset="251.3 - seg.offset * 251.3" transform="rotate(-90 60 60)" />
                    <text x="60" y="64" text-anchor="middle" class="fill-app-text text-xs font-medium">{{ donutTotal }}</text>
                  </svg>
                  <div class="space-y-1.5">
                    <div v-for="d in layerDist" :key="d.layer" class="flex items-center gap-2 text-xs">
                      <span class="w-2 h-2 rounded-full" :style="{ backgroundColor: donutColors[d.layer] }"></span>
                      <span class="text-app-text/80">{{ d.label }}</span>
                      <span class="text-app-muted/50">{{ d.count }}</span>
                    </div>
                  </div>
                </div>
              </section>

              <section class="border border-app-border/30 rounded-lg p-5">
                <p class="text-xs font-medium text-app-muted mb-4">最常访问</p>
                <div v-if="topAccessed.length === 0" class="text-xs text-app-muted/50 text-center py-6">暂无</div>
                <div v-else class="space-y-1.5 max-h-[160px] overflow-y-auto">
                  <div v-for="(item, idx) in topAccessed" :key="item.id" class="flex items-center gap-2 text-xs">
                    <span class="w-4 text-center text-app-muted/40 font-mono">{{ idx + 1 }}</span>
                    <span class="text-app-text/80 truncate flex-1">{{ item.content }}</span>
                    <span class="text-app-muted/40 shrink-0">{{ item.accessCount }}×</span>
                  </div>
                </div>
              </section>
            </div>

            <!-- 整理记录 -->
            <section>
              <p class="text-xs font-medium text-app-muted mb-3">整理记录</p>
              <div v-if="dreamTimeline.length === 0" class="text-xs text-app-muted/50 text-center py-6">暂无</div>
              <div v-else class="space-y-0">
                <div v-for="log in dreamTimeline" :key="log.timestamp" class="flex gap-3">
                  <div class="flex flex-col items-center shrink-0">
                    <div class="w-1.5 h-1.5 rounded-full" :class="log.manual ? 'bg-app-text/60' : 'bg-app-border'"></div>
                    <div class="w-px flex-1 bg-app-border/30 min-h-[20px]"></div>
                  </div>
                  <div class="pb-3 text-xs">
                    <span class="text-app-text/80">{{ log.beforeCount }} → {{ log.afterCount }} 条</span>
                    <span class="text-app-muted/40 ml-2">{{ new Date(log.timestamp).toLocaleDateString('zh-CN') }}</span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </template>

        <!-- ═══ 列表视图 ═══ -->
        <template v-if="viewMode === 'list'">

          <!-- 数字指标 -->
          <div class="flex items-baseline gap-8 mb-8">
            <button
              v-for="item in [
                { key: 'all', count: layerCounts.all, label: '全部' },
                { key: 'short', count: layerCounts.short, label: '短期' },
                { key: 'medium', count: layerCounts.medium, label: '中期' },
                { key: 'long', count: layerCounts.long, label: '长期' },
              ]" :key="item.key"
              @click="filterLayer = item.key as MemoryLayer | 'all'"
              class="text-center transition-opacity"
              :class="filterLayer === item.key ? 'opacity-100' : 'opacity-30 hover:opacity-60'"
            >
              <p class="text-lg font-medium text-app-text tabular-nums">{{ item.count }}</p>
              <p class="text-xs text-app-muted/60 mt-0.5">{{ item.label }}</p>
            </button>
          </div>

          <!-- 搜索 + 操作 -->
          <div class="flex items-center gap-3 mb-6">
            <div class="relative flex-1">
              <svg class="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-app-muted/40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input v-model="searchInput" placeholder="搜索..." class="w-full pl-9 pr-4 py-2.5 text-sm border border-app-border/50 rounded-lg bg-transparent text-app-text placeholder:text-app-muted/50 focus:outline-none focus:border-app-text/60 transition-colors" />
            </div>
            <select v-model="sortMode" class="px-3 py-2.5 text-xs border border-app-border/50 rounded-lg bg-transparent text-app-text focus:outline-none focus:border-app-text/60 transition-colors cursor-pointer appearance-none">
              <option value="lastAccessedAt">最近访问</option>
              <option value="createdAt">创建时间</option>
              <option value="accessCount">访问次数</option>
            </select>
            <div class="relative">
              <button @click="showActions = !showActions" class="w-8 h-8 flex items-center justify-center rounded-lg text-app-muted/60 hover:text-app-text transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01" /></svg>
              </button>
              <div v-if="showActions" class="absolute right-0 top-full mt-1 w-40 py-1 rounded-lg bg-app-bg border border-app-border/40 shadow-sm z-30">
                <button @click="handleExport('json'); showActions = false" class="w-full text-left px-3 py-1.5 text-xs text-app-text/80 hover:bg-app-text/[0.03] transition-colors">导出 JSON</button>
                <button @click="handleExport('markdown'); showActions = false" class="w-full text-left px-3 py-1.5 text-xs text-app-text/80 hover:bg-app-text/[0.03] transition-colors">导出 Markdown</button>
                <button @click="handleImportClick(); showActions = false" class="w-full text-left px-3 py-1.5 text-xs text-app-text/80 hover:bg-app-text/[0.03] transition-colors">导入</button>
                <button @click="showClearPanel = true; showActions = false" class="w-full text-left px-3 py-1.5 text-xs text-red-500/70 hover:bg-app-text/[0.03] transition-colors">选择性清除</button>
              </div>
            </div>
            <input ref="fileInput" type="file" accept=".json" class="hidden" @change="handleFileChange" />
            <button
              @click="handleManualDream"
              :disabled="dreamingBusy"
              class="px-3 py-2 text-xs font-medium rounded-md transition-opacity shrink-0"
              :class="dreamStatus.newSinceLastDream >= 10
                ? 'bg-app-text text-app-bg hover:opacity-80'
                : 'text-app-muted/60 hover:text-app-text'"
            >
              {{ dreamingBusy ? '整理中...' : '整理' }}
              <span v-if="dreamStatus.newSinceLastDream > 0 && !dreamingBusy" class="ml-0.5 opacity-50">{{ dreamStatus.newSinceLastDream }}</span>
            </button>
          </div>

          <!-- Toast -->
          <div v-if="importToast" class="mb-4 px-3.5 py-2 rounded-lg text-xs border border-app-border/30 text-app-text/80">{{ importToast }}</div>

          <!-- 清除面板 -->
          <div v-if="showClearPanel" class="mb-6 p-4 rounded-lg border border-app-border/40 space-y-3">
            <p class="text-xs font-medium text-app-text">选择性清除</p>
            <div class="flex gap-2">
              <button v-for="layer in (['short', 'medium', 'long'] as MemoryLayer[])" :key="layer" @click="toggleClearLayer(layer)" class="text-xs px-2.5 py-1 rounded-md border transition-colors" :class="clearLayers.includes(layer) ? 'border-red-400/60 text-red-500 bg-red-500/5' : 'border-app-border/40 text-app-muted hover:text-app-text'">{{ layerLabels[layer] }}</button>
              <input v-model.number="clearDays" type="number" min="1" placeholder="N天未访问" class="w-24 text-xs px-2.5 py-1 rounded-md border border-app-border/40 bg-transparent text-app-text focus:outline-none focus:border-app-text/60 transition-colors" />
            </div>
            <div class="flex gap-2">
              <button @click="handleSelectiveClear" :disabled="clearLayers.length === 0 && !clearDays" class="text-xs px-3 py-1.5 rounded-md bg-red-500/80 text-white disabled:opacity-30 hover:opacity-80 transition-opacity">确认清除</button>
              <button @click="showClearPanel = false" class="text-xs px-3 py-1.5 text-app-muted hover:text-app-text transition-colors">取消</button>
            </div>
          </div>

          <!-- 分类标签 -->
          <div v-if="allCategories.length > 0" class="flex flex-wrap gap-1.5 mb-6">
            <button
              v-for="cat in allCategories" :key="cat"
              @click="toggleCategoryFilter(cat)"
              class="text-xs px-2.5 py-1 rounded-md border transition-colors"
              :class="selectedCategories.has(cat) ? 'border-app-text/40 text-app-text bg-app-text/5' : 'border-app-border/30 text-app-muted/60 hover:text-app-text hover:border-app-border/60'"
            >{{ cat }}</button>
          </div>

          <!-- 内容 -->
          <div v-if="filteredItems.length === 0" class="text-center py-16">
            <svg class="w-12 h-12 mx-auto text-app-muted/20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
            <p class="text-sm text-app-muted/60 mt-3">还没有记忆</p>
          </div>

          <div v-else class="space-y-5">
            <div v-for="[cat, items] in groupedByCategory" :key="cat">
              <button @click="toggleCategory(cat)" class="flex items-center gap-2 mb-2 group">
                <svg class="w-3 h-3 text-app-muted/40 transition-transform duration-200" :class="{ 'rotate-90': expandedCats.has(cat) }" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" /></svg>
                <span class="text-xs font-medium text-app-text/80">{{ cat }}</span>
                <span class="text-xs text-app-muted/40">{{ items.length }}</span>
              </button>
              <div v-if="expandedCats.has(cat)" class="ml-4 pl-4 border-l border-app-border/30 space-y-2">
                <MemoryCard v-for="item in items" :key="item.id" :item="item" :highlight="searchQuery" @update="handleUpdate" @delete="handleDelete" @pin="handlePin" />
              </div>
            </div>
          </div>

        </template>
      </div>
    </div>

    <DreamPreviewModal v-if="showPreview && memory.store.value.pendingPreview" :preview="memory.store.value.pendingPreview" @approve="handleApprove" @reject="handleReject" />
  </div>
</template>
