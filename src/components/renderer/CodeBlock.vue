<script setup lang="ts">
import { ref, computed } from 'vue'
import hljs from 'highlight.js'

const props = defineProps<{
  code: string
  lang?: string
}>()

const copied = ref(false)

const highlighted = computed(() => {
  if (!props.code) return ''
  try {
    if (props.lang && hljs.getLanguage(props.lang)) {
      return hljs.highlight(props.code, { language: props.lang }).value
    }
    return hljs.highlightAuto(props.code).value
  } catch {
    return props.code
  }
})

async function copy() {
  try {
    await navigator.clipboard.writeText(props.code)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    // fallback
  }
}
</script>

<template>
  <div class="relative group my-4 rounded-xl border border-app-border bg-[#f9f8f5] overflow-hidden">
    <!-- 语言标签 + 复制按钮 -->
    <div class="flex items-center justify-between px-4 py-2 border-b border-app-border bg-[#f3f0eb]">
      <span class="text-xs text-app-muted font-mono">{{ lang || 'code' }}</span>
      <button
        @click="copy"
        class="text-xs px-2 py-0.5 rounded-md transition-colors"
        :class="copied ? 'text-green-600 bg-green-50' : 'text-app-muted hover:text-app-text hover:bg-[#e8e5db]'"
      >
        {{ copied ? '已复制' : '复制' }}
      </button>
    </div>
    <pre class="p-4 overflow-x-auto text-[13px] leading-relaxed font-mono text-app-text"><code v-html="highlighted" /></pre>
  </div>
</template>
