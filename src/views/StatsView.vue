<script setup lang="ts">
import { onMounted } from 'vue'
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

onMounted(() => {
  fetchBalance(settings.apiKey)
})
</script>

<template>
  <div class="flex-1 flex flex-col min-w-0 bg-app-bg">
    <div class="flex items-center gap-3 px-5 py-3 border-b border-app-border">
      <button
        @click="router.push('/')"
        class="w-7 h-7 flex items-center justify-center rounded-md text-app-muted hover:bg-app-card transition-colors"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <h1 class="text-base font-semibold text-app-text">使用统计</h1>
    </div>

    <div class="flex-1 overflow-y-auto px-6 py-6">
      <!-- 余额 -->
      <div class="flex items-center gap-3 mb-3">
        <h2 class="text-sm font-medium text-app-heading">账户余额</h2>
        <button
          @click="fetchBalance(settings.apiKey)"
          :disabled="balanceLoading"
          class="text-xs px-2 py-1 rounded-md border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover transition-colors"
        >
          {{ balanceLoading ? '查询中...' : '刷新' }}
        </button>
      </div>
      <div v-if="balance.length" class="grid grid-cols-3 gap-4 mb-6">
        <div
          v-for="b in balance"
          :key="b.currency"
          class="rounded-xl border border-app-border bg-app-card p-4"
        >
          <p class="text-xs text-app-muted mb-1">账户余额 ({{ b.currency }})</p>
          <p class="text-xl font-semibold text-app-text">{{ b.total_balance }}</p>
          <div class="flex gap-3 mt-2 text-xs text-app-muted">
            <span>充值 {{ b.topped_up_balance }}</span>
            <span>赠金 {{ b.granted_balance }}</span>
          </div>
        </div>
      </div>
      <div v-else-if="balanceLoading" class="text-center text-app-muted text-sm py-4">查询余额中...</div>

      <!-- 概览卡片 -->
      <div class="grid grid-cols-4 gap-4 mb-3">
        <SummaryCard title="累计对话" :value="String(stats.totalConversations)" />
        <SummaryCard title="Token 用量" :value="stats.fmtTotalTokens" :sub="`输入 ${stats.totalInputTokens.toLocaleString()} / 输出 ${stats.totalOutputTokens.toLocaleString()}`" />
        <SummaryCard title="缓存命中" :value="stats.fmtCacheHits" :sub="`命中率 ${stats.cacheHitRate}%`" />
        <SummaryCard title="预估费用" :value="stats.fmtCost" accent />
      </div>

      <!-- 热力图 -->
      <div class="mb-6">
        <h2 class="text-sm font-medium text-app-heading mb-3">年度 Token 用量</h2>
        <div class="rounded-xl border border-app-border bg-app-card p-4">
          <HeatmapChart :data="stats.dailyMap" />
        </div>
      </div>

      <!-- 柱状图 -->
      <div class="mb-6">
        <h2 class="text-sm font-medium text-app-heading mb-3">近 30 天 Token 用量</h2>
        <div class="rounded-xl border border-app-border bg-app-card p-4">
          <UsageBarChart :data="stats.recentStats" />
        </div>
      </div>

      <!-- 明细表 -->
      <div class="mb-6">
        <h2 class="text-sm font-medium text-app-heading mb-3">消息明细</h2>
        <div class="rounded-xl border border-app-border bg-app-card p-4">
          <DataTable :data="stats.records" />
        </div>
      </div>

      <!-- 空状态 -->
      <div v-if="stats.totalConversations === 0" class="text-center py-20">
        <p class="text-app-muted text-sm">暂无使用数据</p>
        <p class="text-app-muted text-xs mt-1">开始对话后将自动记录</p>
        <p class="text-app-muted text-xs mt-2">调试：records={{ stats.records.length }}</p>
      </div>

      <!-- 清除 -->
      <div v-if="stats.totalConversations > 0" class="text-center pb-8">
        <button
          @click="stats.clearAllStats()"
          class="px-4 py-2 text-sm rounded-lg border border-red-200 text-red-600
                 hover:bg-red-50 transition-colors"
        >
          清除统计数据
        </button>
      </div>
    </div>
  </div>
</template>
