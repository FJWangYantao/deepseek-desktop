import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { ModelOption } from '@/types'
import { useStatsStore } from './stats'
import { promptTemplates, DEFAULT_ROLE_ID } from '@/data/prompts'

export const useSettingsStore = defineStore('settings', () => {
  // 敏感字段（API Key）改用 safeStorage 加密存储；初始为空字符串，由 loadSecrets 异步填充
  // 关键：用 secretsReady 标志避免初始化阶段的 watch 触发"空值覆写"
  const apiKey = ref('')
  const defaultModel = ref(localStorage.getItem('ds_default_model') ?? 'deepseek-v4-pro')
  const fontSize = ref(Number(localStorage.getItem('ds_font_size') ?? '14'))
  const fontFamily = ref(localStorage.getItem('ds_font_family') ?? '')
  const codeTheme = ref(localStorage.getItem('ds_code_theme') ?? 'dark')
  const systemPrompt = ref(localStorage.getItem('ds_system_prompt') ?? '')
  const showKey = ref(false)

  // 视觉模型配置（伪多模态）—— mimoApiKey 同样走 safeStorage
  const mimoApiKey = ref('')
  const mimoBaseUrl = ref(localStorage.getItem('ds_mimo_base_url') ?? 'https://api.xiaomimimo.com/v1')
  const mimoModel = ref(localStorage.getItem('ds_mimo_model') ?? 'mimo-v2.5')

  // 加密存储状态：true=已用 safeStorage 加密；false=平台不支持，回退到 localStorage 明文
  const secureStorageAvailable = ref(false)
  // 初始化完成前不持久化敏感字段，防止 watch 在 loadSecrets 中途用空值覆盖磁盘
  let secretsReady = false

  async function loadSecrets() {
    const api = window.electronAPI
    if (api?.secureGet && api?.secureAvailable) {
      try {
        secureStorageAvailable.value = await api.secureAvailable()
      } catch { secureStorageAvailable.value = false }

      if (secureStorageAvailable.value) {
        try {
          apiKey.value = await api.secureGet('ds_api_key')
          mimoApiKey.value = await api.secureGet('ds_mimo_api_key')
        } catch { /* 解密失败时保持空值 */ }

        // 一次性迁移：检测 localStorage 中残留的明文 → 写入加密存储 → 清除明文
        const legacy = localStorage.getItem('ds_api_key')
        if (legacy && !apiKey.value) {
          apiKey.value = legacy
          await api.secureSet('ds_api_key', legacy)
        }
        if (legacy) localStorage.removeItem('ds_api_key')

        const legacyMimo = localStorage.getItem('ds_mimo_api_key')
        if (legacyMimo && !mimoApiKey.value) {
          mimoApiKey.value = legacyMimo
          await api.secureSet('ds_mimo_api_key', legacyMimo)
        }
        if (legacyMimo) localStorage.removeItem('ds_mimo_api_key')
      } else {
        // safeStorage 不可用时降级到 localStorage（开发环境/部分 Linux 无密钥环）
        apiKey.value = localStorage.getItem('ds_api_key') ?? ''
        mimoApiKey.value = localStorage.getItem('ds_mimo_api_key') ?? ''
      }
    } else {
      // 纯浏览器环境（vite dev 直接打开）
      apiKey.value = localStorage.getItem('ds_api_key') ?? ''
      mimoApiKey.value = localStorage.getItem('ds_mimo_api_key') ?? ''
    }
    secretsReady = true
  }

  // 启动即异步加载，UI 在 await 到来前显示空值
  loadSecrets()

  const models: ModelOption[] = [
    { id: 'deepseek-v4-pro', name: 'V4 Pro', description: '旗舰模型，最强性能', contextLength: 1000000 },
    { id: 'deepseek-v4-flash', name: 'V4 Flash', description: '快速模型，高性价比', contextLength: 1000000 },
  ]

  const codeThemes = [
    { value: 'dark', label: '暗色' },
    { value: 'light', label: '亮色' },
    { value: 'minimal', label: '极简' },
  ]

  const fontOptions = [
    { value: '', label: '系统默认' },
    { value: "'Microsoft YaHei', 'PingFang SC', sans-serif", label: '微软雅黑' },
    { value: "'Source Han Sans SC', 'Noto Sans SC', sans-serif", label: '思源黑体' },
    { value: "'LXGW WenKai', 'KaiTi', serif", label: '霞鹜文楷' },
    { value: "'SimSun', 'Noto Serif SC', serif", label: '宋体' },
    { value: "'KaiTi', 'STKaiti', serif", label: '楷体' },
    { value: "'JetBrains Mono', 'Fira Code', monospace", label: 'JetBrains Mono' },
    { value: "'DengXian', sans-serif", label: '等线' },
  ]

  const activeRoleId = ref(localStorage.getItem('ds_active_role') ?? DEFAULT_ROLE_ID)

  function selectRole(id: string) {
    activeRoleId.value = id
    const template = promptTemplates.find(r => r.id === id)
    systemPrompt.value = template?.prompt ?? ''
    try { localStorage.setItem('ds_active_role', id) } catch { /* ignore */ }
  }

  // 敏感字段持久化：优先 safeStorage，不可用时回退 localStorage
  async function persistSecret(key: string, val: string) {
    if (!secretsReady) return  // 阻止初始化期 watch 误触发
    const api = window.electronAPI
    if (api?.secureSet && secureStorageAvailable.value) {
      try { await api.secureSet(key, val) } catch { /* ignore */ }
    } else {
      try {
        if (val) localStorage.setItem(key, val)
        else localStorage.removeItem(key)
      } catch { /* ignore */ }
    }
  }

  // 持久化写入
  watch(apiKey, (val) => { persistSecret('ds_api_key', val) })
  watch(mimoApiKey, (val) => { persistSecret('ds_mimo_api_key', val) })

  watch(defaultModel, (val) => {
    try { localStorage.setItem('ds_default_model', val) } catch { /* ignore */ }
  })
  watch(fontSize, (val) => {
    try { localStorage.setItem('ds_font_size', String(val)) } catch { /* ignore */ }
  })
  watch(fontFamily, (val) => {
    try { localStorage.setItem('ds_font_family', val) } catch { /* ignore */ }
  })
  watch(codeTheme, (val) => {
    try { localStorage.setItem('ds_code_theme', val) } catch { /* ignore */ }
  })
  watch(systemPrompt, (val) => {
    try { localStorage.setItem('ds_system_prompt', val) } catch { /* ignore */ }
  })
  watch(mimoBaseUrl, (val) => {
    try { localStorage.setItem('ds_mimo_base_url', val) } catch { /* ignore */ }
  })
  watch(mimoModel, (val) => {
    try { localStorage.setItem('ds_mimo_model', val) } catch { /* ignore */ }
  })

  async function clearAllData() {
    useStatsStore().clearAllStats()
    localStorage.clear()
    // 同步清空加密存储
    const api = window.electronAPI
    if (api?.secureDelete) {
      try {
        await api.secureDelete('ds_api_key')
        await api.secureDelete('ds_mimo_api_key')
      } catch { /* ignore */ }
    }
    apiKey.value = ''
    defaultModel.value = 'deepseek-v4-pro'
    fontSize.value = 14
    fontFamily.value = ''
    codeTheme.value = 'dark'
    systemPrompt.value = ''
    activeRoleId.value = DEFAULT_ROLE_ID
    mimoApiKey.value = ''
    mimoBaseUrl.value = 'https://api.xiaomimimo.com/v1'
    mimoModel.value = 'mimo-v2.5'
  }

  return {
    apiKey, defaultModel, fontSize, fontFamily, codeTheme, systemPrompt, showKey, mimoApiKey, mimoBaseUrl, mimoModel, models, codeThemes, fontOptions, promptTemplates, activeRoleId, selectRole, secureStorageAvailable,
    clearAllData,
  }
})
