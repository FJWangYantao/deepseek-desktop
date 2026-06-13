/**
 * 工作模式能力策略测试 — filterToolSchema 纯函数 + 三模式 capabilities 断言。
 * 用法：npx tsx tests/mode-policy.test.ts
 */
import {
  workModes,
  filterToolSchema,
  type ToolSchemaItem,
} from '../src/data/workModes'

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, cond: unknown, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// 9 个内置工具的 mock schema
const ALL_TOOLS: ToolSchemaItem[] = [
  'web_search', 'web_fetch', 'file_read', 'file_write', 'list_dir',
  'skill_load', 'skill_read_resource', 'skill_check_deps', 'skill_script_run',
].map(name => ({ type: 'function' as const, function: { name, description: '', parameters: {} } }))

console.log('\n[1] filterToolSchema — all')
{
  check('all 返回全部 9 个', filterToolSchema(ALL_TOOLS, 'all').length === 9)
  check('all 不改变元素', filterToolSchema(ALL_TOOLS, 'all')[0].function.name === 'web_search')
}

console.log('\n[2] filterToolSchema — 白名单')
{
  const filtered = filterToolSchema(ALL_TOOLS, ['web_search', 'web_fetch'])
  check('白名单返回 2 个', filtered.length === 2)
  check('含 web_search', filtered.some(t => t.function.name === 'web_search'))
  check('含 web_fetch', filtered.some(t => t.function.name === 'web_fetch'))
  check('不含 file_write', !filtered.some(t => t.function.name === 'file_write'))
}

console.log('\n[3] filterToolSchema — 边界')
{
  check('空白名单返回 0', filterToolSchema(ALL_TOOLS, []).length === 0)
  check('空输入 + all 返回 0', filterToolSchema([], 'all').length === 0)
  check('白名单含不存在的工具名不报错', filterToolSchema(ALL_TOOLS, ['nope']).length === 0)
}

console.log('\n[4] capabilities — chat')
{
  const chat = workModes.find(m => m.value === 'chat')!.capabilities
  check('chat maxRounds = 3', chat.maxRounds === 3)
  check('chat accumulate = false', chat.accumulate === false)
  check('chat allowedTools 是数组', Array.isArray(chat.allowedTools))
  check('chat 白名单 5 个', Array.isArray(chat.allowedTools) && chat.allowedTools.length === 5)
  check('chat 含 web_search', Array.isArray(chat.allowedTools) && chat.allowedTools.includes('web_search'))
  check('chat 含 skill_load', Array.isArray(chat.allowedTools) && chat.allowedTools.includes('skill_load'))
  check('chat 含 skill_read_resource', Array.isArray(chat.allowedTools) && chat.allowedTools.includes('skill_read_resource'))
  check('chat 含 skill_check_deps', Array.isArray(chat.allowedTools) && chat.allowedTools.includes('skill_check_deps'))
  check('chat 不含 file_write', !(Array.isArray(chat.allowedTools) && chat.allowedTools.includes('file_write')))
  check('chat 不含 skill_script_run', !(Array.isArray(chat.allowedTools) && chat.allowedTools.includes('skill_script_run')))
}

console.log('\n[5] capabilities — react / plan')
{
  const react = workModes.find(m => m.value === 'react')!.capabilities
  const plan = workModes.find(m => m.value === 'plan')!.capabilities
  check('react allowedTools = all', react.allowedTools === 'all')
  check('react maxRounds = 100', react.maxRounds === 100)
  check('react accumulate = true', react.accumulate === true)
  check('plan allowedTools = all', plan.allowedTools === 'all')
  check('plan maxRounds = 100', plan.maxRounds === 100)
  check('plan accumulate = true', plan.accumulate === true)
}

console.log('\n')
console.log(`Passed: ${passed}`)
console.log(`Failed: ${failed}`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
}
