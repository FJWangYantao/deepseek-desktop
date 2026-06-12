import type { ToolDefinition } from '../../../src/types/tools'
import type { ToolExecutor } from '../registry'
import { readSkillResource } from '../../skills/service'

const definition: ToolDefinition = {
  name: 'skill_read_resource',
  description: '读取已加载 Skill 包中的 references 或 assets 文本资源。仅当 SKILL.md 明确指向某个资源且任务需要时调用。不能读取 scripts，不能读取 Skill 包外文件。',
  category: 'file',
  permissions: 'auto',
  parameters: {
    type: 'object',
    properties: {
      skill_id: {
        type: 'string',
        description: '当前已加载 Skill 的 ID',
      },
      path: {
        type: 'string',
        description: 'Skill 包内资源相对路径，例如 references/security-checklist.md',
      },
    },
    required: ['skill_id', 'path'],
  },
}

export const skillReadResourceTool: ToolExecutor = {
  definition,
  async execute(args) {
    const skillId = String(args.skill_id || '').trim()
    const path = String(args.path || '').trim()
    if (!skillId) throw new Error('缺少 skill_id')
    if (!path) throw new Error('缺少 path')

    const result = readSkillResource(skillId, path)
    if (result.error) throw new Error(result.error)
    return `# Skill Resource: ${skillId}/${path}\n\n${result.content || ''}`
  },
}
