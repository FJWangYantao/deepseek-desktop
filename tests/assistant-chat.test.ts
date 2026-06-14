/**
 * 划词助手对话模式测试 — trimHistory 纯函数。
 * 用法：npx tsx tests/assistant-chat.test.ts
 */
import { trimHistory } from '../src/composables/assistantChat/trimHistory'

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, cond: unknown, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

const mk = (role: 'user' | 'assistant', i: number) => ({ role, content: `m${i}` })

console.log('\n[1] trimHistory — 未超限原样返回')
{
  const arr = [mk('user', 1), mk('assistant', 2)]
  const out = trimHistory(arr, 20)
  check('长度 2 未超 20，返回原数组', out.length === 2)
  check('返回同引用（未超时不新建）', out === arr)
  check('首元素仍是 m1', out[0].content === 'm1')
}

console.log('\n[2] trimHistory — 超限丢弃最早')
{
  // 造 25 条
  const arr = Array.from({ length: 25 }, (_, i) => mk(i % 2 === 0 ? 'user' : 'assistant', i + 1))
  const out = trimHistory(arr, 20)
  check('25 条裁到 20', out.length === 20)
  check('保留最近的（丢弃最早 5 条）', out[0].content === 'm6')
  check('末尾仍是最后一条 m25', out[out.length - 1].content === 'm25')
}

console.log('\n[3] trimHistory — 恰好等于上限')
{
  const arr = Array.from({ length: 20 }, (_, i) => mk('user', i + 1))
  const out = trimHistory(arr, 20)
  check('20 条等于上限 20，原样返回', out.length === 20)
  check('同引用（未新建数组）', out === arr)
}

console.log('\n[4] trimHistory — 默认上限 MAX_HISTORY=20')
{
  const arr = Array.from({ length: 22 }, (_, i) => mk('user', i + 1))
  const out = trimHistory(arr) // 不传 max
  check('不传 max 时默认 20，22 裁到 20', out.length === 20)
  check('保留 m3..m22', out[0].content === 'm3' && out[19].content === 'm22')
}

console.log('\n[5] trimHistory — 边界：空数组与单元素')
{
  const empty: { role: string }[] = []
  const out = trimHistory(empty, 5)
  check('空数组原样返回（同引用）', out === empty && out.length === 0)
  const one = [mk('user', 1)]
  check('单元素未超返回同引用', trimHistory(one, 5) === one)
}

console.log('\n[6] trimHistory — system 不在历史里（由调用方组装）')
{
  // 验证裁剪只动 user/assistant：助手对话历史本就不含 system，
  // 但函数签名是泛型 role:string，确保不会因角色而误删
  const arr = [
    { role: 'system', content: 'sys' },
    ...Array.from({ length: 20 }, (_, i) => mk('user', i + 1)),
  ]
  const out = trimHistory(arr, 20)
  check('含 1 system + 20 user 共 21 条，裁到 20', out.length === 20)
  // 注：trimHistory 是简单 slice，不区分角色；助手对话历史不含 system，此处仅验证数量行为
}

console.log('\n')
console.log(`Passed: ${passed}`)
console.log(`Failed: ${failed}`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
}
