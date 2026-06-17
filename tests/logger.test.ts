/**
 * Logger 模块测试。验证:
 * 1. createLogger 返回的对象有 debug/info/warn/error 方法且不抛错
 * 2. file transport 写出 JSONL，每行可解析、字段完整
 * 3. 多次调用同一 logger 追加而不覆盖
 * 4. configureFileLogger 重复调用不会重复写
 *
 * 用法: npx tsx tests/logger.test.ts
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { configureFileLogger, createLogger, _setTransportsForTest } from '../electron/logger'

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, cond: unknown, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// 静默 console transport 输出，只测 file
const _log = console.log
const _warn = console.warn
const _err = console.error
function silenceConsole() {
  console.log = () => {}
  console.warn = () => {}
  console.error = () => {}
}
function restoreConsole() {
  console.log = _log
  console.warn = _warn
  console.error = _err
}

console.log('\n[1] createLogger 基础接口')
{
  // 重置 transports 为空，验证不写盘也不抛错
  _setTransportsForTest([])
  const log = createLogger('test')
  let threw = false
  try {
    log.debug('d', { k: 1 })
    log.info('i')
    log.warn('w', {})
    log.error('e', { err: 'x' })
  } catch { threw = true }
  check('四个 level 调用不抛错', !threw)
}

console.log('\n[2] file transport JSONL 写盘 + 字段完整')
{
  const tmp = mkdtempSync(join(tmpdir(), 'ds-logger-'))
  // 测试时只保留 file transport，避免 console 输出污染
  _setTransportsForTest([])
  configureFileLogger(tmp)
  silenceConsole()

  const log = createLogger('web_search')
  log.info('开始搜索', { query: 'hello', variants: 3 })
  log.warn('Tavily HTTP 429', { status: 429 })
  log.error('解析失败', { err: 'oops' })
  log.debug('无 meta')

  restoreConsole()

  // 找日志文件（按天命名,只可能有一个）
  const logsDir = join(tmp, 'logs')
  const files = readdirSync(logsDir).filter(f => f.startsWith('app-') && f.endsWith('.jsonl'))
  check('恰好生成一个 jsonl 文件', files.length === 1, `files=${files.join(',')}`)

  if (files.length === 1) {
    const lines = readFileSync(join(logsDir, files[0]), 'utf-8').trim().split('\n')
    check('写入 4 行', lines.length === 4, `lines=${lines.length}`)

    const e0 = JSON.parse(lines[0])
    check('字段 ts 存在且为 ISO', typeof e0.ts === 'string' && e0.ts.includes('T'))
    check('字段 level=info', e0.level === 'info')
    check('字段 category=web_search', e0.category === 'web_search')
    check('字段 message=开始搜索', e0.message === '开始搜索')
    check('字段 meta.query=hello', e0.meta?.query === 'hello')
    check('字段 meta.variants=3', e0.meta?.variants === 3)

    const e3 = JSON.parse(lines[3])
    check('debug 无 meta 时不写 meta 字段', e3.meta === undefined, `e3.meta=${JSON.stringify(e3.meta)}`)
  }

  rmSync(tmp, { recursive: true, force: true })
}

console.log('\n[3] configureFileLogger 重复调用不重复写')
{
  const tmp = mkdtempSync(join(tmpdir(), 'ds-logger-'))
  _setTransportsForTest([])
  configureFileLogger(tmp)
  configureFileLogger(tmp) // 第二次调用应替换而非追加 transport

  silenceConsole()
  createLogger('cat').info('once')
  restoreConsole()

  const logsDir = join(tmp, 'logs')
  const files = readdirSync(logsDir)
  const lines = readFileSync(join(logsDir, files[0]), 'utf-8').trim().split('\n')
  check('一次 log 调用只写一行（不被双写）', lines.length === 1, `lines=${lines.length}`)

  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${failed === 0 ? '✓' : '✗'} ${passed} passed, ${failed} failed`)
if (failed > 0) { console.log('\n失败项：'); failures.forEach(f => console.log('  - ' + f)) }
process.exit(failed > 0 ? 1 : 0)
