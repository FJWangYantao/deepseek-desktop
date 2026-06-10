<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useStatsStore } from '@/stores/stats'
import ContentBlock from '@/components/renderer/ContentBlock.vue'

const router = useRouter()
const route = useRoute()
const stats = useStatsStore()

const record = computed(() =>
  stats.records.find(r => r.id === route.params.id)
)

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function fmtModel(model: string): string {
  const map: Record<string, string> = {
    'deepseek-v4-pro': 'DeepSeek V4 Pro',
    'deepseek-v4-flash': 'DeepSeek V4 Flash',
  }
  return map[model] ?? model
}
</script>

<template>
  <div class="flex-1 flex flex-col min-w-0 bg-app-bg">
    <!-- 顶部导航 -->
    <div class="flex items-center gap-3 px-5 py-3 border-b border-app-border">
      <button
        @click="router.back()"
        class="w-7 h-7 flex items-center justify-center rounded-md text-app-muted hover:bg-app-card transition-colors"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <h1 class="text-base font-semibold text-app-text">消息详情</h1>
    </div>

    <!-- 内容 -->
    <div class="flex-1 overflow-y-auto">
      <div v-if="record" class="max-w-[860px] mx-auto px-8 py-10">
        <!-- 元信息 -->
        <div class="grid grid-cols-4 gap-3 mb-8">
          <div class="rounded-lg border border-app-border bg-app-card p-3">
            <p class="text-[11px] text-app-muted mb-0.5">模型</p>
            <p class="text-sm font-medium text-app-text">{{ fmtModel(record.model) }}</p>
          </div>
          <div class="rounded-lg border border-app-border bg-app-card p-3">
            <p class="text-[11px] text-app-muted mb-0.5">时间</p>
            <p class="text-sm font-medium text-app-text">{{ fmtTime(record.timestamp) }}</p>
          </div>
          <div class="rounded-lg border border-app-border bg-app-card p-3">
            <p class="text-[11px] text-app-muted mb-0.5">费用</p>
            <p class="text-sm font-medium text-app-text">¥{{ record.cost.toFixed(6) }}</p>
          </div>
          <div class="rounded-lg border border-app-border bg-app-card p-3">
            <p class="text-[11px] text-app-muted mb-0.5">来源</p>
            <p class="text-sm font-medium text-app-text">{{ record.source === 'api' ? 'API 真实数据' : '本地估算' }}</p>
          </div>
        </div>

        <!-- Token 用量 -->
        <div class="mb-8">
          <h2 class="text-sm font-medium text-app-heading mb-3">Token 用量</h2>
          <div class="grid grid-cols-5 gap-3">
            <div class="rounded-lg border border-app-border bg-app-card p-3 text-center">
              <p class="text-xl font-semibold text-app-text tabular-nums">{{ record.usage.prompt_tokens.toLocaleString() }}</p>
              <p class="text-[11px] text-app-muted mt-0.5">输入</p>
            </div>
            <div class="rounded-lg border border-app-border bg-app-card p-3 text-center">
              <p class="text-xl font-semibold text-app-text tabular-nums">{{ record.usage.completion_tokens.toLocaleString() }}</p>
              <p class="text-[11px] text-app-muted mt-0.5">输出</p>
            </div>
            <div class="rounded-lg border border-app-border bg-app-card p-3 text-center">
              <p class="text-xl font-semibold text-app-text tabular-nums">{{ record.usage.total_tokens.toLocaleString() }}</p>
              <p class="text-[11px] text-app-muted mt-0.5">总计</p>
            </div>
            <div class="rounded-lg border border-app-border bg-app-card p-3 text-center">
              <p class="text-xl font-semibold tabular-nums" :class="record.usage.prompt_cache_hit_tokens > 0 ? 'text-green-600' : 'text-app-text'">{{ record.usage.prompt_cache_hit_tokens.toLocaleString() }}</p>
              <p class="text-[11px] text-app-muted mt-0.5">缓存命中</p>
            </div>
            <div class="rounded-lg border border-app-border bg-app-card p-3 text-center">
              <p class="text-xl font-semibold text-app-muted tabular-nums">{{ record.usage.prompt_cache_miss_tokens.toLocaleString() }}</p>
              <p class="text-[11px] text-app-muted mt-0.5">缓存未命中</p>
            </div>
          </div>
        </div>

        <!-- 用户消息 -->
        <div class="mb-8">
          <h2 class="text-sm font-medium text-app-heading mb-3">用户输入</h2>
          <div class="rounded-xl border border-app-border bg-app-card p-5">
            <p class="text-app-text whitespace-pre-wrap break-words leading-[1.8] text-sm">{{ record.userMessage || '(无内容)' }}</p>
          </div>
        </div>

        <!-- AI 回复 -->
        <div class="mb-8">
          <h2 class="text-sm font-medium text-app-heading mb-3">AI 回复</h2>
          <div class="rounded-xl border border-app-border bg-app-card p-5">
            <ContentBlock v-if="record.assistantMessage" :content="record.assistantMessage" />
            <p v-else class="text-app-muted text-sm">(无内容)</p>
          </div>
        </div>

        <!-- 后台 API 请求 -->
        <div v-if="record.apiMessages?.length" class="mb-8">
          <details class="group">
            <summary class="text-sm font-medium text-app-heading mb-3 cursor-pointer hover:text-app-accent transition-colors select-none">
              后台 API 请求 ({{ record.apiMessages.length }} 条消息)
            </summary>
            <div class="space-y-4 mt-3">
              <div
                v-for="(msg, i) in record.apiMessages"
                :key="i"
                class="rounded-xl border border-app-border bg-app-card overflow-hidden"
              >
                <div class="px-4 py-2 border-b border-app-border bg-app-accent-soft/20 flex items-center gap-2">
                  <span
                    class="text-[11px] font-medium px-2 py-0.5 rounded-full"
                    :class="msg.role === 'system' ? 'bg-purple-100 text-purple-700' : msg.role === 'user' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'"
                  >{{ msg.role === 'system' ? 'SYSTEM' : msg.role === 'user' ? 'USER' : 'ASSISTANT' }}</span>
                  <span class="text-[11px] text-app-muted">{{ msg.content.length.toLocaleString() }} 字符</span>
                </div>
                <div class="p-4 max-h-[400px] overflow-y-auto">
                  <pre class="text-xs text-app-text whitespace-pre-wrap break-words leading-[1.6] font-mono">{{ msg.content }}</pre>
                </div>
              </div>
            </div>
          </details>
        </div>
      </div>

      <!-- 未找到 -->
      <div v-else class="text-center py-20">
        <p class="text-app-muted text-sm">未找到该记录</p>
        <button
          @click="router.back()"
          class="mt-3 px-4 py-2 text-sm rounded-lg border border-app-border text-app-muted hover:text-app-text hover:bg-app-hover transition-colors"
        >
          返回
        </button>
      </div>
    </div>
  </div>
</template>
