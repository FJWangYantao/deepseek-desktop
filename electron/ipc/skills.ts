import { ipcMain, app } from 'electron'
import type { LegacySkillMeta, SkillPackage, SkillResourceReadResult, SkillValidationResult } from '../../src/types/skills'
import {
  createSkillPackage,
  deleteSkill,
  ensureDefaultSkills,
  getSkillPackage,
  importSkillFromUrl,
  listLegacySkills,
  listSkillIndex,
  migrateLegacySkill,
  readLegacySkill,
  readSkillResource,
  saveLegacySkill,
  saveSkillPackage,
  skillsDir,
  validateSkill,
} from '../skills/service'
import { ClawHubClient } from '../skills/clawhub/client'
import {
  installFromClawHub,
  listInstalled,
  uninstallClawHubSkill,
} from '../skills/clawhub/installer'
import type {
  ClawHubInstallResult,
  ClawHubListResponse,
  ClawHubLock,
  ClawHubSkillDetail,
  ClawHubVersionDetail,
} from '../skills/clawhub/types'
import {
  loadTrustStore,
  recordDecision,
  revokeTrust,
  type TrustStore,
} from '../skills/runtime/trust-store'
import {
  loadEnvConfig,
  saveEnvConfig,
  setSkillEnv,
  type SkillEnvConfig,
} from '../skills/runtime/env-resolver'
import { checkSkillDeps, type SkillDepsReport } from '../skills/runtime/deps-check'

export type SkillMeta = LegacySkillMeta

export function registerSkillHandlers() {
  ensureDefaultSkills()

  // ===== 兼容旧版单文件 Skill API =====
  ipcMain.handle('skills:import', async (_event, url: string): Promise<SkillMeta | null> => {
    try {
      const pkg = await importSkillFromUrl(url)
      return pkg ? readLegacySkill(pkg.id) : null
    } catch {
      return null
    }
  })

  ipcMain.handle('skills:list', (): SkillMeta[] => {
    return listLegacySkills()
  })

  ipcMain.handle('skills:get', (_event, id: string): SkillMeta | null => {
    return readLegacySkill(id)
  })

  ipcMain.handle('skills:save', (_event, skill: SkillMeta): boolean => {
    return saveLegacySkill(skill)
  })

  ipcMain.handle('skills:delete', (_event, id: string): boolean => {
    return deleteSkill(id)
  })

  // ===== Claude Skills 风格目录包 API =====
  ipcMain.handle('skills:list-index', () => {
    return listSkillIndex()
  })

  ipcMain.handle('skills:get-package', (_event, id: string): SkillPackage | null => {
    return getSkillPackage(id)
  })

  ipcMain.handle('skills:create-package', (_event, payload: { id: string; readme: string }): SkillPackage | null => {
    return createSkillPackage(payload.id, payload.readme)
  })

  ipcMain.handle('skills:save-package', (_event, payload: { id: string; readme: string }): boolean => {
    return saveSkillPackage(payload.id, payload.readme)
  })

  ipcMain.handle('skills:import-package-url', async (_event, url: string): Promise<SkillPackage | null> => {
    try {
      return await importSkillFromUrl(url)
    } catch {
      return null
    }
  })

  ipcMain.handle('skills:migrate-legacy', (_event, id: string): SkillPackage | null => {
    return migrateLegacySkill(id)
  })

  ipcMain.handle('skills:read-resource', (_event, payload: { id: string; path: string }): SkillResourceReadResult => {
    return readSkillResource(payload.id, payload.path)
  })

  ipcMain.handle('skills:validate', (_event, id: string): SkillValidationResult => {
    return validateSkill(id)
  })

  // ===== ClawHub Registry =====
  // 每次都新建 client，让 CLAWHUB_REGISTRY env 改动后即时生效；client 本身无状态。
  function makeClient(token?: string, baseUrl?: string) {
    return new ClawHubClient({ token, baseUrl })
  }

  ipcMain.handle('clawhub:search', async (_event, payload: { query?: string; cursor?: string; limit?: number; token?: string; baseUrl?: string }): Promise<ClawHubListResponse | { error: string }> => {
    try {
      const client = makeClient(payload?.token, payload?.baseUrl)
      if (payload?.query && payload.query.trim()) return await client.searchSkills(payload.query, payload.limit ?? 30)
      return await client.listSkills({ limit: payload?.limit, cursor: payload?.cursor })
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('clawhub:get-skill', async (_event, payload: { slug: string; token?: string; baseUrl?: string }): Promise<ClawHubSkillDetail | { error: string }> => {
    try {
      const client = makeClient(payload?.token, payload?.baseUrl)
      return await client.getSkill(payload.slug)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('clawhub:get-version', async (_event, payload: { slug: string; version: string; token?: string; baseUrl?: string }): Promise<ClawHubVersionDetail | { error: string }> => {
    try {
      const client = makeClient(payload?.token, payload?.baseUrl)
      return await client.getVersion(payload.slug, payload.version)
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('clawhub:install', async (_event, payload: { slug: string; version?: string; overwrite?: boolean; token?: string; baseUrl?: string }): Promise<ClawHubInstallResult> => {
    try {
      const client = makeClient(payload?.token, payload?.baseUrl)
      return await installFromClawHub({
        slug: payload.slug,
        version: payload.version,
        overwrite: payload.overwrite ?? false,
        client,
        skillsDir,
      })
    } catch (err) {
      return { ok: false, errorCode: 'install-threw', error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('clawhub:uninstall', (_event, slug: string): boolean => {
    return uninstallClawHubSkill(skillsDir, slug)
  })

  ipcMain.handle('clawhub:list-installed', (): ClawHubLock => {
    return listInstalled(skillsDir)
  })

  // ===== P2 运行时：trust / env / deps =====
  ipcMain.handle('skills:trust-list', (): TrustStore => {
    return loadTrustStore(app.getPath('userData'))
  })

  ipcMain.handle('skills:trust-set', (_event, payload: { skillId: string; decision: 'trusted' | 'denied' }): boolean => {
    const version = getSkillPackage(payload.skillId)?.version
    recordDecision(app.getPath('userData'), payload.skillId, payload.decision, version)
    return true
  })

  ipcMain.handle('skills:trust-revoke', (_event, skillId: string): boolean => {
    return revokeTrust(app.getPath('userData'), skillId)
  })

  ipcMain.handle('skills:env-get', (): SkillEnvConfig => {
    return loadEnvConfig(app.getPath('userData'))
  })

  ipcMain.handle('skills:env-set', (_event, payload: { skillId: string; name: string; value: string | null }): boolean => {
    setSkillEnv(app.getPath('userData'), payload.skillId, payload.name, payload.value)
    return true
  })

  ipcMain.handle('skills:env-set-global', (_event, payload: { name: string; value: string | null }): boolean => {
    const cfg = loadEnvConfig(app.getPath('userData'))
    if (payload.value === null) delete cfg.global[payload.name]
    else cfg.global[payload.name] = payload.value
    saveEnvConfig(app.getPath('userData'), cfg)
    return true
  })

  ipcMain.handle('skills:check-deps', (_event, skillId: string): SkillDepsReport => {
    return checkSkillDeps(skillId)
  })

  ipcMain.handle('mcp:tool-call', async (_event, request: { serverId: string; toolName: string; params: Record<string, string> }) => {
    // TODO: 桥接到实际的 MCP 工具服务
    console.warn('[MCP] tool-call 未实现:', request.serverId, request.toolName)
    return { success: false, error: `MCP 工具 "${request.serverId}/${request.toolName}" 尚未实现` }
  })
}
