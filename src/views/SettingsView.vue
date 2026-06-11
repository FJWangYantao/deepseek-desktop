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

const permissionModes = [
  { id: 'confirm' as const, label: '确认', desc: '高风险操作前询问，保持默认安全体验。' },
  { id: 'auto' as const, label: 'Auto', desc: '普通写入和安全工具自动执行，危险写入直接拒绝。' },
  { id: 'yolo' as const, label: 'YOLO', desc: '跳过确认，但仍尊重禁用规则和危险写入拦截。' },
]
</script>

<template>
  <div class="flex-1 flex flex-col min-w-0 bg-app-bg">
    <!-- 顶栏 -->
    <div class="flex items-center gap-3 px-5 py-3 border-b border-app-border/40">
      <button @click="router.push('/')" class="w-7 h-7 flex items-center justify-center rounded-md text-app-muted hover:text-app-text transition-colors">
        <svg class="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 19l-7-7 7-7" /></svg>
      </button>
      <h1 class="text-sm font-medium text-app-text">设置</h1>
    </div>

    <!-- 内容区 -->
    <div class="flex-1 overflow-y-auto">
      <div class="max-w-xl mx-auto px-6 py-8 space-y-8">

        <!-- API Key -->
        <section>
          <label class="text-xs font-medium text-app-muted mb-3 block">API Key</label>
          <input
            :type="settings.showKey ? 'text' : 'password'"
            :value="settings.apiKey"
            @input="settings.apiKey = ($event.target as HTMLInputElement).value"
            placeholder="sk-..."
            class="w-full px-3.5 py-2.5 text-sm border border-app-border/50 rounded-lg bg-transparent
                   text-app-text placeholder:text-app-muted/50 focus:outline-none focus:border-app-text/60
                   transition-colors font-mono"
          />
          <label class="inline-flex items-center gap-1.5 mt-2 text-xs text-app-muted cursor-pointer select-none">
            <input type="checkbox" v-model="settings.showKey" class="rounded border-app-border/50" /> 显示
          </label>
        </section>

        <!-- 模型 -->
        <section class="pt-6 border-t border-app-border/30">
          <label class="text-xs font-medium text-app-muted mb-3 block">默认模型</label>
          <div class="space-y-1">
            <button
              v-for="m in settings.models" :key="m.id"
              @click="settings.defaultModel = m.id"
              class="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm transition-colors text-left"
              :class="settings.defaultModel === m.id
                ? 'bg-app-text/5 text-app-text'
                : 'text-app-muted hover:text-app-text hover:bg-app-text/[0.02]'"
            >
              <span class="w-3 h-3 rounded-full border-2 flex items-center justify-center shrink-0"
                :class="settings.defaultModel === m.id ? 'border-app-text' : 'border-app-border'"
              >
                <span v-if="settings.defaultModel === m.id" class="w-1.5 h-1.5 rounded-full bg-app-text"></span>
              </span>
              <span>{{ m.name }}</span>
            </button>
          </div>
          <p class="text-xs text-app-muted/70 mt-2 pl-7">{{ settings.models.find(m => m.id === settings.defaultModel)?.description }}</p>
        </section>

        <!-- 视觉模型 -->
        <section class="pt-6 border-t border-app-border/30">
          <label class="text-xs font-medium text-app-muted mb-1 block">视觉模型</label>
          <p class="text-xs text-app-muted/60 mb-3">图片理解，上传图片后自动生成描述注入对话</p>
          <div class="space-y-2">
            <input :type="settings.showKey ? 'text' : 'password'" :value="settings.mimoApiKey" @input="settings.mimoApiKey = ($event.target as HTMLInputElement).value" placeholder="API Key（可选）" class="w-full px-3.5 py-2.5 text-sm border border-app-border/50 rounded-lg bg-transparent text-app-text placeholder:text-app-muted/50 focus:outline-none focus:border-app-text/60 transition-colors font-mono" />
            <div class="grid grid-cols-2 gap-2">
              <input :value="settings.mimoBaseUrl" @input="settings.mimoBaseUrl = ($event.target as HTMLInputElement).value" placeholder="API 地址" class="px-3.5 py-2.5 text-sm border border-app-border/50 rounded-lg bg-transparent text-app-text placeholder:text-app-muted/50 focus:outline-none focus:border-app-text/60 transition-colors font-mono" />
              <input :value="settings.mimoModel" @input="settings.mimoModel = ($event.target as HTMLInputElement).value" placeholder="模型名称" class="px-3.5 py-2.5 text-sm border border-app-border/50 rounded-lg bg-transparent text-app-text placeholder:text-app-muted/50 focus:outline-none focus:border-app-text/60 transition-colors font-mono" />
            </div>
          </div>
        </section>

        <!-- 提示词 -->
        <section class="pt-6 border-t border-app-border/30">
          <div class="flex items-center justify-between mb-3">
            <label class="text-xs font-medium text-app-muted">提示词</label>
            <a href="https://api-docs.deepseek.com/zh-cn/prompt-library/" target="_blank" class="text-xs text-app-muted/60 hover:text-app-text transition-colors">官方库 →</a>
          </div>
          <div class="-mx-6 px-6 overflow-x-auto scrollbar-none">
            <div class="flex gap-1.5 pb-2" style="width: max-content">
              <button
                v-for="t in settings.promptTemplates" :key="t.id"
                @click="settings.selectRole(t.id)"
                class="shrink-0 px-3 py-1.5 rounded-md text-xs transition-colors whitespace-nowrap border"
                :class="settings.activeRoleId === t.id
                  ? 'border-app-text/40 text-app-text bg-app-text/5'
                  : 'border-app-border/30 text-app-muted hover:text-app-text hover:border-app-border/60'"
              >
                <span class="mr-1">{{ t.icon }}</span>{{ t.name }}
              </button>
            </div>
          </div>
          <textarea
            :value="settings.systemPrompt"
            @input="settings.systemPrompt = ($event.target as HTMLTextAreaElement).value; settings.activeRoleId = 'custom'"
            placeholder="系统提示词..."
            rows="4"
            class="mt-3 w-full px-3.5 py-2.5 text-sm border border-app-border/50 rounded-lg bg-transparent
                   text-app-text placeholder:text-app-muted/50 focus:outline-none focus:border-app-text/60
                   transition-colors resize-y min-h-[80px]"
          ></textarea>
        </section>

        <!-- 显示 -->
        <section class="pt-6 border-t border-app-border/30">
          <label class="text-xs font-medium text-app-muted mb-3 block">显示</label>
          <div class="grid grid-cols-3 gap-2">
            <select :value="settings.fontSize" @change="settings.fontSize = Number(($event.target as HTMLSelectElement).value)" class="px-3 py-2.5 text-sm border border-app-border/50 rounded-lg bg-transparent text-app-text focus:outline-none focus:border-app-text/60 transition-colors cursor-pointer appearance-none">
              <option v-for="s in [12,14,16,18,20,22,24]" :key="s" :value="s">{{ s }}px</option>
            </select>
            <select :value="settings.fontFamily" @change="settings.fontFamily = ($event.target as HTMLSelectElement).value" class="px-3 py-2.5 text-sm border border-app-border/50 rounded-lg bg-transparent text-app-text focus:outline-none focus:border-app-text/60 transition-colors cursor-pointer appearance-none" :style="{ fontFamily: settings.fontFamily || 'inherit' }">
              <option v-for="f in settings.fontOptions" :key="f.value" :value="f.value">{{ f.label }}</option>
            </select>
            <select :value="settings.codeTheme" @change="settings.codeTheme = ($event.target as HTMLSelectElement).value" class="px-3 py-2.5 text-sm border border-app-border/50 rounded-lg bg-transparent text-app-text focus:outline-none focus:border-app-text/60 transition-colors cursor-pointer appearance-none">
              <option v-for="t in settings.codeThemes" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </div>
        </section>

        <!-- 主题 -->
        <section class="pt-6 border-t border-app-border/30">
          <label class="text-xs font-medium text-app-muted mb-3 block">主题</label>
          <div class="flex items-center gap-3">
            <button
              v-for="t in themes" :key="t.id"
              @click="theme.setTheme(t.id)"
              class="w-5 h-5 rounded-full transition-all"
              :class="theme.themeName.value === t.id ? 'ring-2 ring-offset-2 ring-app-text/60 scale-110' : 'opacity-60 hover:opacity-100'"
              :style="{ backgroundColor: t.color, '--tw-ring-offset-color': 'var(--app-bg)' }"
              :title="t.label"
            />
            <div class="ml-auto flex items-center gap-2">
              <span class="text-xs text-app-muted">暗色</span>
              <button
                @click="theme.toggleMode()"
                class="relative w-9 h-[18px] rounded-full transition-colors"
                :class="theme.themeMode.value === 'dark' ? 'bg-app-text/80' : 'bg-app-border/60'"
              >
                <span
                  class="absolute top-[2px] w-[14px] h-[14px] rounded-full bg-app-bg shadow-sm transition-transform"
                  :class="theme.themeMode.value === 'dark' ? 'translate-x-[19px]' : 'translate-x-[2px]'"
                />
              </button>
            </div>
          </div>
        </section>

        <!-- 工具权限 -->
        <section class="pt-6 border-t border-app-border/30">
          <label class="text-xs font-medium text-app-muted mb-3 block">工具权限</label>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="mode in permissionModes"
              :key="mode.id"
              @click="settings.setToolPermissionMode(mode.id)"
              class="px-3 py-2.5 rounded-lg text-left border transition-colors"
              :class="settings.toolPermissionMode === mode.id
                ? 'border-app-accent text-app-accent bg-app-accent-soft/30'
                : 'border-app-border/50 text-app-muted hover:text-app-text hover:bg-app-hover'"
            >
              <div class="text-xs font-medium">{{ mode.label }}</div>
              <div class="text-[11px] opacity-70 mt-1 leading-relaxed">{{ mode.desc }}</div>
            </button>
          </div>
          <p class="text-xs text-app-muted/70 mt-2 leading-relaxed">
            Auto 会自动批准普通写入并拒绝 .env、.ssh、系统目录和路径穿越等危险写入；YOLO 会跳过确认，但不会覆盖已禁用工具。
          </p>
        </section>

        <!-- 行为习惯学习（Instinct Engine） -->
        <section class="pt-6 border-t border-app-border/30">
          <label class="text-xs font-medium text-app-muted mb-3 block">行为习惯</label>
          <div class="space-y-3">
            <label class="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                v-model="settings.instinctEnabled"
                class="mt-0.5 rounded border-app-border/50"
              />
              <div class="flex-1">
                <div class="text-xs text-app-text">启用行为习惯学习</div>
                <div class="text-xs text-app-muted mt-0.5 leading-relaxed">
                  会话切换时分析行为流，自动提炼工具偏好、工作流模式，并在下次对话中注入到 AI 上下文。
                </div>
              </div>
            </label>
            <label class="flex items-start gap-3 cursor-pointer select-none" :class="{ 'opacity-40': !settings.instinctEnabled }">
              <input
                type="checkbox"
                v-model="settings.instinctSemanticEnabled"
                :disabled="!settings.instinctEnabled"
                class="mt-0.5 rounded border-app-border/50"
              />
              <div class="flex-1">
                <div class="text-xs text-app-text">启用语义层面分析</div>
                <div class="text-xs text-app-muted mt-0.5 leading-relaxed">
                  额外用 LLM 提炼统计路径无法识别的复杂模式（任务类型→行为偏好等）。会消耗少量 Token，默认关闭。
                </div>
              </div>
            </label>
          </div>
        </section>

        <!-- 底部 -->
        <section class="pt-6 border-t border-app-border/30 pb-6">
          <div class="flex items-center justify-between text-xs text-app-muted">
            <span>DeepSeek Desktop · v1.9.0</span>
            <button
              @click="settings.clearAllData()"
              class="text-app-muted/60 hover:text-red-500 transition-colors"
            >清除所有数据</button>
          </div>
        </section>

      </div>
    </div>
  </div>
</template>
