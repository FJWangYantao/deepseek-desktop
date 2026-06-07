import type { ToolPermissionConfig, ToolPermissionRule } from '../../src/types/tools'
import { ipcMain, app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const CONFIG_FILE = join(app.getPath('userData'), 'tool-permissions.json')

const DEFAULT_CONFIG: ToolPermissionConfig = {
  defaultPolicy: 'auto',
  rules: [
    { toolName: 'web_search', level: 'auto' },
    { toolName: 'web_fetch', level: 'auto' },
    { toolName: 'file_read', level: 'whitelist' },
    { toolName: 'file_write', level: 'confirm' },
  ],
}

export function loadPermissionConfig(): ToolPermissionConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      const raw = readFileSync(CONFIG_FILE, 'utf-8')
      return JSON.parse(raw)
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG }
}

export function savePermissionConfig(config: ToolPermissionConfig): void {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
}

// 检查工具是否被允许执行，返回需要用户确认的原因（null = 自动放行）
export function checkPermission(
  toolName: string,
  args: Record<string, unknown>,
  config: ToolPermissionConfig
): string | null {
  const rule = config.rules.find(r => r.toolName === toolName)

  // 无匹配规则时使用默认策略
  if (!rule) {
    return config.defaultPolicy === 'confirm' ? '需要确认' : null
  }

  switch (rule.level) {
    case 'auto':
      return null
    case 'blocked':
      return '该工具已被禁用'
    case 'confirm':
      return '需要确认'
    case 'whitelist': {
      // 文件工具检查路径白名单
      const targetPath = (args.path as string) || ''
      if (rule.allowedPaths?.some(p => targetPath.startsWith(p))) {
        return null
      }
      return '该路径不在白名单中，需要确认'
    }
    default:
      return null
  }
}
