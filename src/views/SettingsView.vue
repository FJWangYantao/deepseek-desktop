<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { useTheme } from '@/composables/useTheme'

const router = useRouter()
const settings = useSettingsStore()
const theme = useTheme()

const themes = [
  { id: 'amber' as const, label: '琥珀', color: '#d97706' },
  { id: 'ocean' as const, label: '海蓝', color: '#2563eb' },
  { id: 'sage' as const, label: '森绿', color: '#4d7c0f' },
  { id: 'slate' as const, label: '岩灰', color: '#6366f1' },
]
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
    <div class="flex-1 overflow-y-auto px-8 py-8">
      <!-- API Key -->
      <div class="mb-8">
        <label class="block text-sm font-medium text-app-heading mb-2">API Key</label>
        <input
          :type="settings.showKey ? 'text' : 'password'"
          :value="settings.apiKey"
          @input="settings.apiKey = ($event.target as HTMLInputElement).value"
          placeholder="sk-..."
          class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-app-border bg-app-input
                 text-app-text placeholder-app-muted focus:outline-none focus:border-app-accent
                 transition-colors font-mono"
        />
        <label class="inline-flex items-center gap-1.5 mt-2 text-xs text-app-muted cursor-pointer">
          <input type="checkbox" v-model="settings.showKey" class="rounded" />
          显示
        </label>
      </div>

      <!-- 系统提示词 -->
      <div class="mb-8">
        <label class="block text-sm font-medium text-app-heading mb-2">系统提示词</label>
        <textarea
          :value="settings.systemPrompt"
          @input="settings.systemPrompt = ($event.target as HTMLTextAreaElement).value"
          placeholder="设定 AI 的行为规则、角色、回答风格等..."
          rows="5"
          class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-app-border bg-app-input
                 text-app-text placeholder-app-muted focus:outline-none focus:border-app-accent
                 transition-colors resize-y min-h-[100px]"
        ></textarea>
        <p class="text-xs text-app-muted mt-1.5">自定义提示词将注入到每轮对话的开头，用于设定 AI 角色、行为规则和回答风格。</p>
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
              ? 'border-app-accent bg-app-accent-soft text-app-accent font-medium'
              : 'border-app-border bg-app-input text-app-heading hover:bg-app-hover'"
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
          class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-app-border bg-app-input
                 text-app-text focus:outline-none focus:border-app-accent transition-colors"
        >
          <option v-for="s in [10,12,14,16,18,20,22,24,26,28]" :key="s" :value="s">{{ s }}px</option>
        </select>
      </div>

      <!-- 字体族 -->
      <div class="mb-8">
        <label class="block text-sm font-medium text-app-heading mb-2">字体</label>
        <select
          :value="settings.fontFamily"
          @change="settings.fontFamily = ($event.target as HTMLSelectElement).value"
          class="w-full px-3.5 py-2.5 text-sm rounded-lg border border-app-border bg-app-input
                 text-app-text focus:outline-none focus:border-app-accent transition-colors"
          :style="{ fontFamily: settings.fontFamily || 'inherit' }"
        >
          <option v-for="f in settings.fontOptions" :key="f.value" :value="f.value">{{ f.label }}</option>
        </select>
      </div>

      <!-- 主题颜色 -->
      <div class="mb-8">
        <label class="block text-sm font-medium text-app-heading mb-2">主题颜色</label>
        <div class="flex gap-2">
          <button
            v-for="t in themes"
            :key="t.id"
            @click="theme.setTheme(t.id)"
            class="flex-1 px-3 py-2.5 text-sm rounded-lg border transition-colors text-center"
            :class="theme.themeName.value === t.id
              ? 'border-app-accent bg-app-accent-soft text-app-accent font-medium'
              : 'border-app-border bg-app-input text-app-heading hover:bg-app-hover'"
          >
            <span class="inline-block w-3 h-3 rounded-full mr-1.5 align-middle" :style="{ backgroundColor: t.color }"></span>
            {{ t.label }}
          </button>
        </div>
        <label class="inline-flex items-center gap-2 mt-3 cursor-pointer">
          <input type="checkbox" :checked="theme.themeMode.value === 'dark'" @change="theme.toggleMode()" class="rounded" />
          <span class="text-sm text-app-text">暗色模式</span>
        </label>
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
        <p class="text-sm text-app-muted">DeepSeek Desktop v1.5.1</p>
        <p class="text-xs text-app-muted mt-1">Electron + Vue 3 + Tailwind CSS</p>
      </div>
    </div>
  </div>
</template>
