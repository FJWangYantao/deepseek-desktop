import type { ToolDefinition } from '../../../src/types/tools'
import type { ToolExecutor } from '../registry'
import { getSkillPackage } from '../../skills/service'

const definition: ToolDefinition = {
  name: 'skill_load',
  description: '按需加载一个 Skill 的 SKILL.md。当用户任务匹配 Skill Index 中某个 description 时调用。每轮最多应加载一个 Skill。',
  category: 'file',
  permissions: 'auto',
  parameters: {
    type: 'object',
    properties: {
      skill_id: {
        type: 'string',
        description: 'Skill Index 中的 Skill ID，例如 code-reviewer',
      },
    },
    required: ['skill_id'],
  },
}

function formatResources(pkg: NonNullable<ReturnType<typeof getSkillPackage>>): string {
  if (pkg.resources.length === 0) return '无可用资源。'
  return pkg.resources.map(r => {
    const status = r.kind === 'script'
      ? '通过 skill_script_run 执行（需 frontmatter 声明）'
      : r.readable ? 'readable' : 'not readable'
    return `- ${r.path} (${r.kind}, ${r.size} bytes, ${status})`
  }).join('\n')
}

export const skillLoadTool: ToolExecutor = {
  definition,
  async execute(args) {
    const skillId = String(args.skill_id || '').trim()
    if (!skillId) throw new Error('缺少 skill_id')

    const pkg = getSkillPackage(skillId)
    if (!pkg) throw new Error(`Skill 不存在: ${skillId}`)

    const runtimeNote = pkg.runtime
      ? '\n\n## 运行时依赖\n\n该 Skill 声明了运行时依赖。若任务需要执行其命令，先调用 skill_check_deps 确认依赖齐全，再用 skill_script_run 执行（仅限 frontmatter 声明过的命令，首次需用户授权）。'
      : ''

    return `# Loaded Skill: ${pkg.displayName || pkg.name} (${pkg.id})\n\n${pkg.body}\n\n---\n\n## 可按需读取的资源\n\n${formatResources(pkg)}${runtimeNote}`
  },
}
