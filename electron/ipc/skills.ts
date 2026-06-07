import { ipcMain, app } from 'electron'
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync, mkdirSync } from 'fs'
import { join, basename } from 'path'

export interface SkillMeta {
  id: string
  name: string
  description: string
  version: string
  tags: string[]
  content: string
}

const skillsDir = join(app.getPath('userData'), 'skills')

function ensureDir() {
  if (!existsSync(skillsDir)) mkdirSync(skillsDir, { recursive: true })
}

function parseFrontmatter(text: string): { meta: Omit<SkillMeta, 'id' | 'content'>; body: string } | null {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!match) return null
  const raw = match[1]
  const body = match[2].trim()
  const meta: Record<string, any> = {}
  for (const line of raw.split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/)
    if (kv) {
      const key = kv[1]
      let val: any = kv[2].trim()
      if (key === 'tags') {
        val = val.replace(/[\[\]]/g, '').split(',').map((s: string) => s.trim()).filter(Boolean)
      }
      meta[key] = val
    }
  }
  if (!meta.name) return null
  return { meta: meta as any, body }
}

function readSkillFile(id: string): SkillMeta | null {
  const path = join(skillsDir, `${id}.md`)
  if (!existsSync(path)) return null
  const text = readFileSync(path, 'utf-8')
  const parsed = parseFrontmatter(text)
  if (!parsed) return null
  return { id, ...parsed.meta, content: parsed.body }
}

const DEFAULT_SKILLS: { id: string; content: string }[] = [
  {
    id: 'code-reviewer',
    content: `---
name: 代码审查
description: 代码质量、安全、可维护性审查
version: 2.0.0
tags: [code, review]
steps:
- stage: analyze
  prompt: |
    请分析以下代码的质量、安全性和可维护性，列出所有发现的问题并按严重程度分类。

    {{context.userInput}}
- stage: check
  condition: {{analyze.output}} 包含 "严重"
  then:
    - stage: deep_dive
      prompt: |
        上一步发现严重问题。请重点审查以下代码中的安全漏洞和严重 bug：

        {{context.userInput}}

        分析参考：{{analyze.output}}
  else:
    - stage: normal
      prompt: |
        上一步未发现严重问题。请进行常规代码审查，关注代码风格和最佳实践：

        {{context.userInput}}

        分析参考：{{analyze.output}}
- stage: ask
  input: 是否需要生成修复代码？
  default: 是
- stage: fix
  condition: {{ask}} 等于 是
  then:
    - stage: generate_fix
      prompt: |
        基于以下审查结果，生成具体的修复代码：

        审查结果：{{analyze.output}}

        请对每个问题给出修复后的代码片段。
---
`,
  },
  {
    id: 'translator',
    content: `---
name: 翻译专家
description: 多语言翻译，保持语气和格式
version: 1.0.0
tags: [translate, language]
---

# 翻译专家

## 角色
你是一位专业翻译，精通中英双向翻译。

## 流程
1. 识别原文语言和风格
2. 翻译为目标语言，保持原文语气
3. 技术术语使用行业标准译法
4. 必要时添加翻译说明

## 输出格式
**原文**：...
**翻译**：...
**说明**：（可选）关键术语解释
`,
  },
  {
    id: 'writer',
    content: `---
name: 写作润色
description: 文字润色、改写、校对
version: 1.0.0
tags: [writing, edit]
---

# 写作助手

## 角色
你是一位专业文字编辑，帮助用户提升写作质量。

## 流程
1. 理解用户的写作目的和受众
2. 检查语法、拼写、标点
3. 优化句子结构和段落逻辑
4. 保持作者原意，不做过度修改

## 输出格式
**原文**：...
**优化版**：...
**改动说明**：逐条列出修改原因
`,
  },
  {
    id: 'analyst',
    content: `---
name: 数据分析
description: CSV/JSON 数据分析 + 洞察
version: 2.0.0
tags: [data, analysis]
steps:
- stage: analyze
  prompt: |
    解读以下数据，计算统计摘要（均值、中位数、分布），发现趋势和异常值：

    {{context.userInput}}
- stage: check
  condition: {{analyze.output}} 包含 "异常"
  then:
    - stage: deep_analysis
      prompt: |
        上一步发现异常数据。请深入分析这些异常的原因和影响：

        数据：{{context.userInput}}

        初步分析：{{analyze.output}}
- stage: ask
  input: 是否需要生成可视化建议？
  default: 是
- stage: visualize
  condition: {{ask}} 等于 是
  then:
    - stage: chart
      prompt: |
        基于以下数据分析结果，推荐合适的可视化图表类型：

        数据：{{context.userInput}}

        分析：{{analyze.output}}{{deep_analysis.output}}
  else:
    - stage: summary
      prompt: |
        基于以下分析生成简洁的分析报告：

        分析结果：{{analyze.output}}
---
`,
  },
  {
    id: 'trend-analysis',
    content: `---
name: 热点搜索分析
description: 搜索趋势分析、热度解读、内容策略建议
version: 1.0.0
tags: [search, trend, analysis]
steps:
- stage: parse
  prompt: |
    以下是搜索半导体领域新闻的结果。请分析：

    用户查询：{{context.userInput}}

    搜索结果：
    {{context.searchResults}}

    请分析：
    1. 主要话题和关键词是什么？
    2. 热度趋势和相关新闻方向
    3. 话题所属领域（科技/娱乐/社会/商业/体育等）
    4. 各来源的主要观点差异
- stage: check_domain
  condition: {{parse.output}} 包含 "科技"
  then:
    - stage: tech_deep
      prompt: |
        这是一个科技领域热点。请进一步分析：

        热度数据：{{parse.output}}

        具体分析：
        1. 这是新产品/政策/漏洞还是行业动态？
        2. 对用户/开发者有什么实际影响？
        3. 相关技术栈和竞品分析
  else:
    - stage: general_deep
      prompt: |
        请对这个热点进行通用分析：

        热度数据：{{parse.output}}

        具体分析：
        1. 话题火爆的根本原因是什么？
        2. 各方反应和舆论倾向
        3. 后续发展预测
- stage: ask
  input: 是否需要生成内容策略建议（如写文章、做视频选题）？
  default: 是
- stage: strategy
  condition: {{ask}} 等于 是
  then:
    - stage: content_plan
      prompt: |
        基于以下分析，生成内容策略建议：

        热度分析：{{parse.output}}
        深度解读：{{tech_deep.output}}{{general_deep.output}}

        请输出：
        1. 推荐切入角度（3个）
        2. 目标受众
        3. 内容形式建议
        4. SEO关键词建议
  else:
    - stage: summary
      prompt: |
        基于以下分析生成简洁的热点摘要：

        {{parse.output}}
---
`,
  },
  {
    id: 'meeting-notes',
    content: `---
name: 会议纪要
description: 对话转结构化会议纪要
version: 1.0.0
tags: [meeting, notes]
---

# 会议纪要生成器

## 角色
你是一位专业会议记录员，将对话内容整理为结构化纪要。

## 流程
1. 提取会议主题和参与者
2. 归纳讨论的关键议题
3. 记录达成的决策和待办事项
4. 按时间线或主题组织内容

## 输出格式
# 会议纪要：{主题}
**日期**：{日期}
**参与者**：{列出}

## 议题
1. ...
2. ...

## 决议
- ...

## 待办
- [ ] ... @负责人
`,
  },
]

function ensureDefaults() {
  ensureDir()
  for (const skill of DEFAULT_SKILLS) {
    const path = join(skillsDir, `${skill.id}.md`)
    if (!existsSync(path)) {
      writeFileSync(path, skill.content, 'utf-8')
    }
  }
}

export function registerSkillHandlers() {
  ensureDefaults()

  ipcMain.handle('skills:import', async (_event, url: string): Promise<SkillMeta | null> => {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const text = await res.text()
      const parsed = parseFrontmatter(text)
      if (!parsed) return null
      const id = parsed.meta.name
        ? parsed.meta.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
        : Date.now().toString(36)
      const skill: SkillMeta = {
        id,
        name: parsed.meta.name || id,
        description: parsed.meta.description || '',
        version: parsed.meta.version || '1.0.0',
        tags: parsed.meta.tags || [],
        content: parsed.body,
      }
      // Check if already exists
      const existing = readSkillFile(id)
      if (existing) {
        return null // Don't overwrite
      }
      const frontmatter = `---
name: ${skill.name}
description: ${skill.description}
version: ${skill.version}
tags: [${skill.tags.join(', ')}]
---

${skill.content}`
      ensureDir()
      writeFileSync(join(skillsDir, `${id}.md`), frontmatter, 'utf-8')
      return skill
    } catch {
      return null
    }
  })

  ipcMain.handle('skills:list', (): SkillMeta[] => {
    const files = readdirSync(skillsDir).filter(f => f.endsWith('.md'))
    return files
      .map(f => readSkillFile(basename(f, '.md')))
      .filter(Boolean) as SkillMeta[]
  })

  ipcMain.handle('skills:get', (_event, id: string): SkillMeta | null => {
    return readSkillFile(id)
  })

  ipcMain.handle('skills:save', (_event, skill: SkillMeta): boolean => {
    ensureDir()
    const frontmatter = `---
name: ${skill.name}
description: ${skill.description}
version: ${skill.version}
tags: [${skill.tags.join(', ')}]
---

${skill.content}`
    writeFileSync(join(skillsDir, `${skill.id}.md`), frontmatter, 'utf-8')
    return true
  })

  ipcMain.handle('mcp:tool-call', async (_event, request: { serverId: string; toolName: string; params: Record<string, string> }) => {
    // TODO: 桥接到实际的 MCP 工具服务
    console.warn('[MCP] tool-call 未实现:', request.serverId, request.toolName)
    return { success: false, error: `MCP 工具 "${request.serverId}/${request.toolName}" 尚未实现` }
  })

  ipcMain.handle('skills:delete', (_event, id: string): boolean => {
    const path = join(skillsDir, `${id}.md`)
    if (existsSync(path)) {
      unlinkSync(path)
      return true
    }
    return false
  })
}
