<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSkillStore } from '@/stores/skills'
import type { SkillIndex } from '@/types'
import type { ClawHubListItem } from '../../electron/skills/clawhub/types'

const router = useRouter()
const store = useSkillStore()

const searchQuery = ref('')
const showForm = ref(false)
const showImport = ref(false)
const editing = ref<SkillIndex | null>(null)
const readme = ref('')
const importUrl = ref('')
const importing = ref(false)

// ===== ClawHub 安装面板 =====
const showClawHub = ref(false)
const clawHubQuery = ref('')
const clawHubLoading = ref(false)
const clawHubError = ref('')
const clawHubResults = ref<ClawHubListItem[]>([])
const installingSlug = ref<string | null>(null)
const clawHubMsg = ref('')

// 已装 slug 集合,用于在结果里标记"已安装"
const installedIds = computed(() => new Set(store.skillIndex.map(s => s.id)))

async function runClawHubSearch() {
  clawHubLoading.value = true
  clawHubError.value = ''
  clawHubMsg.value = ''
  try {
    const res = await store.searchClawHub({ query: clawHubQuery.value.trim() || undefined, limit: 30 })
    if (res && 'error' in res) {
      clawHubError.value = res.error
      clawHubResults.value = []
    } else {
      clawHubResults.value = res?.items ?? []
    }
  } catch (e) {
    clawHubError.value = e instanceof Error ? e.message : String(e)
  } finally {
    clawHubLoading.value = false
  }
}

function toggleClawHub() {
  showClawHub.value = !showClawHub.value
  if (showClawHub.value && clawHubResults.value.length === 0 && !clawHubLoading.value) {
    runClawHubSearch()
  }
}

async function handleClawHubInstall(item: ClawHubListItem) {
  installingSlug.value = item.slug
  clawHubMsg.value = ''
  clawHubError.value = ''
  try {
    const overwrite = installedIds.value.has(item.slug)
    const result = await store.installFromClawHub({ slug: item.slug, overwrite })
    if (result.ok) {
      clawHubMsg.value = `已安装 ${item.slug} v${result.version}（${result.filesWritten} 个文件，${result.source === 'zip' ? '整包' : '逐文件'}）`
    } else {
      // file-sha256-mismatch 对二进制场景有误导,给更友好的提示
      if (result.errorCode === 'file-sha256-mismatch' || result.errorCode === 'fallback-blocked-by-large-file') {
        clawHubError.value = `安装失败：该 Skill 可能含二进制文件且整包校验未通过，暂不支持。（${result.errorCode}）`
      } else {
        clawHubError.value = `安装失败：${result.error || result.errorCode}`
      }
    }
  } catch (e) {
    clawHubError.value = e instanceof Error ? e.message : String(e)
  } finally {
    installingSlug.value = null
  }
}

const filteredSkills = computed(() => {
  if (!searchQuery.value) return store.skillIndex
  const q = searchQuery.value.toLowerCase()
  return store.skillIndex.filter(s =>
    (s.displayName || s.name).toLowerCase().includes(q) ||
    s.description.toLowerCase().includes(q) ||
    s.tags.some(t => t.toLowerCase().includes(q))
  )
})

const featuredRepos = [
  { name: 'frontend-design', url: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md' },
  { name: 'skill-creator', url: 'https://raw.githubusercontent.com/anthropics/skills/main/skills/skill-creator/SKILL.md' },
]

onMounted(() => {
  store.loadSkillIndex()
  store.loadTrust()
  store.loadEnvConfig()
})

// ===== 依赖体检 + env(每卡片内联) =====
const expandedDeps = ref<Set<string>>(new Set())
const depsRunning = ref<Set<string>>(new Set())
const envDrafts = ref<Record<string, string>>({})   // key: `${skillId}::${name}`

function envKey(skillId: string, name: string) { return `${skillId}::${name}` }

async function toggleDeps(skillId: string) {
  const next = new Set(expandedDeps.value)
  if (next.has(skillId)) {
    next.delete(skillId)
    expandedDeps.value = next
    return
  }
  next.add(skillId)
  expandedDeps.value = next
  if (!store.depsCache[skillId]) await runDeps(skillId)
}

async function runDeps(skillId: string) {
  const running = new Set(depsRunning.value)
  running.add(skillId)
  depsRunning.value = running
  try {
    await store.checkDeps(skillId, true)
    // 用已存值预填 env 输入框
    const report = store.depsCache[skillId]
    if (report) {
      for (const e of report.env) {
        const k = envKey(skillId, e.name)
        if (envDrafts.value[k] === undefined) envDrafts.value[k] = store.envValueOf(skillId, e.name)
      }
    }
  } finally {
    const r = new Set(depsRunning.value)
    r.delete(skillId)
    depsRunning.value = r
  }
}

async function saveEnv(skillId: string, name: string) {
  const k = envKey(skillId, name)
  const val = (envDrafts.value[k] ?? '').trim()
  await store.setSkillEnv(skillId, name, val === '' ? null : val)
  await runDeps(skillId)   // 重新体检,刷新 ✓/✗
}

// ===== trust 徽章 =====
type TrustState = 'trusted' | 'denied' | 'pending'
function trustState(skillId: string): TrustState {
  const d = store.trustOf(skillId)
  if (d === 'trusted') return 'trusted'
  if (d === 'denied') return 'denied'
  return 'pending'
}

async function handleRevokeTrust(skillId: string) {
  await store.revokeTrust(skillId)
}

async function handleDenyTrust(skillId: string) {
  await store.setTrust(skillId, 'denied')
}

function defaultReadme(id: string) {
  return `---\nname: ${id}\ndescription: 当用户需要 ${id} 相关专业能力时使用。请补充具体触发场景、任务类型和输出要求。\nversion: 1.0.0\ntags: []\ndisplayName: ${id}\n---\n\n# ${id}\n\n## 什么时候使用\n\n描述这个 Skill 适合处理哪些任务。\n\n## 工作流程\n\n1. 先理解用户目标。\n2. 按领域最佳实践完成任务。\n3. 输出清晰、可执行的结果。\n\n## 按需参考\n\n如果有较长资料，请放到 references/ 并在这里说明何时读取。\n`
}

function openNew() {
  const id = `custom-${Date.now().toString(36)}`
  editing.value = null
  readme.value = defaultReadme(id)
  showForm.value = true
}

async function openEdit(skill: SkillIndex) {
  const pkg = await store.getPackage(skill.id)
  if (!pkg) return
  editing.value = skill
  readme.value = pkg.readme
  showForm.value = true
}

function cancelEdit() {
  showForm.value = false
  editing.value = null
  readme.value = ''
}

function extractIdFromReadme(text: string) {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---/)
  const raw = match?.[1] || ''
  const name = raw.match(/^name:\s*(.+)$/m)?.[1]?.trim()
  return (name || `custom-${Date.now().toString(36)}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

async function handleSave() {
  const content = readme.value.trim()
  if (!content) return
  if (editing.value) {
    if (editing.value.kind === 'package') {
      await store.savePackage(editing.value.id, content)
    } else {
      const pkg = await store.getPackage(editing.value.id)
      await store.saveSkill({
        id: editing.value.id,
        name: editing.value.displayName || editing.value.name,
        description: editing.value.description,
        version: editing.value.version || '1.0.0',
        tags: editing.value.tags,
        content: pkg?.body || content,
      })
    }
  } else {
    await store.createPackage(extractIdFromReadme(content), content)
  }
  cancelEdit()
}

async function handleDelete(id: string) {
  if (!confirm('确定删除这个 Skill？')) return
  await store.deleteSkill(id)
}

async function handleImport() {
  const url = importUrl.value.trim()
  if (!url || !window.electronAPI?.importSkillPackageUrl) return
  importing.value = true
  try {
    const result = await window.electronAPI.importSkillPackageUrl(url)
    if (result) {
      importUrl.value = ''
      showImport.value = false
      await store.loadSkillIndex()
    } else {
      alert('导入失败')
    }
  } finally {
    importing.value = false
  }
}

async function handleMigrate(id: string) {
  const result = await store.migrateLegacy(id)
  if (!result) alert('迁移失败，可能已存在同名目录包')
}
</script>

<template>
  <div class="flex-1 flex flex-col min-w-0 bg-app-bg">
    <div class="flex items-center gap-3 px-5 py-3 border-b border-app-border/40">
      <button @click="router.push('/')" class="w-7 h-7 flex items-center justify-center rounded-md text-app-muted hover:text-app-text transition-colors">
        <svg class="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 19l-7-7 7-7" /></svg>
      </button>
      <h1 class="text-sm font-medium text-app-text">Skills</h1>
      <div class="flex-1" />
      <button @click="toggleClawHub()" class="text-xs transition-colors" :class="showClawHub ? 'text-app-accent' : 'text-app-muted/60 hover:text-app-text'">从 ClawHub 安装</button>
      <button @click="showImport = !showImport" class="ml-3 text-xs text-app-muted/60 hover:text-app-text transition-colors">导入</button>
      <button @click="openNew()" class="ml-3 px-3.5 py-1.5 text-xs font-medium rounded-md bg-app-text text-app-bg hover:opacity-80 transition-opacity">新建 Package</button>
    </div>

    <div class="flex-1 overflow-y-auto">
      <div class="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div class="rounded-xl border border-app-accent-soft-border bg-app-accent-soft/20 px-4 py-3">
          <div class="text-xs font-medium text-app-accent">Claude Skills 风格</div>
          <p class="text-xs text-app-muted mt-1 leading-relaxed">
            新版 Skill 使用目录包：<code>SKILL.md</code> + <code>references/</code> + <code>assets/</code> + <code>scripts/</code>。聊天中始终注入 Skill Index，模型每轮最多加载一个 Skill；scripts 通过受控的 skill_script_run 执行，首次运行需信任授权。
          </p>
        </div>

        <div class="relative">
          <svg class="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-app-muted/40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input v-model="searchQuery" placeholder="搜索 Skill..." class="w-full pl-9 pr-4 py-2.5 text-sm border border-app-border/50 rounded-lg bg-transparent text-app-text placeholder:text-app-muted/50 focus:outline-none focus:border-app-text/60 transition-colors" />
        </div>

        <Transition name="tool-expand">
          <div v-if="showImport" class="border border-app-border/40 rounded-lg p-4 space-y-3">
            <div class="flex gap-2">
              <input v-model="importUrl" placeholder="粘贴 SKILL.md Raw URL" class="flex-1 px-3.5 py-2 text-sm border border-app-border/50 rounded-lg bg-transparent text-app-text placeholder:text-app-muted/50 focus:outline-none focus:border-app-text/60 transition-colors" />
              <button @click="handleImport" :disabled="!importUrl.trim() || importing" class="px-3.5 py-2 text-xs font-medium rounded-md bg-app-text text-app-bg hover:opacity-80 disabled:opacity-30 transition-opacity shrink-0">{{ importing ? '...' : '导入' }}</button>
            </div>
            <div class="flex gap-2">
              <button v-for="repo in featuredRepos" :key="repo.url" @click="importUrl = repo.url" class="text-xs px-2.5 py-1 rounded-md border border-app-border/30 text-app-muted hover:text-app-text hover:border-app-border/60 transition-colors">{{ repo.name }}</button>
            </div>
          </div>
        </Transition>

        <!-- ClawHub 安装面板 -->
        <Transition name="tool-expand">
          <div v-if="showClawHub" class="border border-app-accent-soft-border rounded-lg p-4 space-y-3 bg-app-accent-soft/10">
            <div class="flex items-center justify-between">
              <div class="text-xs font-medium text-app-accent">ClawHub Registry</div>
              <span class="text-[10px] text-app-muted/60">来源经 VirusTotal 扫描；安装后仍需信任授权才能执行命令</span>
            </div>
            <div class="flex gap-2">
              <input
                v-model="clawHubQuery"
                @keydown.enter="runClawHubSearch"
                placeholder="搜索 ClawHub Skill（留空浏览热门）..."
                class="flex-1 px-3.5 py-2 text-sm border border-app-border/50 rounded-lg bg-transparent text-app-text placeholder:text-app-muted/50 focus:outline-none focus:border-app-text/60 transition-colors"
              />
              <button @click="runClawHubSearch" :disabled="clawHubLoading" class="px-3.5 py-2 text-xs font-medium rounded-md bg-app-text text-app-bg hover:opacity-80 disabled:opacity-30 transition-opacity shrink-0">{{ clawHubLoading ? '...' : '搜索' }}</button>
            </div>

            <p v-if="clawHubError" class="text-[11px] text-red-500 leading-relaxed">{{ clawHubError }}</p>
            <p v-if="clawHubMsg" class="text-[11px] text-app-accent leading-relaxed">{{ clawHubMsg }}</p>

            <div v-if="clawHubLoading" class="text-center py-6">
              <svg class="w-4 h-4 animate-spin mx-auto text-app-muted/40" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            </div>
            <div v-else-if="clawHubResults.length === 0 && !clawHubError" class="text-center py-6 text-xs text-app-muted/50">无结果</div>
            <div v-else class="space-y-1.5 max-h-80 overflow-y-auto">
              <div v-for="item in clawHubResults" :key="item.slug" class="flex items-start gap-3 rounded-lg border border-app-border/30 px-3 py-2.5">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="text-xs text-app-text truncate">{{ item.displayName || item.slug }}</span>
                    <span v-if="item.latestVersion" class="text-[10px] text-app-muted/60 shrink-0">v{{ item.latestVersion.version }}</span>
                    <span v-if="item.stats?.installsAllTime" class="text-[10px] text-app-muted/50 shrink-0">↓{{ item.stats.installsAllTime }}</span>
                  </div>
                  <p v-if="item.summary" class="text-[11px] text-app-muted/70 mt-0.5 leading-relaxed line-clamp-2">{{ item.summary }}</p>
                </div>
                <button
                  @click="handleClawHubInstall(item)"
                  :disabled="installingSlug === item.slug"
                  class="text-xs px-2.5 py-1 rounded-md shrink-0 transition-colors disabled:opacity-40"
                  :class="installedIds.has(item.slug) ? 'border border-app-border/40 text-app-muted hover:text-app-text' : 'bg-app-text text-app-bg hover:opacity-80'"
                >
                  {{ installingSlug === item.slug ? '安装中...' : (installedIds.has(item.slug) ? '重新安装' : '安装') }}
                </button>
              </div>
            </div>
          </div>
        </Transition>

        <div v-if="showForm" class="pt-6 border-t border-app-border/30 space-y-3">
          <div class="flex items-center justify-between">
            <p class="text-xs font-medium text-app-muted">{{ editing ? '编辑' : '新建' }} Skill Package</p>
            <span v-if="editing" class="text-[10px] px-1.5 py-0.5 rounded" :class="editing.kind === 'package' ? 'bg-app-accent-soft text-app-accent' : 'bg-amber-500/10 text-amber-500'">{{ editing.kind === 'package' ? 'PACKAGE' : 'LEGACY' }}</span>
          </div>
          <textarea v-model="readme" rows="18" class="w-full px-3.5 py-2.5 text-sm border border-app-border/50 rounded-lg bg-transparent text-app-text font-mono placeholder:text-app-muted/50 focus:outline-none focus:border-app-text/60 transition-colors resize-y" />
          <p class="text-xs text-app-muted/70 leading-relaxed">
            Package Skill 必须包含 frontmatter 的 name 和 description。description 是模型触发 Skill 的主要依据，请写清楚“什么时候使用”。
          </p>
          <div class="flex gap-2 pt-2">
            <button @click="handleSave" class="px-4 py-2 text-xs font-medium rounded-md bg-app-text text-app-bg hover:opacity-80 transition-opacity">保存</button>
            <button @click="cancelEdit" class="px-3 py-1.5 text-xs text-app-muted hover:text-app-text transition-colors">取消</button>
          </div>
        </div>

        <div v-if="!showForm">
          <div v-if="store.loading" class="text-center py-16">
            <svg class="w-4 h-4 animate-spin mx-auto text-app-muted/40" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          </div>
          <div v-else-if="filteredSkills.length === 0" class="text-center py-16">
            <p class="text-sm text-app-muted/60 mt-3">{{ searchQuery ? '无匹配结果' : '还没有 Skill' }}</p>
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="s in filteredSkills"
              :key="s.id"
              class="group rounded-xl border border-app-border/40 p-4 hover:bg-app-hover/40 transition-colors"
            >
              <div class="flex items-start gap-3">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 min-w-0">
                    <p class="text-sm text-app-text truncate">{{ s.displayName || s.name }}</p>
                    <span class="text-[10px] px-1.5 py-0.5 rounded shrink-0" :class="s.kind === 'package' ? 'bg-app-accent-soft text-app-accent' : 'bg-amber-500/10 text-amber-500'">{{ s.kind === 'package' ? 'PACKAGE' : 'LEGACY' }}</span>
                    <span v-if="s.hasReferences" class="text-[10px] text-app-muted">refs</span>
                    <span v-if="s.hasAssets" class="text-[10px] text-app-muted">assets</span>
                    <span v-if="s.hasScripts" class="text-[10px] text-app-muted">scripts</span>
                    <!-- trust 徽章：仅对声明了运行时依赖(可执行命令)的 Skill 显示 -->
                    <span
                      v-if="s.runtime"
                      class="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                      :class="{
                        'bg-emerald-500/10 text-emerald-500': trustState(s.id) === 'trusted',
                        'bg-red-500/10 text-red-500': trustState(s.id) === 'denied',
                        'bg-app-border/30 text-app-muted': trustState(s.id) === 'pending',
                      }"
                    >{{ trustState(s.id) === 'trusted' ? '已信任' : trustState(s.id) === 'denied' ? '已拒绝' : '未授权' }}</span>
                  </div>
                  <p class="text-xs text-app-muted/70 mt-1 leading-relaxed">{{ s.description }}</p>
                  <div v-if="!s.validation.ok || s.validation.warnings.length" class="mt-2 space-y-1">
                    <p v-for="e in s.validation.errors" :key="e.code" class="text-[11px] text-red-500">{{ e.message }}</p>
                    <p v-for="w in s.validation.warnings" :key="w.code" class="text-[11px] text-amber-500">{{ w.message }}</p>
                  </div>
                </div>
                <div class="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button v-if="s.runtime" @click="toggleDeps(s.id)" class="text-xs text-app-muted hover:text-app-accent transition-colors">{{ expandedDeps.has(s.id) ? '收起' : '依赖体检' }}</button>
                  <button v-if="s.kind === 'legacy-md'" @click="handleMigrate(s.id)" class="text-xs text-app-muted hover:text-app-accent transition-colors">迁移</button>
                  <button @click="openEdit(s)" class="text-xs text-app-muted hover:text-app-text transition-colors">编辑</button>
                  <button @click="handleDelete(s.id)" class="text-xs text-app-muted hover:text-red-500 transition-colors">删除</button>
                </div>
              </div>

              <!-- 依赖体检 + env 配置 + trust 操作（内联展开） -->
              <Transition name="tool-expand">
                <div v-if="s.runtime && expandedDeps.has(s.id)" class="mt-3 pt-3 border-t border-app-border/30 space-y-3">
                  <div v-if="depsRunning.has(s.id) && !store.depsCache[s.id]" class="text-xs text-app-muted/50 py-2">体检中...</div>
                  <template v-else-if="store.depsCache[s.id]">
                    <!-- 结论 -->
                    <div class="flex items-center gap-2">
                      <span class="text-xs font-medium" :class="store.depsCache[s.id].ready ? 'text-emerald-500' : 'text-amber-500'">
                        {{ store.depsCache[s.id].ready ? '✓ 依赖就绪' : '缺少依赖' }}
                      </span>
                      <button @click="runDeps(s.id)" class="text-[11px] text-app-muted/60 hover:text-app-text transition-colors">重新检测</button>
                    </div>

                    <!-- bins -->
                    <div v-if="store.depsCache[s.id].bins.length || store.depsCache[s.id].anyBins.length" class="space-y-1">
                      <p class="text-[11px] text-app-muted/60">命令依赖</p>
                      <div v-for="b in store.depsCache[s.id].bins" :key="'b-' + b.name" class="flex items-center gap-2 text-[11px]">
                        <span :class="b.found ? 'text-emerald-500' : 'text-red-500'">{{ b.found ? '✓' : '✗' }}</span>
                        <span class="text-app-text font-mono">{{ b.name }}</span>
                        <span v-if="b.found" class="text-app-muted/40 truncate">{{ b.path }}</span>
                        <span v-else class="text-app-muted/50">未在 PATH 中找到</span>
                      </div>
                      <div v-if="store.depsCache[s.id].anyBins.length" class="flex items-center gap-2 text-[11px]">
                        <span :class="store.depsCache[s.id].anyBins.some(b => b.found) ? 'text-emerald-500' : 'text-red-500'">{{ store.depsCache[s.id].anyBins.some(b => b.found) ? '✓' : '✗' }}</span>
                        <span class="text-app-muted/60">任一可用：</span>
                        <span class="text-app-text font-mono">{{ store.depsCache[s.id].anyBins.map(b => b.name).join(' / ') }}</span>
                      </div>
                    </div>

                    <!-- install 指引 -->
                    <div v-if="!store.depsCache[s.id].ready && store.depsCache[s.id].install?.length" class="rounded-md bg-app-border/10 px-3 py-2 space-y-1">
                      <p class="text-[11px] text-app-muted/60">安装指引（请自行在终端执行）</p>
                      <div v-for="(spec, i) in store.depsCache[s.id].install" :key="'i-' + i" class="text-[11px] font-mono text-app-text">
                        <span v-if="spec.kind === 'brew' && spec.formula">brew install {{ spec.formula }}</span>
                        <span v-else-if="spec.kind === 'npm' && spec.package">npm i -g {{ spec.package }}</span>
                        <span v-else-if="spec.package">{{ spec.kind }}: {{ spec.package }}</span>
                        <span v-else>{{ spec.kind }}</span>
                        <span v-if="spec.bins?.length" class="text-app-muted/40"> → {{ spec.bins.join(', ') }}</span>
                      </div>
                    </div>

                    <!-- env 配置 -->
                    <div v-if="store.depsCache[s.id].env.length" class="space-y-2">
                      <p class="text-[11px] text-app-muted/60">环境变量（保存在本机，仅执行时注入，不会发送给模型）</p>
                      <div v-for="e in store.depsCache[s.id].env" :key="'e-' + e.name" class="space-y-1">
                        <div class="flex items-center gap-2 text-[11px]">
                          <span :class="e.configured ? 'text-emerald-500' : (e.required ? 'text-red-500' : 'text-app-muted/40')">{{ e.configured ? '✓' : (e.required ? '✗' : '○') }}</span>
                          <span class="text-app-text font-mono">{{ e.name }}</span>
                          <span v-if="e.required" class="text-[10px] text-red-500/70">必填</span>
                          <span v-else class="text-[10px] text-app-muted/40">选填</span>
                          <span v-if="e.configured && e.source" class="text-[10px] text-app-muted/40">来源：{{ e.source === 'user-skill' ? '本 Skill' : e.source === 'user-global' ? '全局' : '系统环境' }}</span>
                        </div>
                        <div class="flex gap-2">
                          <input
                            v-model="envDrafts[envKey(s.id, e.name)]"
                            type="password"
                            :placeholder="e.configured ? '已配置（重新输入可覆盖）' : '输入值...'"
                            class="flex-1 px-2.5 py-1.5 text-[11px] border border-app-border/40 rounded-md bg-transparent text-app-text font-mono placeholder:text-app-muted/40 focus:outline-none focus:border-app-text/50 transition-colors"
                          />
                          <button @click="saveEnv(s.id, e.name)" class="text-[11px] px-2.5 py-1 rounded-md border border-app-border/40 text-app-muted hover:text-app-text transition-colors shrink-0">保存</button>
                        </div>
                      </div>
                    </div>

                    <!-- trust 操作 -->
                    <div class="flex items-center gap-3 pt-1">
                      <span class="text-[11px] text-app-muted/60">命令执行授权：</span>
                      <span class="text-[11px]" :class="{ 'text-emerald-500': trustState(s.id) === 'trusted', 'text-red-500': trustState(s.id) === 'denied', 'text-app-muted': trustState(s.id) === 'pending' }">
                        {{ trustState(s.id) === 'trusted' ? '已信任（首次执行时已授权）' : trustState(s.id) === 'denied' ? '已拒绝执行' : '未授权（首次执行时会询问）' }}
                      </span>
                      <button v-if="trustState(s.id) !== 'pending'" @click="handleRevokeTrust(s.id)" class="text-[11px] text-app-muted/60 hover:text-app-accent transition-colors">撤销</button>
                      <button v-if="trustState(s.id) !== 'denied'" @click="handleDenyTrust(s.id)" class="text-[11px] text-app-muted/60 hover:text-red-500 transition-colors ml-auto">禁止执行</button>
                    </div>
                  </template>
                </div>
              </Transition>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
