/**
 * 总入口：跑所有 skill 相关测试
 * 用法：npm test  或  npx tsx tests/run-all.ts
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const suites = [
  'skills-frontmatter.test.ts',
  'path-safety.test.ts',
  'clawhub-installer.test.ts',
  'skill-runtime.test.ts',
]

let totalFailed = 0
for (const suite of suites) {
  console.log(`\n${'='.repeat(60)}\n  Running: ${suite}\n${'='.repeat(60)}`)
  const result = spawnSync('npx', ['tsx', join(__dirname, suite)], { stdio: 'inherit', shell: true })
  if (result.status !== 0) totalFailed++
}

console.log(`\n${'='.repeat(60)}`)
if (totalFailed === 0) {
  console.log(`✓ 全部 ${suites.length} 个套件通过`)
  process.exit(0)
} else {
  console.log(`✗ ${totalFailed} / ${suites.length} 个套件失败`)
  process.exit(1)
}
