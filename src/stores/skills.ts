import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { LegacySkillMeta, SkillIndex, SkillPackage, SkillResourceReadResult } from '@/types'
import type { SkillDepsReport } from '../../electron/skills/runtime/deps-check'
import type { TrustStore, TrustDecision } from '../../electron/skills/runtime/trust-store'
import type { SkillEnvConfig } from '../../electron/skills/runtime/env-resolver'

export const useSkillStore = defineStore('skills', () => {
  const skillIndex = ref<SkillIndex[]>([])
  const packageCache = ref<Record<string, SkillPackage>>({})
  const activationMode = ref<'auto'>('auto')
  const loadedSkillId = ref<string | null>(null)
  const loading = ref(false)

  // ===== P2 运行时状态：trust / env / deps 缓存 =====
  const trustEntries = ref<TrustStore['entries']>({})
  const envConfig = ref<SkillEnvConfig | null>(null)
  const depsCache = ref<Record<string, SkillDepsReport>>({})

  // 兼容旧页面/旧组件的列表视图
  const skills = computed<LegacySkillMeta[]>(() => skillIndex.value.map(s => ({
    id: s.id,
    name: s.displayName || s.name,
    description: s.description,
    version: s.version || '1.0.0',
    tags: s.tags,
    content: packageCache.value[s.id]?.body || '',
  })))

  const loadedSkill = computed(() =>
    loadedSkillId.value ? packageCache.value[loadedSkillId.value] ?? null : null
  )

  const preferredSkill = computed(() => null)

  // 兼容旧 activeSkill 语义：新版不再支持手动选择，始终由模型按需加载
  const activeSkillId = computed({
    get: () => null as string | null,
    set: (_id: string | null) => { /* no-op */ },
  })
  const activeSkill = computed(() => loadedSkill.value)

  async function loadSkillIndex() {
    const api = window.electronAPI
    if (!api?.listSkillIndex) return
    loading.value = true
    try {
      skillIndex.value = await api.listSkillIndex()
    } finally {
      loading.value = false
    }
  }

  async function loadSkills() {
    await loadSkillIndex()
  }

  async function getPackage(id: string): Promise<SkillPackage | null> {
    if (packageCache.value[id]) return packageCache.value[id]
    const api = window.electronAPI
    if (!api?.getSkillPackage) return null
    const pkg = await api.getSkillPackage(id)
    if (pkg) packageCache.value = { ...packageCache.value, [id]: pkg }
    return pkg
  }

  function setActivationMode(_mode: 'auto') {
    activationMode.value = 'auto'
  }

  function setPreferredSkill(_id: string | null) {
    // Claude Code 风格：不接受用户手动预加载，由模型根据 Skill Index 自主判断
  }

  function setLoadedSkill(id: string | null) {
    loadedSkillId.value = id
  }

  async function selectSkill(_id: string | null) {
    // 保留旧 API 兼容；新版 Skill 由模型通过 skill_load 加载
  }

  async function createPackage(id: string, readme: string) {
    const api = window.electronAPI
    if (!api?.createSkillPackage) return null
    const pkg = await api.createSkillPackage({ id, readme })
    if (pkg) {
      packageCache.value = { ...packageCache.value, [pkg.id]: pkg }
      await loadSkillIndex()
    }
    return pkg
  }

  async function savePackage(id: string, readme: string) {
    const api = window.electronAPI
    if (!api?.saveSkillPackage) return false
    const ok = await api.saveSkillPackage({ id, readme })
    if (ok) {
      const next = { ...packageCache.value }
      delete next[id]
      packageCache.value = next
      await loadSkillIndex()
      await getPackage(id)
    }
    return ok
  }

  async function saveSkill(skill: LegacySkillMeta) {
    const api = window.electronAPI
    if (!api?.saveSkill) return
    await api.saveSkill(skill)
    await loadSkillIndex()
  }

  async function deleteSkill(id: string) {
    const api = window.electronAPI
    if (!api?.deleteSkill) return
    await api.deleteSkill(id)
    if (loadedSkillId.value === id) loadedSkillId.value = null
    const next = { ...packageCache.value }
    delete next[id]
    packageCache.value = next
    await loadSkillIndex()
  }

  async function readResource(id: string, path: string): Promise<SkillResourceReadResult | null> {
    const api = window.electronAPI
    if (!api?.readSkillResource) return null
    return api.readSkillResource({ id, path })
  }

  async function migrateLegacy(id: string) {
    const api = window.electronAPI
    if (!api?.migrateLegacySkill) return null
    const pkg = await api.migrateLegacySkill(id)
    if (pkg) {
      packageCache.value = { ...packageCache.value, [pkg.id]: pkg }
      await loadSkillIndex()
    }
    return pkg
  }

  // ===== ClawHub registry =====
  async function searchClawHub(payload: { query?: string; cursor?: string; limit?: number; token?: string; baseUrl?: string } = {}) {
    const api = window.electronAPI
    if (!api?.clawHubSearch) return { error: 'ClawHub API 不可用' }
    return await api.clawHubSearch(payload)
  }

  async function installFromClawHub(payload: { slug: string; version?: string; overwrite?: boolean; token?: string; baseUrl?: string }) {
    const api = window.electronAPI
    if (!api?.clawHubInstall) return { ok: false as const, errorCode: 'no-api', error: 'ClawHub API 不可用' }
    const result = await api.clawHubInstall(payload)
    if (result.ok) {
      // 重新加载本地 index 让新装的 Skill 可见
      await loadSkillIndex()
    }
    return result
  }

  async function uninstallClawHub(slug: string) {
    const api = window.electronAPI
    if (!api?.clawHubUninstall) return false
    const ok = await api.clawHubUninstall(slug)
    if (ok) {
      if (loadedSkillId.value === slug) loadedSkillId.value = null
      const next = { ...packageCache.value }
      delete next[slug]
      packageCache.value = next
      await loadSkillIndex()
    }
    return ok
  }

  async function listClawHubInstalled() {
    const api = window.electronAPI
    if (!api?.clawHubListInstalled) return null
    return await api.clawHubListInstalled()
  }

  // ===== P2 运行时：trust / env / deps =====

  /** 拉取信任清单到本地缓存，供卡片徽章响应式使用。 */
  async function loadTrust() {
    const api = window.electronAPI
    if (!api?.skillTrustList) return
    const store = await api.skillTrustList()
    trustEntries.value = store?.entries ?? {}
  }

  /** 取某个 Skill 的信任决策；undefined 表示未授权(pending)。 */
  function trustOf(skillId: string): TrustDecision | undefined {
    return trustEntries.value[skillId]?.decision
  }

  async function setTrust(skillId: string, decision: TrustDecision) {
    const api = window.electronAPI
    if (!api?.skillTrustSet) return false
    const ok = await api.skillTrustSet({ skillId, decision })
    if (ok) await loadTrust()
    return ok
  }

  async function revokeTrust(skillId: string) {
    const api = window.electronAPI
    if (!api?.skillTrustRevoke) return false
    const ok = await api.skillTrustRevoke(skillId)
    if (ok) await loadTrust()
    return ok
  }

  /** 拉取 env 配置到本地缓存。 */
  async function loadEnvConfig() {
    const api = window.electronAPI
    if (!api?.skillEnvGet) return
    envConfig.value = await api.skillEnvGet()
  }

  /** 读某个 Skill 下某个 env 的已配置值(仅 per-skill 层,用于回显输入框)。 */
  function envValueOf(skillId: string, name: string): string {
    return envConfig.value?.perSkill?.[skillId]?.[name] ?? ''
  }

  async function setSkillEnv(skillId: string, name: string, value: string | null) {
    const api = window.electronAPI
    if (!api?.skillEnvSet) return false
    const ok = await api.skillEnvSet({ skillId, name, value })
    if (ok) {
      await loadEnvConfig()
      // env 变了,体检结果失效
      delete depsCache.value[skillId]
    }
    return ok
  }

  async function setGlobalEnv(name: string, value: string | null) {
    const api = window.electronAPI
    if (!api?.skillEnvSetGlobal) return false
    const ok = await api.skillEnvSetGlobal({ name, value })
    if (ok) await loadEnvConfig()
    return ok
  }

  /** 跑一次依赖体检并缓存。force=true 时无视缓存重跑。 */
  async function checkDeps(skillId: string, force = false): Promise<SkillDepsReport | null> {
    if (!force && depsCache.value[skillId]) return depsCache.value[skillId]
    const api = window.electronAPI
    if (!api?.skillCheckDeps) return null
    const report = await api.skillCheckDeps(skillId)
    if (report) depsCache.value = { ...depsCache.value, [skillId]: report }
    return report
  }

  return {
    skillIndex,
    packageCache,
    activationMode,
    loadedSkillId,
    loadedSkill,
    preferredSkill,
    activeSkillId,
    activeSkill,
    skills,
    loading,
    loadSkillIndex,
    loadSkills,
    getPackage,
    setActivationMode,
    setPreferredSkill,
    setLoadedSkill,
    selectSkill,
    createPackage,
    savePackage,
    saveSkill,
    deleteSkill,
    readResource,
    migrateLegacy,
    searchClawHub,
    installFromClawHub,
    uninstallClawHub,
    listClawHubInstalled,
    // P2 运行时
    trustEntries,
    envConfig,
    depsCache,
    loadTrust,
    trustOf,
    setTrust,
    revokeTrust,
    loadEnvConfig,
    envValueOf,
    setSkillEnv,
    setGlobalEnv,
    checkDeps,
  }
})
