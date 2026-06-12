/**
 * Skill 环境变量解析。
 *
 * P2 决策 2：用户配置优先 → 回退 process.env → 都没有 → 报错。
 *
 * 用户配置存储在 userData/skills-env.json（与 tool-permissions.json 同级）。
 * 注意：这里**不**走加密 secure storage——因为 child_process 启动时拿到的 env
 * 是明文，加密只防硬盘扫描，对实际执行链路意义不大；如果要更强保护，应该走
 * Electron safeStorage 包裹整个文件，但这是 P3+ 的事。
 *
 * 数据结构：
 *   {
 *     "version": 1,
 *     "global": { "PROXY_URL": "..." },          // 跨 skill 全局兜底
 *     "perSkill": {
 *       "todoist-cli": { "TODOIST_API_KEY": "..." }
 *     }
 *   }
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface SkillEnvConfig {
  version: 1
  global: Record<string, string>
  perSkill: Record<string, Record<string, string>>
}

export interface ResolvedEnv {
  /** 已解析的环境变量；可直接传给 child_process.spawn 的 env 选项 */
  values: Record<string, string>
  /** 来源标记，用于调试/UI 显示 */
  sources: Record<string, 'user-skill' | 'user-global' | 'system'>
  /** 必填但找不到的变量名 */
  missingRequired: string[]
  /** 选填但找不到的变量名（不阻止执行） */
  missingOptional: string[]
}

const FILE_NAME = 'skills-env.json'

function fresh(): SkillEnvConfig {
  return { version: 1, global: {}, perSkill: {} }
}

export function envConfigPath(userDataDir: string): string {
  return join(userDataDir, FILE_NAME)
}

export function loadEnvConfig(userDataDir: string): SkillEnvConfig {
  const path = envConfigPath(userDataDir)
  if (!existsSync(path)) return fresh()
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    if (data && typeof data === 'object' && data.version === 1) {
      return {
        version: 1,
        global: data.global && typeof data.global === 'object' ? data.global : {},
        perSkill: data.perSkill && typeof data.perSkill === 'object' ? data.perSkill : {},
      }
    }
  } catch { /* ignore */ }
  return fresh()
}

export function saveEnvConfig(userDataDir: string, config: SkillEnvConfig): void {
  writeFileSync(envConfigPath(userDataDir), JSON.stringify(config, null, 2), 'utf-8')
}

export function setSkillEnv(userDataDir: string, skillId: string, name: string, value: string | null): void {
  const cfg = loadEnvConfig(userDataDir)
  if (!cfg.perSkill[skillId]) cfg.perSkill[skillId] = {}
  if (value === null) delete cfg.perSkill[skillId][name]
  else cfg.perSkill[skillId][name] = value
  saveEnvConfig(userDataDir, cfg)
}

export interface ResolveOptions {
  /** Skill ID */
  skillId: string
  /** 必填的 env 名（来自 frontmatter requires.env） */
  required?: string[]
  /** 选填的 env 名（来自 envVars[].required = false） */
  optional?: string[]
  /** 注入测试用 */
  config?: SkillEnvConfig
  /** 注入测试用 */
  systemEnv?: NodeJS.ProcessEnv
}

/**
 * 解析顺序：per-skill 配置 → 全局配置 → process.env → undefined。
 * 找不到必填项只是标记 missingRequired，不抛异常——是否拒绝执行由 caller 决定。
 */
export function resolveEnv(opts: ResolveOptions): ResolvedEnv {
  const cfg = opts.config ?? { version: 1, global: {}, perSkill: {} }
  const sysEnv = opts.systemEnv ?? process.env
  const perSkill = cfg.perSkill[opts.skillId] ?? {}

  const values: Record<string, string> = {}
  const sources: Record<string, 'user-skill' | 'user-global' | 'system'> = {}
  const missingRequired: string[] = []
  const missingOptional: string[] = []

  const consider = (name: string, isRequired: boolean) => {
    if (Object.prototype.hasOwnProperty.call(perSkill, name) && perSkill[name] !== '') {
      values[name] = perSkill[name]
      sources[name] = 'user-skill'
      return
    }
    if (Object.prototype.hasOwnProperty.call(cfg.global, name) && cfg.global[name] !== '') {
      values[name] = cfg.global[name]
      sources[name] = 'user-global'
      return
    }
    const sysVal = sysEnv[name]
    if (typeof sysVal === 'string' && sysVal !== '') {
      values[name] = sysVal
      sources[name] = 'system'
      return
    }
    if (isRequired) missingRequired.push(name)
    else missingOptional.push(name)
  }

  for (const name of opts.required ?? []) consider(name, true)
  for (const name of opts.optional ?? []) consider(name, false)

  return { values, sources, missingRequired, missingOptional }
}
