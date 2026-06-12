/**
 * Skill 依赖体检 — 共享逻辑。
 *
 * 同时被 skill_check_deps 工具（给模型看的 markdown）和
 * skills:check-deps IPC（给 UI 用的结构化数据）复用，确保两边判定一致。
 */

import { app } from 'electron'
import type { SkillRuntimeMetadata } from '../../../src/types/skills'
import { getSkillPackage } from '../service'
import { checkBin } from './bin-resolver'
import { loadEnvConfig, resolveEnv } from './env-resolver'

export interface DepBinStatus {
  name: string
  found: boolean
  path?: string
}

export interface DepEnvStatus {
  name: string
  required: boolean
  configured: boolean
  source?: 'user-skill' | 'user-global' | 'system'
}

export interface SkillDepsReport {
  skillId: string
  version?: string
  /** Skill 是否声明了任何运行时依赖 */
  hasRuntime: boolean
  bins: DepBinStatus[]
  anyBins: DepBinStatus[]
  env: DepEnvStatus[]
  install: SkillRuntimeMetadata['install']
  /** 必填依赖是否全部满足 */
  ready: boolean
  /** 人类可读的缺失项 */
  missing: string[]
}

export function checkSkillDeps(skillId: string): SkillDepsReport {
  const pkg = getSkillPackage(skillId)
  if (!pkg) {
    return { skillId, hasRuntime: false, bins: [], anyBins: [], env: [], install: undefined, ready: false, missing: ['Skill 不存在'] }
  }

  const runtime = pkg.runtime
  if (!runtime) {
    return { skillId, version: pkg.version, hasRuntime: false, bins: [], anyBins: [], env: [], install: undefined, ready: true, missing: [] }
  }

  const requiredBins = runtime.requires?.bins ?? []
  const anyBinsList = runtime.requires?.anyBins ?? []
  const requiredEnv = runtime.requires?.env ?? []
  const optionalEnv = (runtime.envVars ?? []).filter(v => !v.required).map(v => v.name)

  const bins: DepBinStatus[] = requiredBins.map(b => ({ name: b, ...checkBin(b) }))
  const anyBins: DepBinStatus[] = anyBinsList.map(b => ({ name: b, ...checkBin(b) }))

  const envConfig = loadEnvConfig(app.getPath('userData'))
  const envResult = resolveEnv({ skillId, required: requiredEnv, optional: optionalEnv, config: envConfig })

  const env: DepEnvStatus[] = [
    ...requiredEnv.map(name => ({
      name,
      required: true,
      configured: !envResult.missingRequired.includes(name),
      source: envResult.sources[name],
    })),
    ...optionalEnv.map(name => ({
      name,
      required: false,
      configured: Object.prototype.hasOwnProperty.call(envResult.values, name),
      source: envResult.sources[name],
    })),
  ]

  const allRequiredBinsOk = bins.every(r => r.found)
  const anyBinOk = anyBins.length === 0 || anyBins.some(r => r.found)
  const envOk = envResult.missingRequired.length === 0
  const ready = allRequiredBinsOk && anyBinOk && envOk

  const missing: string[] = []
  if (!allRequiredBinsOk) missing.push(`缺失 bin: ${bins.filter(r => !r.found).map(r => r.name).join(', ')}`)
  if (!anyBinOk) missing.push(`anyBins 全部缺失: ${anyBins.map(r => r.name).join(', ')}`)
  if (!envOk) missing.push(`缺失 env: ${envResult.missingRequired.join(', ')}`)

  return {
    skillId,
    version: pkg.version,
    hasRuntime: true,
    bins,
    anyBins,
    env,
    install: runtime.install,
    ready,
    missing,
  }
}
