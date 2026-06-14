/**
 * Markdown 渲染器 — extractMath 纯函数测试（公式提取）。
 * 用法：npx tsx tests/markdown-math.test.ts
 *
 * 只测 extractMath（仅依赖 katex，可在 node 跑）；
 * renderMarkdown 依赖 DOMPurify（需 DOM），由界面人工验证。
 */
import { extractMath } from '../src/composables/useMath'

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, cond: unknown, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

console.log('\n[1] $...$ 行内公式')
{
  const r = extractMath("微分方程 $y'' - 4y = e^{2x}$ 的通解")
  check('提取 1 个公式', r.blocks.length === 1)
  check('文本含占位符', /\x00M0\x00/.test(r.text))
  check('原 $ 已移除', !/\$/.test(r.text))
  check('blocks 是 katex HTML', r.blocks[0].includes('katex'))

  const r2 = extractMath('$\\tan x$ 与 $\\dfrac{9}{16}$')
  check('两个公式都提取', r2.blocks.length === 2)
  check('顺序保持（第一个含 tan）', r2.blocks[0].includes('tan'))
}

console.log('\n[2] $...$ 不误判价格 / 裸美元')
{
  check('单美元 $5 不提取', extractMath('价格 $5').blocks.length === 0)
  check('夹数字 $5 得 $6 不提取', extractMath('花 $5 得 $6').blocks.length === 0)
  check('贴空白 $ x $ 不提取', extractMath('$ x $').blocks.length === 0)
  check('无公式纯文本', extractMath('今天天气不错').blocks.length === 0)
}

console.log('\n[3] $$ / \\[ \\] / \\( \\) 仍正常')
{
  check('$$ display 提取', extractMath('$$a^2+b^2$$').blocks.length === 1)
  check('$$ 优先于 $（不误拆）', extractMath('$$x$$ 和 $y$').blocks.length === 2)
  check('\\[ \\] 提取', extractMath('\\[a+b\\]').blocks.length === 1)
  check('\\( \\) 提取', extractMath('含 \\(a+b\\) 行内').blocks.length === 1)
}

console.log('\n[4] 用户样例（1999 考研数学）')
{
  const sample = "（3）微分方程 $y'' - 4y = e^{2x}$ 的通解为 $y =$ ___"
  const r = extractMath(sample)
  check('样例两个公式都提取', r.blocks.length === 2)
  check('占位符数量匹配', (r.text.match(/\x00M\d+\x00/g) || []).length === 2)
  check('剩余文本仍含汉字', /微分方程/.test(r.text))
}

console.log('\n[5] 占位符可还原（不丢公式）')
{
  const r = extractMath('$\\mathbf{A}$ 的特征值')
  const restored = r.text.replace(/\x00M(\d+)\x00/g, (_, i) => r.blocks[+i])
  check('还原后含 katex HTML', restored.includes('katex'))
  check('还原后不含原 $', !/\$/.test(restored))
}

console.log(`\n${'='.repeat(60)}`)
if (failed === 0) {
  console.log(`✓ 全部 ${passed} 项通过`)
  process.exit(0)
} else {
  console.log(`✗ ${failed} 项失败:`)
  failures.forEach(f => console.log(`  - ${f}`))
  process.exit(1)
}
