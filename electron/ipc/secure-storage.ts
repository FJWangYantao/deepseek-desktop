import { ipcMain, safeStorage, app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

// 加密存储文件：与普通 store.json 分离，仅存放敏感数据（API Key 等）
// 使用 Electron 内置 safeStorage：Windows DPAPI / macOS Keychain / Linux libsecret
const SECURE_STORE_PATH = join(app.getPath('userData'), 'secure-store.json')

function loadStore(): Record<string, string> {
  try {
    if (existsSync(SECURE_STORE_PATH)) {
      const raw = readFileSync(SECURE_STORE_PATH, 'utf-8')
      return JSON.parse(raw)
    }
  } catch {
    // ignore
  }
  return {}
}

function saveStore(store: Record<string, string>) {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(SECURE_STORE_PATH, JSON.stringify(store), 'utf-8')
}

export function registerSecureStorageHandlers() {
  // 读取并解密
  ipcMain.handle('secure-storage:get', (_e, key: string): string => {
    if (!safeStorage.isEncryptionAvailable()) return ''
    const store = loadStore()
    const encrypted = store[key]
    if (!encrypted) return ''
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch {
      return ''
    }
  })

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
