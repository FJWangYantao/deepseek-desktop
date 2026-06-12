/**
 * skill_check_deps：依赖体检工具。
 *
 * P2 决策 3：默认只检测，不安装。检测 Skill frontmatter 中声明的
 * env / bins / anyBins 是否齐全；若 install 字段存在，告诉用户安装命令。
 *
 * 判定逻辑统一走 runtime/deps-check.ts，这里只负责把结构化结果渲染成 markdown。
 */

import type { ToolDefinition } from '../../../src/types/tools'
import type { ToolExecutor } from '../registry'
import { checkSkillDeps } from '../../skills/runtime/deps-check'

const definition: ToolDefinition = {
  name: 'skill_check_deps',
  description: '检查已加载 Skill 的运行时依赖：声明的环境变量是否已配置、bin 是否在系统 PATH 中。返回结构化清单。当 Skill 声明了 requires.env 或 requires.bins 且模型即将调用 skill_script_run 时使用。',
  category: 'file',
  permissions: 'auto',
  parameters: {
    type: 'object',
    properties: {
      skill_id: {
        type: 'string',
        description: '已加载 Skill 的 ID',
      },
    },
    required: ['skill_id'],
  },
}

function formatInstallSpec(spec: { kind?: string; package?: string; formula?: string; bins?: string[] }): string {
  const parts = [spec.kind ?? '?']
  if (spec.formula) parts.push(`formula=${spec.formula}`)
  if (spec.package) parts.push(`package=${spec.package}`)
  if (spec.bins?.length) parts.push(`bins=[${spec.bins.join(', ')}]`)
  return parts.join(' ')
}

export const skillCheckDepsTool: ToolExecutor = {
  definition,
  async execute(args) {
    const skillId = String(args.skill_id || '').trim()
    if (!skillId) throw new Error('缺少 skill_id')

    const report = checkSkillDeps(skillId)
    if (report.missing.length === 1 && report.missing[0] === 'Skill 不存在') {
      throw new Error(`Skill 不存在: ${skillId}`)
    }

    if (!report.hasRuntime) {
      return `# Skill 依赖体检：${skillId}\n\n该 Skill 未声明任何运行时依赖（frontmatter 无 metadata.openclaw / clawdbot / clawdis 段）。可以直接使用其 SKILL.md 提供的文本指引。`
    }

    const lines: string[] = [`# Skill 依赖体检：${skillId} (v${report.version ?? '?'})`]

    if (report.bins.length || report.anyBins.length) {
      lines.push('', '## 二进制工具')
      for (const r of report.bins) {
        lines.push(`- ${r.found ? '✓' : '✗'} \`${r.name}\`${r.path ? ` → ${r.path}` : ' （未安装）'}`)
      }
      if (report.anyBins.length) {
        lines.push('', '_至少需要一个：_')
        for (const r of report.anyBins) {
          lines.push(`- ${r.found ? '✓' : '○'} \`${r.name}\`${r.path ? ` → ${r.path}` : ''}`)
        }
      }
    }

    if (report.env.length) {
      lines.push('', '## 环境变量')
      for (const e of report.env) {
        const mark = e.configured ? '✓' : (e.required ? '✗' : '○')
        const tag = e.required ? 'required' : 'optional'
        const src = e.configured ? ` — 来源 ${e.source}` : (e.required ? ' — 未配置' : '')
        lines.push(`- ${mark} \`${e.name}\` (${tag})${src}`)
      }
    }

    if (report.install?.length) {
      lines.push('', '## 安装指引')
      lines.push('当前版本不会自动安装依赖。若上述 bin 缺失，请用户在终端执行：')
      lines.push('')
      for (const spec of report.install) {
        lines.push(`- ${formatInstallSpec(spec)}`)
      }
      lines.push('')
      lines.push('安装完成后可重新调用 `skill_check_deps` 确认。')
    }

    lines.push('', '---', '', `**结论**：${report.ready ? '✓ 依赖齐全，可调用 `skill_script_run`' : '✗ 依赖不齐全，调用 `skill_script_run` 将失败'}`)
    if (!report.ready) {
      lines.push('', `缺失项：${report.missing.join('；')}`)
    }

    return lines.join('\n')
  },
}
