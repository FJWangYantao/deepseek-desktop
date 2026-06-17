import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { ModelOption, ToolPermissionMode, WorkMode } from '@/types'
import { useStatsStore } from './stats'
import { promptTemplates, DEFAULT_ROLE_ID, DEFAULT_ASSISTANT_TRANSLATE_PROMPT, DEFAULT_ASSISTANT_EXPLAIN_PROMPT } from '@/data/prompts'

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
  const toolPermissionMode = ref<ToolPermissionMode>(
    (localStorage.getItem('ds_tool_permission_mode') as ToolPermissionMode) || 'confirm'
  )
  const workMode = ref<WorkMode>(
    (localStorage.getItem('ds_work_mode') as WorkMode) || 'chat'
  )

  // 视觉模型配置（伪多模态）—— mimoApiKey 同样走 safeStorage
  const mimoApiKey = ref('')
  // 知乎搜索 token（web_search 知乎分支 + 知乎热榜数据源）；同样走 safeStorage 加密
  const zhihuToken = ref('')
  // Tavily 搜索 API key（web_search 主搜索源）；同样走 safeStorage 加密
  const tavilyApiKey = ref('')
  const mimoBaseUrl = ref(localStorage.getItem('ds_mimo_base_url') ?? 'https://api.xiaomimimo.com/v1')
  const mimoModel = ref(localStorage.getItem('ds_mimo_model') ?? 'mimo-v2.5')

  // Instinct Engine（行为习惯学习）
  // - instinctEnabled：是否在 system prompt 注入已学到的 instinct（默认开）
  // - instinctSemanticEnabled：是否在会话切换时启用 LLM 语义路径（默认开，使用与对话同一份 apiKey）
  const instinctEnabled = ref(localStorage.getItem('ds_instinct_enabled') !== '0')
  const instinctSemanticEnabled = ref(localStorage.getItem('ds_instinct_semantic_enabled') !== '0')

  // 流式输出末段淡入效果（默认开；关闭后流式文字硬切，不淡入）
  const streamReveal = ref(localStorage.getItem('ds_stream_reveal') !== '0')

  // 划词助手提示词（可在设置中修改；空值时调用处回退默认）
  const assistantTranslatePrompt = ref(localStorage.getItem('ds_assistant_translate_prompt') ?? DEFAULT_ASSISTANT_TRANSLATE_PROMPT)
  const assistantExplainPrompt = ref(localStorage.getItem('ds_assistant_explain_prompt') ?? DEFAULT_ASSISTANT_EXPLAIN_PROMPT)

  // 加密存储状态：true=已用 safeStorage 加密；false=平台不支持，回退到 localStorage 明文
  const secureStorageAvailable = ref(false)
  // 初始化完成前不持久化敏感字段，防止 watch 在 loadSecrets 中途用空值覆盖磁盘
  // 导出为响应式：UI 可据此判断"敏感字段是否已加载完毕"，避免在异步加载期间误判 apiKey 为空
  const secretsReady = ref(false)

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
          zhihuToken.value = await api.secureGet('ds_zhihu_token')
          tavilyApiKey.value = await api.secureGet('ds_tavily_api_key')
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
        zhihuToken.value = localStorage.getItem('ds_zhihu_token') ?? ''
        tavilyApiKey.value = localStorage.getItem('ds_tavily_api_key') ?? ''
      }
    } else {
      // 纯浏览器环境（vite dev 直接打开）
      apiKey.value = localStorage.getItem('ds_api_key') ?? ''
      mimoApiKey.value = localStorage.getItem('ds_mimo_api_key') ?? ''
      zhihuToken.value = localStorage.getItem('ds_zhihu_token') ?? ''
      tavilyApiKey.value = localStorage.getItem('ds_tavily_api_key') ?? ''
    }
    secretsReady.value = true
  }

  async function loadToolPermissionMode() {
    const api = window.electronAPI
    if (api?.toolsGetPermissionConfig) {
      try {
        const config = await api.toolsGetPermissionConfig()
        toolPermissionMode.value = config.mode ?? 'confirm'
        localStorage.setItem('ds_tool_permission_mode', toolPermissionMode.value)
      } catch { /* ignore */ }
    }
  }

  async function setToolPermissionMode(mode: ToolPermissionMode) {
    toolPermissionMode.value = mode
    try { localStorage.setItem('ds_tool_permission_mode', mode) } catch { /* ignore */ }

    const api = window.electronAPI
    if (api?.toolsGetPermissionConfig && api?.toolsSetPermissionConfig) {
      try {
        const config = await api.toolsGetPermissionConfig()
        await api.toolsSetPermissionConfig({ ...config, mode })
      } catch { /* ignore */ }
    }
  }

  async function setWorkMode(mode: WorkMode) {
    workMode.value = mode
    try { localStorage.setItem('ds_work_mode', mode) } catch { /* ignore */ }
  }

  // 启动即异步加载，UI 在 await 到来前显示空值
  loadSecrets()
  loadToolPermissionMode()

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
    { value: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', serif", label: '思源宋体' },
    { value: "'Georgia', 'Times New Roman', 'SimSun', serif", label: 'Georgia' },
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
    if (!secretsReady.value) return  // 阻止初始化期 watch 误触发
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
  watch(zhihuToken, (val) => { persistSecret('ds_zhihu_token', val) })
  watch(tavilyApiKey, (val) => { persistSecret('ds_tavily_api_key', val) })

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
  watch(instinctEnabled, (val) => {
    try { localStorage.setItem('ds_instinct_enabled', val ? '1' : '0') } catch { /* ignore */ }
  })
  watch(instinctSemanticEnabled, (val) => {
    try { localStorage.setItem('ds_instinct_semantic_enabled', val ? '1' : '0') } catch { /* ignore */ }
  })
  watch(streamReveal, (val) => {
    try { localStorage.setItem('ds_stream_reveal', val ? '1' : '0') } catch { /* ignore */ }
  })
  watch(assistantTranslatePrompt, (val) => {
    try { localStorage.setItem('ds_assistant_translate_prompt', val) } catch { /* ignore */ }
  })
  watch(assistantExplainPrompt, (val) => {
    try { localStorage.setItem('ds_assistant_explain_prompt', val) } catch { /* ignore */ }
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
        await api.secureDelete('ds_zhihu_token')
        await api.secureDelete('ds_tavily_api_key')
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
    zhihuToken.value = ''
    tavilyApiKey.value = ''
    mimoBaseUrl.value = 'https://api.xiaomimimo.com/v1'
    mimoModel.value = 'mimo-v2.5'
    assistantTranslatePrompt.value = DEFAULT_ASSISTANT_TRANSLATE_PROMPT
    assistantExplainPrompt.value = DEFAULT_ASSISTANT_EXPLAIN_PROMPT
    void setToolPermissionMode('confirm')
    void setWorkMode('chat')
  }

  return {
    apiKey, defaultModel, fontSize, fontFamily, codeTheme, systemPrompt, showKey, mimoApiKey, mimoBaseUrl, mimoModel, zhihuToken, tavilyApiKey, models, codeThemes, fontOptions, promptTemplates, activeRoleId, selectRole, secureStorageAvailable, secretsReady,
    instinctEnabled, instinctSemanticEnabled, streamReveal, toolPermissionMode, setToolPermissionMode,
    workMode, setWorkMode,
    assistantTranslatePrompt, assistantExplainPrompt,
    clearAllData,
  }
})
