<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useStatsStore } from '@/stores/stats'
import { useSettingsStore } from '@/stores/settings'
import { useBalance } from '@/composables/useBalance'
import SummaryCard from '@/components/stats/SummaryCard.vue'
import HeatmapChart from '@/components/stats/HeatmapChart.vue'
import UsageBarChart from '@/components/stats/UsageBarChart.vue'
import DataTable from '@/components/stats/DataTable.vue'

const router = useRouter()
const stats = useStatsStore()
const settings = useSettingsStore()
const { balance, loading: balanceLoading, fetchBalance } = useBalance()
const chartMode = ref<'24h' | '30d'>('24h')
const showTable = ref(false)

onMounted(() => {
  fetchBalance(settings.apiKey)
})
</script>

<template>
  <div class="flex-1 flex flex-col min-w-0 bg-app-bg">
    <!-- 顶栏 -->
    <div class="flex items-center gap-3 px-5 py-3 border-b border-app-border/40">
      <button @click="router.push('/')" class="w-7 h-7 flex items-center justify-center rounded-md text-app-muted hover:text-app-text transition-colors">
        <svg class="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 19l-7-7 7-7" /></svg>
      </button>
      <h1 class="text-sm font-medium text-app-text">统计</h1>
    </div>

    <div class="flex-1 overflow-y-auto">
      <!-- 空状态 -->
      <div v-if="stats.totalConversations === 0 && !balanceLoading" class="flex flex-col items-center justify-center h-full">
        <svg class="w-12 h-12 text-app-muted/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <p class="text-sm text-app-muted/60 mt-3">开始对话后将自动记录</p>
      </div>

      <div v-else class="max-w-xl mx-auto px-6 py-8 space-y-8">

        <!-- 余额 -->
        <section v-if="balance.length" class="text-center py-4">
          <p class="text-2xl font-semibold text-app-text tabular-nums tracking-tight">
            {{ balance[0].total_balance }}
          </p>
          <p class="text-xs text-app-muted/70 mt-1.5">
            账户余额 ({{ balance[0].currency }})
            <button @click="fetchBalance(settings.apiKey)" class="ml-2 text-app-muted hover:text-app-text transition-colors">刷新</button>
          </p>
          <div class="flex justify-center gap-4 mt-2 text-xs text-app-muted/50">
            <span>充值 {{ balance[0].topped_up_balance }}</span>
            <span>赠金 {{ balance[0].granted_balance }}</span>
          </div>
        </section>
        <div v-else-if="balanceLoading" class="text-center py-6">
          <svg class="w-4 h-4 animate-spin mx-auto text-app-muted/40" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>

        <!-- 指标行 -->
        <section class="flex items-baseline justify-between pt-6 border-t border-app-border/30">
          <div class="text-center">
            <p class="text-lg font-medium text-app-text tabular-nums">{{ stats.totalConversations }}</p>
            <p class="text-xs text-app-muted/60 mt-0.5">对话</p>
          </div>
          <div class="text-center">
            <p class="text-lg font-medium text-app-text tabular-nums">{{ stats.fmtTotalTokens }}</p>
            <p class="text-xs text-app-muted/60 mt-0.5">Token</p>
          </div>
          <div class="text-center">
            <p class="text-lg font-medium text-app-text tabular-nums">{{ stats.cacheHitRate }}%</p>
            <p class="text-xs text-app-muted/60 mt-0.5">缓存命中</p>
          </div>
          <div class="text-center">
            <p class="text-lg font-medium text-app-text tabular-nums">{{ stats.fmtCost }}</p>
            <p class="text-xs text-app-muted/60 mt-0.5">费用</p>
          </div>
        </section>

        <!-- 热力图 -->
        <section class="pt-6 border-t border-app-border/30">
          <p class="text-xs font-medium text-app-muted mb-4">年度用量</p>
          <div class="border border-app-border/30 rounded-lg p-5">
            <HeatmapChart :data="stats.dailyMap" />
          </div>
        </section>

        <!-- 柱状图 -->
        <section class="pt-6 border-t border-app-border/30">
          <div class="flex items-center justify-between mb-4">
            <p class="text-xs font-medium text-app-muted">趋势</p>
            <div class="flex gap-3 text-xs">
              <button @click="chartMode = '24h'" class="pb-0.5 transition-colors" :class="chartMode === '24h' ? 'text-app-text border-b border-app-text' : 'text-app-muted/60 hover:text-app-text'">24h</button>
              <button @click="chartMode = '30d'" class="pb-0.5 transition-colors" :class="chartMode === '30d' ? 'text-app-text border-b border-app-text' : 'text-app-muted/60 hover:text-app-text'">30天</button>
            </div>
          </div>
          <div class="border border-app-border/30 rounded-lg p-5">
            <UsageBarChart :data="chartMode === '24h' ? stats.recentHours : stats.recentStats" />
          </div>
        </section>

        <!-- 明细 -->
        <section class="pt-6 border-t border-app-border/30 pb-6">
          <button
            @click="showTable = !showTable"
            class="text-xs text-app-muted/60 hover:text-app-text transition-colors"
          >
            {{ showTable ? '收起明细' : '查看消息明细 →' }}
          </button>
          <div v-if="showTable" class="mt-4 border border-app-border/30 rounded-lg p-4">
            <DataTable :data="stats.records" />
          </div>
        </section>

      </div>
    </div>
  </div>
</template>
