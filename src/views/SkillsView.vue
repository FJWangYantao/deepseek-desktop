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

function cancelEdit() {
  showForm.value = false
  editing.value = null
  dslValidationError.value = ''
}

async function handleSave() {
  let content = form.value.content.trim()
  const meta = {
    name: form.value.name.trim(),
    description: form.value.description.trim(),
    version: form.value.version.trim() || '1.0.0',
    tags: form.value.tags.split(',').map(s => s.trim()).filter(Boolean),
  }

  if (formMode.value === 'dsl' && formSteps.value.length > 0) {
    content = serializeDSL(meta, content, formSteps.value)
  }

  const skill: SkillMeta = {
    id: form.value.id,
    name: meta.name,
    description: meta.description,
    version: meta.version,
    tags: meta.tags,
    content,
  }
  if (!skill.name || !content) return
  await store.saveSkill(skill)
  showForm.value = false
  editing.value = null
}

async function handleDelete(id: string) {
  if (!confirm('确定删除这个 Skill？')) return
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
    if (result) {
      importUrl.value = ''
      await store.loadSkills()
    } else {
      alert('导入失败，请检查 URL 是否正确，或该 Skill 已存在')
    }
  } finally {
    importing.value = false
  }
}

// 推荐社区 Skill 仓库
const featuredRepos = [
  { name: 'Anthropic 官方 Skills', url: 'https://raw.githubusercontent.com/anthropics/claude-code/main/.claude/skills/brainstorming/SKILL.md', desc: '头脑风暴 & 设计讨论' },
  { name: 'Claude Code Skills 合集', url: 'https://raw.githubusercontent.com/anthropics/claude-code/main/.claude/skills/writing-plans/SKILL.md', desc: '实现计划编写' },
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
      <h1 class="text-base font-semibold text-app-text">Skill 管理</h1>
      <div class="flex-1" />
      <button
        @click="openNew()"
        class="px-3 py-1.5 text-xs font-medium rounded-lg text-white bg-app-accent hover:bg-app-accent-hover transition-colors"
      >
        + 新建
      </button>
    </div>

    <div class="flex-1 overflow-y-auto px-8 py-6">
      <!-- 搜索 -->
      <input
        v-model="searchQuery"
        placeholder="搜索 Skill..."
        class="w-full px-3.5 py-2 text-sm rounded-lg border border-app-border bg-app-input
               text-app-text placeholder-app-muted focus:outline-none focus:border-app-accent
               transition-colors mb-4"
      />

      <!-- 导入 -->
      <div class="mb-6 p-4 rounded-xl border border-app-border bg-app-surface-alt">
        <h3 class="text-sm font-medium text-app-heading mb-3">从社区导入 Skill</h3>
        <div class="flex gap-2 mb-3">
          <input
            v-model="importUrl"
            placeholder="粘贴 Skill 的 Raw URL（GitHub raw URL）"
            class="flex-1 px-3 py-2 text-sm rounded-lg border border-app-border bg-app-input
                   text-app-text placeholder-app-muted focus:outline-none focus:border-app-accent"
          />
          <button
            @click="handleImport"
            :disabled="!importUrl.trim() || importing"
            class="px-4 py-2 text-xs font-medium rounded-lg text-white bg-app-accent hover:bg-app-accent-hover
                   disabled:opacity-40 transition-colors shrink-0"
          >
            {{ importing ? '导入中...' : '导入' }}
          </button>
        </div>
        <div class="flex flex-wrap gap-2">
          <span class="text-xs text-app-muted">推荐：</span>
          <button
            v-for="repo in featuredRepos" :key="repo.url"
            @click="importUrl = repo.url"
            class="text-xs px-2 py-1 rounded-md border border-app-border text-app-muted hover:border-app-accent hover:text-app-accent transition-colors"
          >
            {{ repo.name }}
          </button>
        </div>
      </div>

      <!-- 编辑表单 -->
      <div v-if="showForm" class="mb-6 p-4 rounded-xl border border-app-accent bg-app-accent-soft">
        <input v-model="form.name" placeholder="名称" class="w-full px-3 py-2 mb-2 text-sm rounded-lg border border-app-border bg-app-input text-app-text focus:outline-none focus:border-app-accent" />
        <input v-model="form.description" placeholder="描述" class="w-full px-3 py-2 mb-2 text-sm rounded-lg border border-app-border bg-app-input text-app-text focus:outline-none focus:border-app-accent" />
        <div class="flex gap-2 mb-2">
          <input v-model="form.version" placeholder="版本" class="flex-1 px-3 py-2 text-sm rounded-lg border border-app-border bg-app-input text-app-text focus:outline-none focus:border-app-accent" />
          <input v-model="form.tags" placeholder="标签 (逗号分隔)" class="flex-[2] px-3 py-2 text-sm rounded-lg border border-app-border bg-app-input text-app-text focus:outline-none focus:border-app-accent" />
        </div>

        <!-- 模式切换 -->
        <div class="flex items-center gap-1 mb-3 bg-app-hover rounded-lg p-0.5 w-fit">
          <button @click="formMode = 'text'" class="px-3 py-1 text-xs rounded-md transition-colors"
            :class="formMode === 'text' ? 'bg-white text-app-text shadow-sm font-medium' : 'text-app-muted hover:text-app-text'"
          >纯文本</button>
          <button @click="formMode = 'dsl'" class="px-3 py-1 text-xs rounded-md transition-colors"
            :class="formMode === 'dsl' ? 'bg-white text-app-text shadow-sm font-medium' : 'text-app-muted hover:text-app-text'"
          >DSL 步骤</button>
        </div>

        <!-- DSL 验证警告 -->
        <div v-if="dslValidationError" class="mb-3 px-3 py-2 rounded-lg text-xs bg-amber-50 text-amber-700 border border-amber-200">
          {{ dslValidationError }}
        </div>

        <!-- 纯文本编辑器 -->
        <textarea v-if="formMode === 'text'" v-model="form.content" placeholder="Prompt 内容（支持 Markdown）" rows="8"
          class="w-full px-3 py-2 mb-3 text-sm rounded-lg border border-app-border bg-app-input text-app-text font-mono focus:outline-none focus:border-app-accent resize-y"
        ></textarea>

        <!-- DSL 步骤编辑器 -->
        <div v-if="formMode === 'dsl'" class="mb-3">
          <DSLStepEditor :steps="formSteps" @update:steps="formSteps = $event" />
        </div>

        <div class="flex gap-2">
          <button @click="handleSave" class="px-4 py-1.5 text-xs font-medium rounded-lg text-white bg-app-accent hover:bg-app-accent-hover">保存</button>
          <button @click="cancelEdit" class="px-4 py-1.5 text-xs font-medium rounded-lg border border-app-border text-app-muted hover:bg-app-hover">取消</button>
        </div>
      </div>

      <!-- Skill 列表 -->
      <div v-if="store.loading" class="text-sm text-app-muted text-center py-12">加载中...</div>
      <div v-else-if="filteredSkills.length === 0" class="text-sm text-app-muted text-center py-12">
        {{ searchQuery ? '没有匹配的 Skill' : '还没有 Skill，点击右上角"新建"创建' }}
      </div>
      <div v-else class="space-y-3">
        <div
          v-for="s in filteredSkills"
          :key="s.id"
          class="p-4 rounded-xl border border-app-border bg-app-input hover:border-app-accent-soft-border transition-colors"
        >
          <div class="flex items-start justify-between mb-1.5">
            <div>
              <h3 class="text-sm font-medium text-app-heading">{{ s.name }}</h3>
              <p class="text-xs text-app-muted mt-0.5">{{ s.description }}</p>
            </div>
            <div class="flex gap-1 shrink-0 ml-4">
              <button @click="openEdit(s)" class="px-2.5 py-1 text-xs rounded-md border border-app-border text-app-muted hover:text-app-accent hover:border-app-accent transition-colors">编辑</button>
              <button @click="handleDelete(s.id)" class="px-2.5 py-1 text-xs rounded-md border border-red-200 text-red-500 hover:bg-red-50 transition-colors">删除</button>
            </div>
          </div>
          <div class="flex items-center gap-2 text-[11px] text-app-muted">
            <span>v{{ s.version }}</span>
            <span v-for="t in s.tags" :key="t" class="px-1.5 py-0.5 rounded bg-app-hover">{{ t }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
