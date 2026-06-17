import { ipcMain, safeStorage, app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

// 加密存储文件：与普通 store.json 分离，仅存放敏感数据（API Key 等）
// 使用 Electron 内置 safeStorage：Windows DPAPI / macOS Keychain / Linux libsecret
function getStorePath(): string {
  return join(app.getPath('userData'), 'secure-store.json')
}

function loadStore(): Record<string, string> {
  try {
    const p = getStorePath()
    if (existsSync(p)) {
      return JSON.parse(readFileSync(p, 'utf-8'))
    }
  } catch {
    // ignore
  }
  return {}
}

function saveStore(store: Record<string, string>) {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(getStorePath(), JSON.stringify(store), 'utf-8')
}

/**
 * 主进程内部读取并解密（与 secure-storage:get IPC 同逻辑）。
 * 容错：safeStorage 不可用时（如 tsx 测试环境间接 import 本模块）返回空串，不抛错——
 * 这让依赖本模块的搜索代码能在非 electron 环境（测试）里安全加载。
 */
export function readSecret(key: string): string {
  try {
    if (!safeStorage?.isEncryptionAvailable?.()) return ''
    const encrypted = loadStore()[key]
    if (!encrypted) return ''
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch {
    return ''
  }
}

export function registerSecureStorageHandlers() {
  // 读取并解密（复用 readSecret）
  ipcMain.handle('secure-storage:get', (_e, key: string): string => readSecret(key))

  // 加密并写入；空值则删除条目
  ipcMain.handle('secure-storage:set', (_e, key: string, value: string): boolean => {
    if (!safeStorage.isEncryptionAvailable()) return false
    const store = loadStore()
    if (!value) {
      delete store[key]
    } else {
      store[key] = safeStorage.encryptString(value).toString('base64')
    }
    saveStore(store)
    return true
  })

  // 删除条目
  ipcMain.handle('secure-storage:delete', (_e, key: string): boolean => {
    const store = loadStore()
    delete store[key]
    saveStore(store)
    return true
  })

  // 探测当前平台是否支持加密（部分 Linux 无密钥环时为 false）
  ipcMain.handle('secure-storage:available', (): boolean => safeStorage.isEncryptionAvailable())
}
