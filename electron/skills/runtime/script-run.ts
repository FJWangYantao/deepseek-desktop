/**
 * Skill 二进制执行器。
 *
 * P2 决策 1、2、4 的交叉点：
 *   - 只跑 `requires.bins` / `requires.anyBins` 声明过的命令（白名单）
 *   - env var 占位符 `${VAR}` 在进程启动前展开，展开值不返回给模型
 *   - 执行前检查 trust store（P2 决策 4）
 *   - 工作目录限制为 skill 包目录；30s 超时
 *
 * 注意：
 *   这不是一个通用的 bash 工具。它只执行 skill 声明过的 bin，
 *   而且 bin 的实际路径由 `checkBin` 在 PATH 中定位（hardened 路径，
 *   不接受用户传入的任意路径）。
 */

import { execFile } from 'node:child_process'
import type { SkillRuntimeMetadata } from '../../../src/types/skills'
import { checkBin } from './bin-resolver'
import { resolveEnv } from './env-resolver'

const EXECUTION_TIMEOUT = 30_000

export interface ScriptRunRequest {
  skillId: string
  runtime: SkillRuntimeMetadata
  /** 模型指定的 bin 名（必须在 requires.bins/anyBins 中） */
  command: string
  /** bin 的参数列表。模型可通过 args 和 stdin 传递数据。
   *  args 含 ${ENV_VAR} 占位符，执行前被替换为实际 env 值。
   *  文本体较大的用 stdin（避免命令行长度限制）。 */
  args: string[]
  stdin?: string
  /** 解析 env 时需要的信息 */
  requiredEnv: string[]
  optionalEnv: string[]
}

export interface ScriptRunResult {
  ok: boolean
  stdout: string
  stderr: string
  /** 执行用时（ms） */
  elapsedMs: number
  /** 实际运行的命令路径（resolve 后的） */
  resolvedPath?: string
  errorCode?: string
  error?: string
}

/** "${TODOIST_API_KEY}" → 替换为实际值；未配置的占位符原样保留，交给 bin 自行处理。 */
function resolvePlaceholders(args: string[], env: Record<string, string>): string[] {
  return args.map(arg =>
    arg.replace(/\$\{(\w+)\}/g, (match, name) => {
      const val = env[name]
      return val !== undefined ? val : match
    })
  )
}

/**
 * 主入口：验证、展开 env、执行、返回输出。
 *
 * 不关心 trust（trust 由 caller 判断），但返回的 errorCode 包含
 * untrusted / unknown-command 等。
 */
export async function runScript(req: ScriptRunRequest): Promise<ScriptRunResult> {
  const start = Date.now()
  const elapsed = () => Date.now() - start

  // 1. bin 白名单校验
  const allowed = [...(req.runtime.requires?.bins ?? []), ...(req.runtime.requires?.anyBins ?? [])]
  if (!allowed.includes(req.command)) {
    return { ok: false, stdout: '', stderr: '', elapsedMs: elapsed(),
      errorCode: 'command-not-allowed',
      error: `"${req.command}" 不在 Skill 声明的 requires.bins 中。允许的命令：${allowed.join(', ')}` }
  }

  // 2. 解析 bin 路径
  const resolved = checkBin(req.command)
  if (!resolved.found) {
    return { ok: false, stdout: '', stderr: '', elapsedMs: elapsed(),
      errorCode: 'bin-not-found',
      error: `系统未找到 "${req.command}"。请确认已安装该工具并在 PATH 中。` }
  }

  // 3. 展开 env 占位符
  const resolvedEnv = resolveEnv({
    skillId: req.skillId,
    required: req.requiredEnv,
    optional: req.optionalEnv,
  })
  const expandedArgs = resolvePlaceholders(req.args, resolvedEnv.values)

  // 4. 执行（主流程走 execFile，避免 shell 注入；备选走 execFileSync 兜住少量同步场景）
  //    execFile 不经过 shell，args 直接传数组，天生防注入。
  const env = resolvedEnv.values
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        resolved.path!,
        expandedArgs,
        {
          timeout: EXECUTION_TIMEOUT,
          env: { ...process.env, ...env },
          maxBuffer: 1024 * 1024, // 1MB
        },
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error(`exit code ${err.code ?? '?'}: ${stderr.slice(0, 500)}`))
          } else {
            resolve(stdout)
          }
        },
      )
      if (req.stdin && child.stdin) {
        child.stdin.write(req.stdin)
        child.stdin.end()
      }
    })
    return { ok: true, stdout, stderr: '', elapsedMs: elapsed(), resolvedPath: resolved.path }
  } catch (err) {
    return { ok: false, stdout: '', stderr: err instanceof Error ? err.message : String(err),
      elapsedMs: elapsed(), resolvedPath: resolved.path,
      errorCode: 'exec-failed', error: err instanceof Error ? err.message : String(err) }
  }
}