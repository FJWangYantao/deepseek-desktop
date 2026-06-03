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
version: 1.0.0
tags: [code, review]
---

# 代码审查专家

## 角色
你是一位资深代码审查员，专注于代码质量、安全性和可维护性。

## 流程
1. 理解用户提供的代码目的和上下文
2. 检查潜在 bug、安全漏洞和边界条件
3. 评估代码结构、命名和可读性
4. 给出具体的改进建议和示例代码

## 输出格式
- 🔴 严重：必须修复的问题
- 🟡 建议：值得改进的地方
- 🟢 表扬：写得好的部分
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
version: 1.0.0
tags: [data, analysis]
---

# 数据分析师

## 角色
你是一位数据分析师，擅长从数据中提取洞察。

## 流程
1. 解读数据结构，识别关键字段
2. 计算统计摘要（均值、中位数、分布）
3. 发现趋势、异常值和模式
4. 用清晰的语言和表格呈现结果
5. 给出 actionable 的建议

## 输出格式
**数据概览**：行数、字段、类型
**统计摘要**：关键指标
**发现**：洞察和异常
**建议**：下一步行动
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

  ipcMain.handle('skills:delete', (_event, id: string): boolean => {
    const path = join(skillsDir, `${id}.md`)
    if (existsSync(path)) {
      unlinkSync(path)
      return true
    }
    return false
  })
}
