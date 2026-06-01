import { ipcMain } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

const storePath = join(app.getPath('userData'), 'store.json')

function loadStore(): Record<string, string> {
  try {
    if (existsSync(storePath)) {
      const data = readFileSync(storePath, 'utf-8')
      return JSON.parse(data)
    }
  } catch {
    // ignore
  }
  return {}
}

function saveStore(data: Record<string, string>) {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf-8')
}

export function registerStorageHandlers() {
  ipcMain.handle('store:set', (_event, key: string, value: string) => {
    const data = loadStore()
    data[key] = value
    saveStore(data)
    return true
  })

  ipcMain.handle('store:get', (_event, key: string) => {
    const data = loadStore()
    return data[key] ?? null
  })

  ipcMain.handle('store:delete', (_event, key: string) => {
    const data = loadStore()
    delete data[key]
    saveStore(data)
    return true
  })
}
