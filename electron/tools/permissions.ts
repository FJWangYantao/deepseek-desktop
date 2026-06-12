import type { ToolPermissionConfig, ToolPermissionRule } from '../../src/types/tools'
import { app } from 'electron'
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { basename, parse, relative, resolve, isAbsolute } from 'path'
import { checkTrust, loadTrustStore } from '../skills/runtime/trust-store'
import { getSkillPackage } from '../skills/service'

const CONFIG_FILE = resolve(app.getPath('userData'), 'tool-permissions.json')

const DEFAULT_CONFIG: ToolPermissionConfig = {
  mode: 'confirm',
  defaultPolicy: 'auto',
  rules: [
    { toolName: 'web_search', level: 'auto' },
    { toolName: 'web_fetch', level: 'auto' },
    { toolName: 'file_read', level: 'whitelist' },
    { toolName: 'file_write', level: 'confirm' },
    { toolName: 'list_dir', level: 'whitelist' },
    { toolName: 'skill_load', level: 'auto' },
    { toolName: 'skill_read_resource', level: 'auto' },
    { toolName: 'skill_check_deps', level: 'auto' },
    { toolName: 'skill_script_run', level: 'confirm' },
  ],
}

type PermissionDecision =
  | { status: 'allow' }
  | { status: 'confirm'; reason: string }
  | { status: 'block'; reason: string }

interface DangerousWriteResult {
  dangerous: boolean
  reason?: string
}

export function loadPermissionConfig(): ToolPermissionConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      const raw = readFileSync(CONFIG_FILE, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<ToolPermissionConfig>
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        mode: parsed.mode ?? 'confirm',
        defaultPolicy: parsed.defaultPolicy ?? DEFAULT_CONFIG.defaultPolicy,
        rules: parsed.rules ?? DEFAULT_CONFIG.rules,
      }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG }
}

export function savePermissionConfig(config: ToolPermissionConfig): void {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
}

function isInsidePath(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function hasPathTraversal(rawPath: string): boolean {
  return rawPath.split(/[\\/]+/).some(part => part === '..')
}

function isSensitiveFileName(name: string): boolean {
  const lower = name.toLowerCase()
  return lower === '.env'
    || lower.startsWith('.env.')
    || ['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'].includes(lower)
    || lower.endsWith('.pem')
    || lower.endsWith('.key')
}

function hasSensitiveDirectory(targetPath: string): boolean {
  const parts = targetPath.split(/[\\/]+/).map(p => p.toLowerCase())
  return parts.includes('.ssh') || parts.includes('.gnupg') || parts.includes('.aws')
}

function isSystemPath(targetPath: string): boolean {
  const normalized = resolve(targetPath)
  const root = parse(normalized).root
  if (normalized === root) return true

  // Windows 系统目录
  if (/^[a-z]:\\/i.test(root)) {
    if (relative(root, normalized).split(/[\\/]+/).length === 1) return true
    const systemDirs = [
      resolve(root, 'Windows'),
      resolve(root, 'Program Files'),
      resolve(root, 'Program Files (x86)'),
      resolve(root, 'ProgramData'),
    ]
    return systemDirs.some(dir => isInsidePath(dir, normalized))
  }

  // macOS / Linux 系统目录
  const systemDirs = ['/etc', '/bin', '/sbin', '/usr', '/var', '/System', '/Library', '/Applications']
  return systemDirs.some(dir => isInsidePath(dir, normalized))
}

function checkDangerousFileWrite(toolName: string, args: Record<string, unknown>): DangerousWriteResult {
  if (toolName !== 'file_write') return { dangerous: false }

  const rawPath = args.path
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    return { dangerous: true, reason: '写入路径无效' }
  }

  if (hasPathTraversal(rawPath)) {
    return { dangerous: true, reason: '拒绝包含路径穿越的写入路径' }
  }

  let targetPath: string
  try {
    targetPath = resolve(rawPath)
  } catch {
    return { dangerous: true, reason: '写入路径无效' }
  }

  if (isSystemPath(targetPath)) {
    return { dangerous: true, reason: '拒绝写入系统目录' }
  }

  if (hasSensitiveDirectory(targetPath)) {
    return { dangerous: true, reason: '拒绝写入敏感目录' }
  }

  if (isSensitiveFileName(basename(targetPath))) {
    return { dangerous: true, reason: '拒绝写入敏感文件' }
  }

  try {
    if (existsSync(targetPath) && statSync(targetPath).isDirectory()) {
      return { dangerous: true, reason: '目标是目录，拒绝写入' }
    }
  } catch { /* ignore */ }

  return { dangerous: false }
}

function checkWhitelist(rule: ToolPermissionRule, args: Record<string, unknown>): PermissionDecision {
  const rawTarget = (args.path as string) || ''
  if (!rawTarget) return { status: 'confirm', reason: '路径为空，需要确认' }

  let targetPath: string
  try {
    targetPath = resolve(rawTarget)
  } catch {
    return { status: 'confirm', reason: '路径无效，需要确认' }
  }

  const isInside = rule.allowedPaths?.some(p => {
    try {
      return isInsidePath(p, targetPath)
    } catch {
      return false
    }
  })

  return isInside
    ? { status: 'allow' }
    : { status: 'confirm', reason: '该路径不在白名单中，需要确认' }
}

function checkRule(
  toolName: string,
  args: Record<string, unknown>,
  rule: ToolPermissionRule | undefined,
  config: ToolPermissionConfig
): PermissionDecision {
  if (!rule) {
    return config.defaultPolicy === 'confirm'
      ? { status: 'confirm', reason: '需要确认' }
      : { status: 'allow' }
  }

  switch (rule.level) {
    case 'auto':
      return { status: 'allow' }
    case 'blocked':
      return { status: 'block', reason: '该工具已被禁用' }
    case 'confirm':
      return { status: 'confirm', reason: '需要确认' }
    case 'whitelist':
      return checkWhitelist(rule, args)
    default:
      return { status: 'allow' }
  }
}

/**
 * skill_script_run 的 trust 闸门：与权限 mode 无关的硬约束。
 * 即使在 auto / yolo 模式，未被信任的 Skill 首次执行外部命令也必须经过用户确认，
 * 不能被自动放行（P2 决策 4）。返回 null 表示该工具不受此闸门约束。
 */
function checkSkillTrustGate(toolName: string, args: Record<string, unknown>): PermissionDecision | null {
  if (toolName !== 'skill_script_run') return null
  const skillId = String(args.skill_id || '').trim()
  if (!skillId) return { status: 'block', reason: '缺少 skill_id' }

  let version: string | undefined
  try {
    version = getSkillPackage(skillId)?.version
  } catch { /* ignore — version 拿不到就按 undefined 处理 */ }

  const store = loadTrustStore(app.getPath('userData'))
  const trust = checkTrust(store, skillId, version)
  if (trust.state === 'denied') {
    return { status: 'block', reason: `Skill "${skillId}" 已被标记为拒绝执行外部命令` }
  }
  if (trust.state === 'pending') {
    return { status: 'confirm', reason: trust.reason }
  }
  return { status: 'allow' }
}

// 检查工具是否被允许执行：allow = 自动放行，confirm = 需要确认，block = 直接拒绝
export function checkPermission(
  toolName: string,
  args: Record<string, unknown>,
  config: ToolPermissionConfig
): PermissionDecision {
  const rule = config.rules.find(r => r.toolName === toolName)

  if (rule?.level === 'blocked') {
    return { status: 'block', reason: '该工具已被禁用' }
  }

  const danger = checkDangerousFileWrite(toolName, args)
  if (danger.dangerous) {
    return { status: 'block', reason: danger.reason || '危险写入已被拒绝' }
  }

  // skill_script_run 的 trust 闸门优先于任何 mode：
  // pending → 强制 confirm；denied → 强制 block；即使 auto/yolo 也不放行未授权的 Skill。
  const trustGate = checkSkillTrustGate(toolName, args)
  if (trustGate && trustGate.status !== 'allow') {
    return trustGate
  }

  if (config.mode === 'yolo') {
    return { status: 'allow' }
  }

  if (config.mode === 'auto') {
    if (toolName !== 'file_read' && toolName !== 'list_dir' && rule?.level === 'confirm') {
      return { status: 'allow' }
    }
  }

  return checkRule(toolName, args, rule, config)
}
