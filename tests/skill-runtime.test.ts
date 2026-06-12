/**
 * P2 测试：Skill 运行时 — trust store / env resolver / script-run 白名单。
 * 用法：npx tsx tests/skill-runtime.test.ts
 *
 * 覆盖：
 *  - trust store：pending / trusted / denied / 版本升级重新询问 / revoke
 *  - env resolver：per-skill > global > system 优先级 / 缺失必填 / 缺失选填
 *  - script-run：白名单拒绝未声明命令 / bin 未找到 / ${ENV} 占位符展开 / 真实命令执行
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { platform } from 'node:os'
import {
  checkTrust,
  loadTrustStore,
  recordDecision,
  revokeTrust,
} from '../electron/skills/runtime/trust-store'
import {
  resolveEnv,
  type SkillEnvConfig,
} from '../electron/skills/runtime/env-resolver'
import { runScript } from '../electron/skills/runtime/script-run'
import type { SkillRuntimeMetadata } from '../src/types/skills'

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, cond: unknown, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

function makeTempDir(): string {
  const dir = join(tmpdir(), `skill-rt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}
function cleanDir(dir: string) { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }) }

console.log('\n=== P2: Skill Runtime 测试 ===\n')

// ===== 1. Trust store =====
console.log('[1] Trust store')
{
  const dir = makeTempDir()
  try {
    // 全新 → pending
    let store = loadTrustStore(dir)
    check('全新 store 为空', Object.keys(store.entries).length === 0)
    check('未决策 → pending', checkTrust(store, 'todoist-cli', '1.0.0').state === 'pending')

    // 记录 trusted
    recordDecision(dir, 'todoist-cli', 'trusted', '1.0.0')
    store = loadTrustStore(dir)
    check('记录后 → trusted', checkTrust(store, 'todoist-cli', '1.0.0').state === 'trusted')

    // 版本升级 → 重新 pending
    const upgraded = checkTrust(store, 'todoist-cli', '2.0.0')
    check('版本升级 → pending', upgraded.state === 'pending')
    check('版本升级 reason 提到重新授权', upgraded.state === 'pending' && upgraded.reason.includes('重新授权'))

    // 同版本仍 trusted
    check('同版本仍 trusted', checkTrust(store, 'todoist-cli', '1.0.0').state === 'trusted')

    // denied
    recordDecision(dir, 'evil-skill', 'denied', '1.0.0')
    store = loadTrustStore(dir)
    check('denied 决策生效', checkTrust(store, 'evil-skill', '1.0.0').state === 'denied')

    // revoke
    const revoked = revokeTrust(dir, 'todoist-cli')
    check('revoke 返回 true', revoked)
    store = loadTrustStore(dir)
    check('revoke 后 → pending', checkTrust(store, 'todoist-cli', '1.0.0').state === 'pending')
    check('revoke 不存在的返回 false', !revokeTrust(dir, 'never-existed'))

    // 无版本信息时不触发升级重询
    recordDecision(dir, 'no-ver', 'trusted')
    store = loadTrustStore(dir)
    check('无版本记录 + 查询带版本 → trusted', checkTrust(store, 'no-ver', '9.9.9').state === 'trusted')
  } finally { cleanDir(dir) }
}

// ===== 2. Env resolver 优先级 =====
console.log('\n[2] Env resolver 优先级')
{
  const config: SkillEnvConfig = {
    version: 1,
    global: { SHARED_KEY: 'global-val', ONLY_GLOBAL: 'g' },
    perSkill: { 'todoist-cli': { SHARED_KEY: 'skill-val', SKILL_ONLY: 's' } },
  }
  const systemEnv = { SHARED_KEY: 'sys-val', ONLY_SYS: 'sys', PATH: '/usr/bin' }

  const r = resolveEnv({
    skillId: 'todoist-cli',
    required: ['SHARED_KEY', 'SKILL_ONLY', 'ONLY_GLOBAL', 'ONLY_SYS'],
    optional: ['MISSING_OPT'],
    config,
    systemEnv,
  })

  check('per-skill 覆盖 global/system', r.values.SHARED_KEY === 'skill-val')
  check('SHARED_KEY 来源 = user-skill', r.sources.SHARED_KEY === 'user-skill')
  check('skill-only 解析', r.values.SKILL_ONLY === 's')
  check('global 兜底', r.values.ONLY_GLOBAL === 'g')
  check('ONLY_GLOBAL 来源 = user-global', r.sources.ONLY_GLOBAL === 'user-global')
  check('system 兜底', r.values.ONLY_SYS === 'sys')
  check('ONLY_SYS 来源 = system', r.sources.ONLY_SYS === 'system')
  check('缺失选填进 missingOptional', r.missingOptional.includes('MISSING_OPT'))
  check('无缺失必填', r.missingRequired.length === 0)
}

// ===== 3. Env resolver 缺失必填 =====
console.log('\n[3] Env resolver 缺失必填')
{
  const r = resolveEnv({
    skillId: 'x',
    required: ['NEEDED'],
    config: { version: 1, global: {}, perSkill: {} },
    systemEnv: {},
  })
  check('缺失必填进 missingRequired', r.missingRequired.includes('NEEDED'))
  check('空值不算已配置', r.values.NEEDED === undefined)

  // 空字符串视为未配置
  const r2 = resolveEnv({
    skillId: 'x',
    required: ['EMPTY'],
    config: { version: 1, global: { EMPTY: '' }, perSkill: {} },
    systemEnv: {},
  })
  check('空字符串视为未配置', r2.missingRequired.includes('EMPTY'))
}

// ===== 4. script-run 白名单 =====
console.log('\n[4] script-run 白名单拒绝')
{
  const runtime: SkillRuntimeMetadata = { requires: { bins: ['echo'] } }
  const result = await runScript({
    skillId: 'test',
    runtime,
    command: 'rm',  // 不在白名单
    args: ['-rf', '/'],
    requiredEnv: [],
    optionalEnv: [],
  })
  check('未声明命令被拒绝', !result.ok)
  check('errorCode = command-not-allowed', result.errorCode === 'command-not-allowed')
  check('错误信息列出允许的命令', (result.error ?? '').includes('echo'))
}

// ===== 5. script-run bin 未找到 =====
console.log('\n[5] script-run bin 未找到')
{
  const runtime: SkillRuntimeMetadata = { requires: { bins: ['this-bin-does-not-exist-12345'] } }
  const result = await runScript({
    skillId: 'test',
    runtime,
    command: 'this-bin-does-not-exist-12345',
    args: [],
    requiredEnv: [],
    optionalEnv: [],
  })
  check('不存在的 bin 被拒绝', !result.ok)
  check('errorCode = bin-not-found', result.errorCode === 'bin-not-found')
}

// ===== 6. script-run 真实执行 + 占位符展开 =====
console.log('\n[6] script-run 真实执行')
{
  // 跨平台都有的命令：node（项目肯定装了 node）
  const runtime: SkillRuntimeMetadata = { requires: { bins: ['node'] } }
  const result = await runScript({
    skillId: 'test',
    runtime,
    command: 'node',
    args: ['-e', 'console.log("hello from skill")'],
    requiredEnv: [],
    optionalEnv: [],
  })
  check('node 执行成功', result.ok, result.error)
  check('stdout 含输出', result.stdout.includes('hello from skill'))
  check('记录了 resolvedPath', !!result.resolvedPath)
  check('记录了耗时', typeof result.elapsedMs === 'number')
}

// ===== 7. script-run 占位符展开（env 注入） =====
console.log('\n[7] script-run 占位符展开')
{
  // 用 node 打印环境变量验证占位符替换 + env 注入
  // 注意：resolveEnv 在 runScript 内部会从真实 userData 读，这里测不到注入值，
  // 但能验证占位符语法不会破坏参数（未匹配的占位符原样保留）
  const runtime: SkillRuntimeMetadata = { requires: { bins: ['node'], env: [] } }
  const result = await runScript({
    skillId: 'test-no-env',
    runtime,
    command: 'node',
    args: ['-e', 'console.log("literal-ok")'],
    requiredEnv: [],
    optionalEnv: [],
  })
  check('占位符未破坏正常参数', result.ok && result.stdout.includes('literal-ok'))
}

// ===== 8. script-run 未配置占位符不污染参数（回归：曾经返回整个 arg 导致自嵌套） =====
console.log('\n[8] script-run 未配置占位符回归')
{
  // key:${MISS} 在 MISS 未配置时，应原样保留为 key:${MISS}，
  // 而不是变成 key:key:${MISS}（旧实现的自嵌套 bug）。用 node 回显该参数验证。
  // 注意探针不能以 `--` 开头，否则被 node 当成自身选项吃掉。
  const runtime: SkillRuntimeMetadata = { requires: { bins: ['node'] } }
  const result = await runScript({
    skillId: 'test-miss-placeholder',
    runtime,
    command: 'node',
    args: ['-e', 'process.stdout.write(process.argv[1])', 'key:${DEFINITELY_MISSING_E2E}'],
    requiredEnv: [],
    optionalEnv: ['DEFINITELY_MISSING_E2E'],
  })
  check('未配置占位符原样保留', result.ok && result.stdout.trim() === 'key:${DEFINITELY_MISSING_E2E}', result.stdout)
  check('未发生自嵌套', !result.stdout.includes('key:key:'), result.stdout)
}

console.log('\n')
console.log(`Passed: ${passed}`)
console.log(`Failed: ${failed}`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
}
