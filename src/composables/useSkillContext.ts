import type { SkillIndex, SkillPackage } from '@/types'

interface SkillContextOptions {
  skillIndex: SkillIndex[]
  setLoadedSkill: (id: string | null) => void
}

interface SkillContextResult {
  systemBlock: string
  activatedSkillIds: string[]
}

function formatSkillIndex(skills: SkillIndex[]): string {
  if (skills.length === 0) return ''
  const lines = skills
    .filter(s => s.enabled)
    .slice(0, 30)
    .map(s => {
      const tags = s.tags.length ? ` tags=${s.tags.join(',')}` : ''
      const label = s.displayName ? `${s.displayName} / ${s.name}` : s.name
      return `- ${s.id}: ${label} — ${s.description}${tags}`
    })
    .join('\n')

  return `[Skill Index]\n以下 Skill 索引始终可用。你需要像 Claude Code 一样，根据用户任务自行判断是否调用 skill_load 加载一个最相关 Skill；每轮最多加载一个 Skill，不要同时加载多个。\n${lines}\n\n可用规则：\n- 如果任务明显匹配某个 Skill 的 description，主动调用 skill_load，不要等待用户手动选择。\n- 如果没有匹配的 Skill，直接回答，不要强行加载。\n- 加载 Skill 后，严格遵循该 Skill 的 SKILL.md。\n- 如 SKILL.md 指向 references 或 assets，且确实需要，调用 skill_read_resource 读取。\n- 如果 Skill 声明了运行时依赖（requires.bins / anyBins），并且任务需要执行这些命令：先调用 skill_check_deps 确认依赖与环境变量齐全，再调用 skill_script_run 在受控环境执行。skill_script_run 只能运行 Skill frontmatter 声明过的命令，首次执行需用户授权；不能用它跑任意 shell。`
}

export async function buildSkillContext(options: SkillContextOptions): Promise<SkillContextResult> {
  const blocks: string[] = []
  const indexBlock = formatSkillIndex(options.skillIndex)
  if (indexBlock) blocks.push(indexBlock)

  options.setLoadedSkill(null)

  return {
    systemBlock: blocks.join('\n\n'),
    activatedSkillIds: [],
  }
}
