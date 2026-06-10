<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSkillStore } from '@/stores/skills'
import type { SkillMeta } from '../../electron/ipc/skills'
import DSLStepEditor from '@/components/skills/DSLStepEditor.vue'
import { parseDSL, isDSLContent } from '@/utils/dsl-parser'
import { serializeDSL } from '@/utils/dsl-serializer'
import type { DSLStep } from '@/types/dsl'

const router = useRouter()
const store = useSkillStore()
const editing = ref<SkillMeta | null>(null)
const showForm = ref(false)
const showImport = ref(false)
const formMode = ref<'text' | 'dsl'>('text')
const formSteps = ref<DSLStep[]>([])
const dslValidationError = ref('')

const form = ref({ id: '', name: '', description: '', version: '1.0.0', tags: '', content: '' })
const searchQuery = ref('')

const filteredSkills = computed(() => {
  if (!searchQuery.value) return store.skills
  const q = searchQuery.value.toLowerCase()
  return store.skills.filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.description.toLowerCase().includes(q) ||
    s.tags.some(t => t.toLowerCase().includes(q))
  )
})

onMounted(() => { store.loadSkills() })

function openNew() {
  form.value = { id: Date.now().toString(36), name: '', description: '', version: '1.0.0', tags: '', content: '' }
  formSteps.value = []
  editing.value = null
  formMode.value = 'text'
  dslValidationError.value = ''
  showForm.value = true
}

function openEdit(skill: SkillMeta) {
  form.value = { id: skill.id, name: skill.name, description: skill.description, version: skill.version, tags: skill.tags.join(', '), content: skill.content }
  editing.value = skill
  formMode.value = isDSLContent(skill.content) ? 'dsl' : 'text'
  if (formMode.value === 'dsl') {
    const parsed = parseDSL(skill.content)
    formSteps.value = parsed.steps || []
    dslValidationError.value = parsed.errors.length > 0 ? `DSL 解析警告: ${parsed.errors[0].message}` : ''
  } else {
    formSteps.value = []
    dslValidationError.value = ''
  }
  showForm.value = true
}

function cancelEdit() { showForm.value = false; editing.value = null; dslValidationError.value = '' }

async function handleSave() {
  let content = form.value.content.trim()
  const meta = { name: form.value.name.trim(), description: form.value.description.trim(), version: form.value.version.trim() || '1.0.0', tags: form.value.tags.split(',').map(s => s.trim()).filter(Boolean) }
  if (formMode.value === 'dsl' && formSteps.value.length > 0) content = serializeDSL(meta, content, formSteps.value)
  const skill: SkillMeta = { id: form.value.id, name: meta.name, description: meta.description, version: meta.version, tags: meta.tags, content }
  if (!skill.name || !content) return
  await store.saveSkill(skill)
  showForm.value = false
  editing.value = null
}

async function handleDelete(id: string) {
  if (!confirm('确定删除？')) return
  await store.deleteSkill(id)
}

const importUrl = ref('')
const importing = ref(false)

async function handleImport() {
  const url = importUrl.value.trim()
  if (!url || !window.electronAPI?.importSkill) return
  importing.value = true
  try {
    const result = await window.electronAPI.importSkill(url)
    if (result) { importUrl.value = ''; showImport.value = false; await store.loadSkills() }
    else { alert('导入失败') }
  } finally { importing.value = false }
}

const featuredRepos = [
  { name: '头脑风暴', url: 'https://raw.githubusercontent.com/anthropics/claude-code/main/.claude/skills/brainstorming/SKILL.md' },
  { name: '实现计划', url: 'https://raw.githubusercontent.com/anthropics/claude-code/main/.claude/skills/writing-plans/SKILL.md' },
]
</script>

<template>
  <div class="flex-1 flex flex-col min-w-0 bg-app-bg">
    <!-- 顶栏 -->
    <div class="flex items-center gap-3 px-5 py-3 border-b border-app-border/40">
      <button @click="router.push('/')" class="w-7 h-7 flex items-center justify-center rounded-md text-app-muted hover:text-app-text transition-colors">
        <svg class="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 19l-7-7 7-7" /></svg>
      </button>
      <h1 class="text-sm font-medium text-app-text">Skills</h1>
      <div class="flex-1" />
      <button @click="showImport = !showImport" class="text-xs text-app-muted/60 hover:text-app-text transition-colors">导入</button>
      <button @click="openNew()" class="ml-3 px-3.5 py-1.5 text-xs font-medium rounded-md bg-app-text text-app-bg hover:opacity-80 transition-opacity">新建</button>
    </div>

    <div class="flex-1 overflow-y-auto">
      <div class="max-w-xl mx-auto px-6 py-8 space-y-6">

        <!-- 搜索 -->
        <div class="relative">
          <svg class="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-app-muted/40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input v-model="searchQuery" placeholder="搜索..." class="w-full pl-9 pr-4 py-2.5 text-sm border border-app-border/50 rounded-lg bg-transparent text-app-text placeholder:text-app-muted/50 focus:outline-none focus:border-app-text/60 transition-colors" />
        </div>

        <!-- 导入面板 -->
        <Transition name="tool-expand">
          <div v-if="showImport" class="border border-app-border/40 rounded-lg p-4 space-y-3">
            <div class="flex gap-2">
              <input v-model="importUrl" placeholder="粘贴 Skill Raw URL" class="flex-1 px-3.5 py-2 text-sm border border-app-border/50 rounded-lg bg-transparent text-app-text placeholder:text-app-muted/50 focus:outline-none focus:border-app-text/60 transition-colors" />
              <button @click="handleImport" :disabled="!importUrl.trim() || importing" class="px-3.5 py-2 text-xs font-medium rounded-md bg-app-text text-app-bg hover:opacity-80 disabled:opacity-30 transition-opacity shrink-0">{{ importing ? '...' : '导入' }}</button>
            </div>
            <div class="flex gap-2">
              <button v-for="repo in featuredRepos" :key="repo.url" @click="importUrl = repo.url" class="text-xs px-2.5 py-1 rounded-md border border-app-border/30 text-app-muted hover:text-app-text hover:border-app-border/60 transition-colors">{{ repo.name }}</button>
            </div>
          </div>
        </Transition>

        <!-- 编辑表单 -->
        <div v-if="showForm" class="pt-6 border-t border-app-border/30 space-y-3">
          <p class="text-xs font-medium text-app-muted mb-2">{{ editing ? '编辑' : '新建' }} Skill</p>
          <input v-model="form.name" placeholder="名称" class="w-full px-3.5 py-2.5 text-sm border border-app-border/50 rounded-lg bg-transparent text-app-text placeholder:text-app-muted/50 focus:outline-none focus:border-app-text/60 transition-colors" />
          <input v-model="form.description" placeholder="描述" class="w-full px-3.5 py-2.5 text-sm border border-app-border/50 rounded-lg bg-transparent text-app-text placeholder:text-app-muted/50 focus:outline-none focus:border-app-text/60 transition-colors" />
          <div class="flex gap-2">
            <input v-model="form.version" placeholder="版本" class="flex-1 px-3.5 py-2.5 text-sm border border-app-border/50 rounded-lg bg-transparent text-app-text placeholder:text-app-muted/50 focus:outline-none focus:border-app-text/60 transition-colors" />
            <input v-model="form.tags" placeholder="标签(逗号)" class="flex-[2] px-3.5 py-2.5 text-sm border border-app-border/50 rounded-lg bg-transparent text-app-text placeholder:text-app-muted/50 focus:outline-none focus:border-app-text/60 transition-colors" />
          </div>
          <!-- 模式切换 -->
          <div class="flex gap-3 text-xs">
            <button @click="formMode = 'text'" class="pb-0.5 transition-colors" :class="formMode === 'text' ? 'text-app-text border-b border-app-text' : 'text-app-muted/60 hover:text-app-text'">文本</button>
            <button @click="formMode = 'dsl'" class="pb-0.5 transition-colors" :class="formMode === 'dsl' ? 'text-app-text border-b border-app-text' : 'text-app-muted/60 hover:text-app-text'">DSL</button>
          </div>
          <div v-if="dslValidationError" class="text-xs text-amber-600/80 px-3 py-2 border border-amber-300/30 rounded-lg">{{ dslValidationError }}</div>
          <textarea v-if="formMode === 'text'" v-model="form.content" placeholder="Prompt 内容" rows="8" class="w-full px-3.5 py-2.5 text-sm border border-app-border/50 rounded-lg bg-transparent text-app-text font-mono placeholder:text-app-muted/50 focus:outline-none focus:border-app-text/60 transition-colors resize-y" />
          <DSLStepEditor v-if="formMode === 'dsl'" :steps="formSteps" @update:steps="formSteps = $event" />
          <div class="flex gap-2 pt-2">
            <button @click="handleSave" class="px-4 py-2 text-xs font-medium rounded-md bg-app-text text-app-bg hover:opacity-80 transition-opacity">保存</button>
            <button @click="cancelEdit" class="px-3 py-1.5 text-xs text-app-muted hover:text-app-text transition-colors">取消</button>
          </div>
        </div>

        <!-- 列表 -->
        <div v-if="!showForm">
          <div v-if="store.loading" class="text-center py-16">
            <svg class="w-4 h-4 animate-spin mx-auto text-app-muted/40" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          </div>
          <div v-else-if="filteredSkills.length === 0" class="text-center py-16">
            <svg class="w-12 h-12 mx-auto text-app-muted/20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
            <p class="text-sm text-app-muted/60 mt-3">{{ searchQuery ? '无匹配结果' : '还没有 Skill' }}</p>
          </div>
          <div v-else class="divide-y divide-app-border/20">
            <div
              v-for="s in filteredSkills" :key="s.id"
              class="group flex items-center gap-3 py-4 cursor-default"
            >
              <div class="min-w-0 flex-1">
                <p class="text-sm text-app-text">{{ s.name }}</p>
                <p class="text-xs text-app-muted/60 truncate mt-0.5">{{ s.description }}</p>
              </div>
              <div class="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button @click="openEdit(s)" class="text-xs text-app-muted hover:text-app-text transition-colors">编辑</button>
                <button @click="handleDelete(s.id)" class="text-xs text-app-muted hover:text-red-500 transition-colors">删除</button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>
