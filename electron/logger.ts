/**
 * 轻量结构化 logger。
 *
 * 设计目标:
 * - 同时输出到 console(开发时实时看)和按天轮转的 JSONL 文件(事后查问题)
 * - 子 logger 自动带 category,业务代码只关心 message + meta
 * - 渲染进程不直接 import 此模块(会拖入 electron app),用 console + IPC 上报
 *
 * 日志格式（JSONL）:
 *   {"ts":"2026-06-17T12:34:56.789Z","level":"info","category":"web_search","message":"...","meta":{...}}
 *
 * 文件路径: <userData>/logs/app-YYYY-MM-DD.jsonl
 *
 * 扩展点（注释而非接口，YAGNI）:
 * - 加 transport: addTransport({write: entry => ...})
 * - 加全局过滤: 在 emit() 入口判断 level >= minLevel
 * - 渲染进程上报: ipcMain.handle('logger:write', (_, entry) => emit(entry))
 * - 远端上报: 实现一个 httpTransport 推送到收集端
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEntry {
  ts: string
  level: LogLevel
  category: string
  message: string
  meta?: Record<string, unknown>
}

export interface Transport {
  write(entry: LogEntry): void
}

let transports: Transport[] = []

/** 主进程启动时注入实际的 userData 路径；测试时可注入 tmpdir。注入前 file transport 不工作（仅 console）。 */
export function configureFileLogger(userDataDir: string): void {
  const dir = join(userDataDir, 'logs')
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  } catch {
    // 目录创建失败时降级为只 console，不抛错阻塞应用启动
    return
  }
  // 移除旧的 file transport（避免 configureFileLogger 被多次调用时重复写入）
  transports = transports.filter(t => !(t as { __isFile?: boolean }).__isFile)
  transports.push(makeFileTransport(dir))
}

/** 给测试用的：清空所有 transport 并替换。 */
export function _setTransportsForTest(ts: Transport[]): void {
  transports = ts
}

function makeFileTransport(logsDir: string): Transport {
  const t: Transport & { __isFile?: boolean } = {
    write(entry: LogEntry) {
      // 按 entry.ts 的日期分文件，跨天自动落到新文件
      const day = entry.ts.slice(0, 10) // YYYY-MM-DD
      const path = join(logsDir, `app-${day}.jsonl`)
      try {
        appendFileSync(path, JSON.stringify(entry) + '\n', 'utf-8')
      } catch {
        // 写盘失败静默；console transport 仍能保留信息
      }
    },
  }
  t.__isFile = true
  return t
}

const consoleTransport: Transport = {
  write(entry: LogEntry) {
    const time = entry.ts.slice(11, 19) // HH:MM:SS
    const tag = `[${entry.category}]`
    const meta = entry.meta && Object.keys(entry.meta).length > 0
      ? ' ' + JSON.stringify(entry.meta)
      : ''
    const line = `${time} ${entry.level.toUpperCase().padEnd(5)} ${tag} ${entry.message}${meta}`
    if (entry.level === 'error') console.error(line)
    else if (entry.level === 'warn') console.warn(line)
    else console.log(line)
  },
}

// 默认就启用 console；file transport 等 configureFileLogger 注入。
transports.push(consoleTransport)

function emit(level: LogLevel, category: string, message: string, meta?: Record<string, unknown>): void {
  // Date.now / new Date 在工作流脚本环境会抛错（writing-plans 脚本约束），
  // 但主进程是真实 electron 环境无此限制；此处直接 new Date 即可。
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    category,
    message,
    ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
  }
  for (const t of transports) {
    try { t.write(entry) } catch { /* transport 自身挂掉不影响其它 */ }
  }
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

/** 创建子 logger，绑定 category。category 建议用 snake_case，如 'web_search'/'zhihu'/'tavily'。 */
export function createLogger(category: string): Logger {
  return {
    debug: (m, meta) => emit('debug', category, m, meta),
    info: (m, meta) => emit('info', category, m, meta),
    warn: (m, meta) => emit('warn', category, m, meta),
    error: (m, meta) => emit('error', category, m, meta),
  }
}
