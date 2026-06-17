/**
 * 搜索 benchmark 自检（offline、秒级、不依赖网络）。
 *
 * 用一份冻结的 fixture（fixtures/selftest.json，进 git）当测试数据，验证：
 *  1. judge 链路对固定输入确定性输出（同 raw 跑两次，scores deepEqual）
 *     —— 抓"被引入了随机性 / 副作用"的回归
 *  2. 所有分数落在 [0,1]
 *  3. fixture 序列化往返无损（save → load → deepEqual）
 *  4. 回归锚点：def-3 recall === 0 —— 验证 #2（recall 剔除 query 自身的词后，
 *     只看答案信号词 annealing；这份 fixture 里 annealing 未命中）
 *
 * 锚点 4 绑定当前 fixture 快照；若重新 --save-fixture=selftest（raw 会漂），需复核。
 *
 * 跑：npm run bench:selftest
 */
import { fileURLToPath } from 'node:url'
import { rmSync } from 'node:fs'
import { runCase, loadFixture, saveFixture } from './runner'
import { cases } from './cases'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

;(async () => {
  let pass = true
  const check = (name: string, ok: boolean, detail = '') => {
    console.log(`${ok ? '✓' : '✗ FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
    if (!ok) pass = false
  }

  const fixture = loadFixture('selftest')
  const testCases = cases.filter(c => fixture.has(c.id))
  console.log(`自检 ${testCases.length} 个 case（fixture=selftest.json，离线零网络）\n`)

  // 1) 确定性 + 2) 分数范围 + 4) def-3 回归锚点
  for (const c of testCases) {
    const raw = fixture.get(c.id)!.raw
    const a = await runCase(c, raw, { useLLM: false, start: 0 })
    const b = await runCase(c, raw, { useLLM: false, start: 0 })
    check(`${c.id} 确定性（同 raw 跑两次 scores 相等）`, JSON.stringify(a.scores) === JSON.stringify(b.scores))

    const s = a.scores
    const vals = [s.noise, s.diversity, s.richness, s.overall]
    if (s.recall !== null) vals.push(s.recall)
    if (s.forbidden !== null) vals.push(s.forbidden)
    check(`${c.id} 分数 ∈ [0,1]`, vals.every(v => v >= 0 && v <= 1),
      `overall=${(s.overall * 100).toFixed(0)}% recall=${s.recall === null ? 'null' : (s.recall * 100).toFixed(0) + '%'}`)

    if (c.id === 'def-3') {
      check(`def-3 回归锚点 recall===0（#2 剔除 query 词后只看 annealing）`,
        s.recall === 0, `实际=${s.recall}`)
    }
  }

  // 3) fixture 序列化往返无损
  const original = Object.fromEntries(fixture)
  saveFixture('selftest-rt', { version: 1, generatedAt: 'rt', cases: original })
  const reloaded = Object.fromEntries(loadFixture('selftest-rt'))
  check('fixture 往返无损（save→load→deepEqual）', JSON.stringify(original) === JSON.stringify(reloaded))
  rmSync(`${__dirname}fixtures/selftest-rt.json`, { force: true })

  console.log(pass ? '\n✓ 自检全部通过' : '\n✗ 自检失败')
  process.exit(pass ? 0 : 1)
})()
