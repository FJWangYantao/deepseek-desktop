/**
 * 二进制工具检测。
 *
 * P2 决策 1 配套：Skill 的 `requires.bins` 声明了需要哪些 CLI 工具，
 * 模型在调用 `skill_script_run` 前应先通过此模块确认系统已安装。
 *
 * 检测策略：
 *   - Windows：`where <bin>`（查 PATH 扩展名）
 *   - macOS/Linux：`which <bin>`
 * 缓存检测结果，不重复查。
 */

import { execFileSync } from 'node:child_process'
import { platform } from 'node:os'

function isWindows(): boolean {
  return platform() === 'win32'
}

/** 系统当前是否可访问指定 bin。 */
export function checkBin(bin: string): { found: boolean; path?: string } {
  const cmd = isWindows() ? 'where' : 'which'
  try {
    const out = execFileSync(cmd, [bin], {
      encoding: 'utf-8',
      timeout: 5000,
      // 吞掉 where/which 在未命中时写到 stderr 的本地化报错，保持日志干净
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const lines = out.trim().split(/\r?\n/)
    return { found: true, path: lines[0] || undefined }
  } catch {
    return { found: false }
  }
}

export interface BinCheckResult {
  name: string
  found: boolean
  path?: string
}

/**
 * 同时查多个 bin。只要有一个就认为 ok（对应 `anyBins` 语义）。
 * 返回 first-found + 全量结果列表。
 */
export function checkBins(bins: string[]): { ok: boolean; foundBin?: string; results: BinCheckResult[] } {
  const results = bins.map(b => ({ name: b, found: false, path: undefined as string | undefined }))
  for (let i = 0; i < bins.length; i++) {
    const r = checkBin(bins[i])
    results[i].found = r.found
    results[i].path = r.path
  }
  return {
    ok: results.some(r => r.found),
    foundBin: results.find(r => r.found)?.name,
    results,
  }
}