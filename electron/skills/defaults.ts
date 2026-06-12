export interface DefaultSkillPackage {
  id: string
  readme: string
  resources?: Record<string, string>
}

export const DEFAULT_SKILL_PACKAGES: DefaultSkillPackage[] = [
  {
    id: 'translator',
    readme: `---
name: translator
description: 当用户要求中英互译、多语言翻译、润色译文、保持语气、术语一致或解释翻译差异时使用。
version: 1.0.0
tags: [translate, language]
displayName: 翻译专家
---

# Translator

## 什么时候使用

当用户要求翻译、润色译文、保持原文语气、多语言转换或术语一致性时使用。

## 工作流程

1. 识别原文语言、领域和语气。
2. 翻译为目标语言，保持原文意图和格式。
3. 技术术语使用行业标准译法。
4. 必要时补充关键术语说明。

## 输出格式

**原文**：...

**翻译**：...

**说明**：（可选）关键术语或翻译取舍。
`,
  },
  {
    id: 'writer',
    readme: `---
name: writer
description: 当用户要求文字润色、改写、校对、优化表达、调整语气或提升文章结构时使用。
version: 1.0.0
tags: [writing, edit]
displayName: 写作润色
---

# Writer

## 什么时候使用

当用户希望改进文字表达、修正语法、优化结构、改变语气或生成更清晰的版本时使用。

## 工作流程

1. 先判断写作目的和目标读者。
2. 保留作者原意，不做过度改写。
3. 优化语法、标点、句式和段落逻辑。
4. 对关键修改说明原因。

## 输出格式

**优化版**：...

**改动说明**：逐条说明主要修改。
`,
  },
  {
    id: 'code-reviewer',
    readme: `---
name: code-reviewer
description: 当用户要求代码审查、找 bug、安全漏洞、可维护性、重构建议、PR review、测试覆盖建议时使用。输出问题位置、影响、严重程度和修复建议。
version: 1.0.0
tags: [code, review, security]
displayName: 代码审查
---

# Code Reviewer

## 什么时候使用

当用户要求审查代码、定位 bug、安全审计、PR review、测试覆盖建议或重构建议时使用。

## 工作流程

1. 先识别语言、框架、运行环境和用户目标。
2. 优先报告会导致错误行为、测试失败、安全风险的问题。
3. 每个问题包含：位置、问题、影响、严重程度和修复建议。
4. 不确定的问题标注置信度，不伪造结论。

## 按需参考

- 安全审查时读取 references/security-checklist.md。
- 需要统一严重程度时读取 references/severity-rubric.md。
`,
    resources: {
      'references/security-checklist.md': `# Security Checklist

- 检查路径穿越、命令注入、任意文件读写。
- 检查密钥、Token、API Key 是否可能泄露。
- 检查用户输入是否进入 shell、SQL、模板或文件路径。
- 检查权限绕过和审批绕过。
- 检查外部请求、重定向和 SSRF 风险。
`,
      'references/severity-rubric.md': `# Severity Rubric

- Critical：可导致数据泄露、远程代码执行、权限绕过或不可恢复数据破坏。
- High：可稳定触发严重错误、安全边界失效或核心功能不可用。
- Medium：边界条件错误、明显数据不一致或需要较特殊条件触发的问题。
- Low：可维护性、可读性、轻微性能或体验问题。
`,
    },
  },
  {
    id: 'data-analysis',
    readme: `---
name: data-analysis
description: 当用户提供 CSV、JSON、表格、指标数据并要求统计摘要、趋势分析、异常检测、图表建议或业务洞察时使用。
version: 1.0.0
tags: [data, analysis]
displayName: 数据分析
---

# Data Analysis

## 什么时候使用

当用户提供结构化数据并要求分析、总结、找异常、看趋势或提出图表建议时使用。

## 工作流程

1. 明确字段含义、时间范围和分析目标。
2. 先给统计摘要，再指出趋势、异常和可能原因。
3. 不确定的数据口径要说明假设。
4. 需要图表建议时读取 references/chart-selection.md。
`,
    resources: {
      'references/chart-selection.md': `# Chart Selection

- 时间趋势：折线图。
- 分类对比：柱状图。
- 占比结构：饼图或堆叠柱状图。
- 分布情况：直方图或箱线图。
- 相关性：散点图。
`,
    },
  },
  {
    id: 'meeting-notes',
    readme: `---
name: meeting-notes
description: 当用户提供会议记录、讨论内容、语音转写文本并要求整理会议纪要、决议、待办事项和负责人时使用。
version: 1.0.0
tags: [meeting, notes]
displayName: 会议纪要
---

# Meeting Notes

## 什么时候使用

当用户要求把对话、会议记录或转写文本整理为结构化纪要时使用。

## 输出格式

# 会议纪要：{主题}

**日期**：{日期}
**参与者**：{参与者}

## 议题

1. ...

## 决议

- ...

## 待办

- [ ] ... @负责人
`,
  },
]
