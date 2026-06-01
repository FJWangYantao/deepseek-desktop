<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'

const router = useRouter()
const settings = useSettingsStore()
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
      <h1 class="text-base font-semibold text-app-text">设置</h1>
    </div>
    <div class="flex-1 overflow-y-auto px-8 py-8 max-w-lg">
      <!-- API Key -->
      <div class="mb-8">
        <label class="block text-sm font-medium text-app-heading mb-2">API Key</label>
        <input
          :type="settings.showKey ? 'text' : 'password'"
          v-model="settings.apiKey"
          placeholder="sk-..."
          class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-app-border bg-white
                 text-app-text placeholder-app-muted focus:outline-none focus:border-app-accent
                 transition-colors font-mono"
        />
        <label class="inline-flex items-center gap-1.5 mt-2 text-xs text-app-muted cursor-pointer">
          <input type="checkbox" v-model="settings.showKey" class="rounded" />
          显示
        </label>
      </div>

      <!-- 默认模型 -->
      <div class="mb-8">
        <label class="block text-sm font-medium text-app-heading mb-2">默认模型</label>
        <div class="flex gap-2">
          <button
            v-for="m in settings.models"
            :key="m.id"
            @click="settings.defaultModel = m.id"
            class="flex-1 px-4 py-2.5 text-sm rounded-lg border transition-colors"
            :class="settings.defaultModel === m.id
              ? 'border-app-accent bg-amber-50 text-app-accent font-medium'
              : 'border-app-border bg-white text-app-heading hover:bg-gray-50'"
          >
            {{ m.name }}
          </button>
        </div>
        <p class="text-xs text-app-muted mt-2">
          {{ settings.models.find(m => m.id === settings.defaultModel)?.description }}
        </p>
      </div>

      <!-- 字体大小 -->
      <div class="mb-8">
        <label class="block text-sm font-medium text-app-heading mb-2">字体大小</label>
        <select
          :value="settings.fontSize"
          @change="settings.fontSize = Number(($event.target as HTMLSelectElement).value)"
          class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-app-border bg-white
                 text-app-text focus:outline-none focus:border-app-accent transition-colors"
        >
          <option v-for="s in [10,12,14,16,18,20,22,24,26,28]" :key="s" :value="s">{{ s }}px</option>
        </select>
      </div>

      <!-- 数据管理 -->
      <div class="mb-8">
        <label class="block text-sm font-medium text-app-heading mb-2">数据管理</label>
        <button
          @click="settings.clearAllData()"
          class="px-4 py-2 text-sm rounded-lg border border-red-200 text-red-600
                 hover:bg-red-50 transition-colors"
        >
          清除所有对话数据
        </button>
      </div>

      <!-- 关于 -->
      <div>
        <h3 class="text-sm font-medium text-app-heading mb-2">关于</h3>
        <p class="text-sm text-app-muted">DeepSeek Chat v1.3.0</p>
        <p class="text-xs text-app-muted mt-1">Electron + Vue 3 + Tailwind CSS</p>
      </div>
    </div>
  </div>
</template>
