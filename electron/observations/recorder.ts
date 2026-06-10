import { app } from 'electron'
import { existsSync, mkdirSync, statSync, appendFileSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_LINE_BYTES = 32 * 1024
const RETENTION_DAYS = 14
const MAX_TEXT_PREVIEW = 2000
const MAX_TOOL_DATA_PREVIEW = 4000

// 注意：不匹配 _tokens 后缀（如 prompt_tokens/completion_tokens/total_tokens），那些是用量统计不是敏感信息
const SENSITIVE_KEY_PATTERN = /(api[_-]?key|authorization|access[_-]?token|bearer|password|secret|cookie|set-cookie|^(?:token|refresh[_-]?token)$)/i
const PATH_KEY_PATTERN = /path/i
const FILE_NAME_PATTERN = /^[A-Za-z]:[\\/].+|^\/[^\s]+/ // Windows 绝对路径或 *nix 绝对路径

let cachedDir: string | null = null
let cleanedUp = false

function ensureDir(): string {
  if (cachedDir) return cachedDir
  const dir = join(app.getPath('userData'), 'observations')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  cachedDir = dir
  return dir
}

function todayStamp(): string {
  // 不依赖 Date.now mock，直接 new Date()。recorder 在主进程，无 superpowers 限制。
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function pickFile(): string {
  const dir = ensureDir()
  const stamp = todayStamp()
  for (let i = 0; i < 1000; i++) {
    const p = join(dir, `observations-${stamp}.${i}.jsonl`)
    if (!existsSync(p)) return p
    try {
      const size = statSync(p).size
      if (size < MAX_FILE_BYTES) return p
    } catch {
      return p
    }
  }
  return join(dir, `observations-${stamp}.fallback.jsonl`)
}

/** 仅截断字符串字段；不破坏非字符串结构 */
function truncateString(value: string, max: number): string {
  if (value.length <= max) return value
  return value.slice(0, max) + `…[+${value.length - max}]`
}

function basename(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || p
}

/** 递归脱敏对象/数组；不破坏类型，但替换敏感值和长字符串 */
function sanitizeValue(value: unknown, keyHint?: string, depth = 0): unknown {
  if (depth > 8) return '[DEPTH_LIMIT]'
  if (value == null) return value
  if (typeof value === 'string') {
    if (keyHint && SENSITIVE_KEY_PATTERN.test(keyHint)) return '[REDACTED]'
    let out = value
    if (keyHint && PATH_KEY_PATTERN.test(keyHint)) {
      out = basename(out)
    } else if (FILE_NAME_PATTERN.test(out)) {
      out = `[PATH]/${basename(out)}`
    }
    return truncateString(out, MAX_TEXT_PREVIEW)
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 50).map(v => sanitizeValue(v, keyHint, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = '[REDACTED]'
      } else {
        out[k] = sanitizeValue(v, k, depth + 1)
      }
    }
    return out
  }
  return String(value)
}

function sanitizeEvent(event: Record<string, unknown>): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(event)) as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(cloned)) {
    // 工具结果/输入预览允许更长
    if (k === 'dataPreview' || k === 'inputPreview' || k === 'userTextPreview' || k === 'assistantTextPreview') {
      const max = k === 'dataPreview' ? MAX_TOOL_DATA_PREVIEW : MAX_TEXT_PREVIEW
      result[k] = typeof v === 'string' ? truncateString(v, max) : sanitizeValue(v, k)
    } else if (SENSITIVE_KEY_PATTERN.test(k)) {
      result[k] = '[REDACTED]'
    } else {
      result[k] = sanitizeValue(v, k)
    }
  }
  return result
}

function serializeLine(event: Record<string, unknown>): string {
  let line = JSON.stringify(event)
  if (line.length <= MAX_LINE_BYTES) return line
  // 二次裁剪：粗暴替换最大的字符串字段
  const trimmed: Record<string, unknown> = { ...event }
  for (const k of Object.keys(trimmed)) {
    const v = trimmed[k]
    if (typeof v === 'string' && v.length > 500) {
      trimmed[k] = v.slice(0, 500) + '…[TRUNCATED]'
    }
  }
  line = JSON.stringify(trimmed)
  if (line.length > MAX_LINE_BYTES) line = line.slice(0, MAX_LINE_BYTES - 16) + '…[TRUNCATED]"}'
  return line
}

export function appendObservation(event: Record<string, unknown>): { ok: boolean; file?: string; error?: string } {
  try {
    runCleanupOnce()
    const sanitized = sanitizeEvent(event)
    const line = serializeLine(sanitized) + '\n'
    const file = pickFile()
    appendFileSync(file, line, 'utf-8')
    return { ok: true, file }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function appendObservations(events: Record<string, unknown>[]): { ok: boolean; file?: string; error?: string } {
  try {
    runCleanupOnce()
    let lastFile: string | undefined
    for (const event of events) {
      const sanitized = sanitizeEvent(event)
      const line = serializeLine(sanitized) + '\n'
      const file = pickFile()
      appendFileSync(file, line, 'utf-8')
      lastFile = file
    }
    return { ok: true, file: lastFile }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function flushObservations(): { ok: boolean } {
  // 当前实现为同步 append，flush 无需处理；保留接口便于后续切缓冲队列
  return { ok: true }
}

function runCleanupOnce() {
  if (cleanedUp) return
  cleanedUp = true
  try {
    cleanupOldObservationFiles()
  } catch (e) {
    console.warn('[Observation] cleanup failed:', e)
  }
}

function cleanupOldObservationFiles() {
  const dir = ensureDir()
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  const files = readdirSync(dir)
  for (const name of files) {
    const m = name.match(/^observations-(\d{4})-(\d{2})-(\d{2})\.\w+\.jsonl$/)
    if (!m) continue
    const ts = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`).getTime()
    if (!Number.isFinite(ts)) continue
    if (ts < cutoff) {
      try {
        unlinkSync(join(dir, name))
      } catch {
        // ignore
      }
    }
  }
}
