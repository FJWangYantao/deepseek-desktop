/**
 * skill_script_run：执行 Skill 声明过的二进制工具。
 *
 * P2 决策 1：白名单 — 只允许 frontmatter.requires.bins / anyBins 中声明过的命令。
 * P2 决策 4：首次执行需要用户授权（trust store）。授权一次后 same skill 不再弹窗，
 *           但 skill version 变化或用户主动撤销会重新询问。
 *
 * 权限模式：默认 'confirm'。executor 层把 trust state 转成 needsApproval。
 */

import type { ToolDefinition } from '../../../src/types/tools'
import type { ToolExecutor } from '../registry'
import { getSkillPackage } from '../../skills/service'
import { runScript } from '../../skills/runtime/script-run'
import { checkTrust, loadTrustStore, recordDecision } from '../../skills/runtime/trust-store'
import { app } from 'electron'

const definition: ToolDefinition = {
  name: 'skill_script_run',
  description: '在受控环境中执行已加载 Skill 声明过的二进制工具（requires.bins / anyBins 白名单）。执行前会做依赖体检与用户授权（首次需用户批准，可记住）。仅在调用前已经过 skill_check_deps 确认依赖齐全时使用；不能用来跑任意 shell。',
  category: 'code',
  permissions: 'confirm',
  parameters: {
    type: 'object',
    properties: {
      skill_id: {
        type: 'string',
        description: '已加载 Skill 的 ID',
      },
      command: {
        type: 'string',
        description: '要执行的二进制名（必须在 Skill frontmatter 的 requires.bins 或 anyBins 中）',
      },
      args: {
        type: 'array',
        description: 'CLI 参数。可包含 ${ENV_VAR} 占位符，执行前会被替换为实际环境变量值（值不会回传给模型）。',
        items: { type: 'string', description: '参数项' },
      },
      stdin: {
        type: 'string',
        description: '可选的 stdin 输入。当数据较大时优先用 stdin 而非 args。',
      },
    },
    required: ['skill_id', 'command'],
  },
}

export const skillScriptRunTool: ToolExecutor = {
  definition,
  async execute(args) {
    const skillId = String(args.skill_id || '').trim()
    const command = String(args.command || '').trim()
    if (!skillId) throw new Error('缺少 skill_id')
    if (!command) throw new Error('缺少 command')

    const pkg = getSkillPackage(skillId)
    if (!pkg) throw new Error(`Skill 不存在: ${skillId}`)

    const runtime = pkg.runtime
    if (!runtime) {
      throw new Error(`Skill ${skillId} 未声明任何运行时元数据（requires.bins 等）。该 Skill 仅作为文本指引使用。`)
    }

    // Trust 检查 — confirm 流程已经在 permissions.ts 那层走过一次了，
    // 这里是第二道闸门：用户批准过的也要按 trust store 显式记录。
    // executor 调用本工具说明权限已 ok，此时若 trust 还没记录，就把它落地。
    const userDataDir = app.getPath('userData')
    const trustStore = loadTrustStore(userDataDir)
    const trust = checkTrust(trustStore, skillId, pkg.version)
    if (trust.state === 'denied') {
      throw new Error(`Skill ${skillId} 已被用户标记为拒绝执行外部命令。如需恢复，请在 Skills 页面撤销该决定。`)
    }
    if (trust.state === 'pending') {
      // 第一次成功执行 → 隐式信任（用户已通过 confirm 浮层）
      recordDecision(userDataDir, skillId, 'trusted', pkg.version)
    }

    // 执行
    const requiredEnv = runtime.requires?.env ?? []
    const optionalEnv = (runtime.envVars ?? []).filter(v => !v.required).map(v => v.name)

    const argsArr = Array.isArray(args.args) ? (args.args as unknown[]).map(String) : []
    const stdin = typeof args.stdin === 'string' ? args.stdin : undefined

    const result = await runScript({
      skillId,
      runtime,
      command,
      args: argsArr,
      stdin,
      requiredEnv,
      optionalEnv,
    })

    if (!result.ok) {
      const lines = [`# skill_script_run 失败 (${result.errorCode ?? 'unknown'})`, '']
      lines.push(`错误：${result.error ?? result.stderr}`)
      if (result.resolvedPath) lines.push(`命令路径：${result.resolvedPath}`)
      lines.push(`耗时：${result.elapsedMs}ms`)
      throw new Error(lines.join('\n'))
    }

    // 截断超长输出
    const MAX = 32 * 1024
    let stdout = result.stdout
    let truncated = false
    if (stdout.length > MAX) {
      stdout = stdout.slice(0, MAX)
      truncated = true
    }

    const header = `# ${command} 输出 (${result.elapsedMs}ms${truncated ? ', 截断' : ''})`
    return `${header}\n\n\`\`\`\n${stdout}\n\`\`\``
  },
}