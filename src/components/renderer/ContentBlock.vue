<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'
import hljs from 'highlight.js'
import { fixCjkEmphasis } from '@/composables/useMarkdown'

const props = defineProps<{
  content: string
}>()

const renderer = new marked.Renderer()

const langMap: Record<string, string> = {
  js: 'javascript', ts: 'typescript', py: 'python',
  rb: 'ruby', sh: 'bash', zsh: 'bash', yml: 'yaml',
}

renderer.code = function({ text, lang }: { text: string; lang?: string }) {
  const displayLang = lang ? (langMap[lang] || lang) : 'code'
  let highlighted: string
  try {
    const langName = lang && hljs.getLanguage(lang) ? lang : undefined
    highlighted = langName
      ? hljs.highlight(text, { language: langName }).value
      : hljs.highlightAuto(text).value
  } catch {
    highlighted = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  return `
<div class="code-block-wrapper group my-4 rounded-xl border border-app-border bg-app-surface-alt overflow-hidden">
  <div class="flex items-center justify-between px-4 py-2 border-b border-app-border bg-app-hover">
    <span class="text-xs text-app-muted font-mono">${displayLang}</span>
    <button class="copy-btn text-xs px-2 py-0.5 rounded-md text-app-muted hover:text-app-text hover:bg-app-hover-strong transition-colors" data-code="${escaped}">
      复制
    </button>
  </div>
  <pre class="p-4 overflow-x-auto text-[13px] leading-[1.8] font-mono text-app-text"><code>${highlighted}</code></pre>
</div>`
}

renderer.table = function({ header, rows }: { header: { text: string }[]; rows: { text: string }[][] }) {
  const thead = header.map(cell =>
    `<th class="px-3 py-2 text-left text-xs font-medium text-app-heading bg-app-hover border-b border-app-border">${cell.text}</th>`
  ).join('')

  const tbody = rows.map((row, i) =>
    `<tr class="${i % 2 === 0 ? 'bg-app-input' : 'bg-app-surface-alt'} border-b border-app-border-light last:border-b-0">
      ${row.map(cell => `<td class="px-3 py-2 text-sm text-app-text border-r border-app-border-light last:border-r-0">${cell.text}</td>`).join('')}
    </tr>`
  ).join('')

  return `
<div class="my-4 overflow-x-auto rounded-lg border border-app-border">
  <table class="w-full border-collapse text-sm">
    <thead><tr>${thead}</tr></thead>
    <tbody>${tbody}</tbody>
  </table>
</div>`
}

marked.setOptions({
  renderer,
  breaks: true,
  gfm: true,
})

const html = computed(() => {
  if (!props.content) return ''
  return marked.parse(fixCjkEmphasis(props.content)) as string
})

// 事件委托：处理复制按钮点击
function onCodeCopy(e: Event) {
  const btn = (e.target as HTMLElement).closest('.copy-btn') as HTMLElement | null
  if (!btn) return
  const code = btn.dataset.code
  if (!code) return
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = '已复制'
    btn.classList.add('text-green-600', 'bg-green-50')
    setTimeout(() => {
      btn.textContent = '复制'
      btn.classList.remove('text-green-600', 'bg-green-50')
    }, 2000)
  }).catch(() => {})
}
</script>

<template>
  <div
    class="markdown-body text-app-text leading-[1.8] prose-sm max-w-none
           prose-headings:text-app-heading prose-p:text-app-text prose-strong:text-app-text
           prose-a:text-app-accent prose-a:no-underline hover:prose-a:underline
           prose-code:text-inherit prose-code:bg-transparent prose-code:p-0 prose-code:text-xs prose-code:font-normal
           prose-pre:p-0 prose-pre:bg-transparent prose-pre:m-0
           prose-li:text-app-text prose-table:border-app-border"
    :style="{ fontSize: 'var(--app-font-size)' }"
    v-html="html"
    @click="onCodeCopy"
  />
</template>
