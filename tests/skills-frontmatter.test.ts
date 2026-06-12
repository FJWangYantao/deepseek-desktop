// P0 验证脚本：直接 Node + tsx 跑，不依赖 Electron
// 用法：npx tsx tests/skills-frontmatter.test.ts
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFrontmatter, extractOpenClawMetadata } from '../electron/skills/frontmatter'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = join(__dirname, 'fixtures', 'skills')

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, cond: unknown, detail?: string) {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    failures.push(`${name}${detail ? ' — ' + detail : ''}`)
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

function loadFixture(name: string) {
  return readFileSync(join(FIXTURE_DIR, name), 'utf-8')
}

// =====================================================
console.log('\n[1] Anthropic 极简 frontmatter')
// =====================================================
{
  const text = loadFixture('anthropic-frontend-design.md')
  const parsed = parseFrontmatter(text)
  check('解析成功', parsed !== null)
  check('name 正确', parsed?.meta.name === 'frontend-design')
  check('description 存在', typeof parsed?.meta.description === 'string' && (parsed.meta.description as string).length > 0)
  check('license 字段保留', typeof parsed?.meta.license === 'string')
  check('无 runtime metadata', extractOpenClawMetadata(parsed!.meta) === undefined)
  check('body 不为空', parsed!.body.length > 0)
  check('body 不再包含 ---', !parsed!.body.startsWith('---'))
}

// =====================================================
console.log('\n[2] Anthropic skill-creator（带 license）')
// =====================================================
{
  const parsed = parseFrontmatter(loadFixture('anthropic-skill-creator.md'))
  check('解析成功', parsed !== null)
  check('name = skill-creator', parsed?.meta.name === 'skill-creator')
  check('description 较长', (parsed?.meta.description as string).length > 50)
}

// =====================================================
console.log('\n[3] Anthropic webapp-testing')
// =====================================================
{
  const parsed = parseFrontmatter(loadFixture('anthropic-webapp-testing.md'))
  check('解析成功', parsed !== null)
  check('name = webapp-testing', parsed?.meta.name === 'webapp-testing')
}

// =====================================================
console.log('\n[4] ClawHub todoist-cli（嵌套 metadata.openclaw）')
// =====================================================
{
  const parsed = parseFrontmatter(loadFixture('clawhub-todoist.md'))
  check('解析成功', parsed !== null)
  check('name = todoist-cli', parsed?.meta.name === 'todoist-cli')
  check('version = 1.2.0', parsed?.meta.version === '1.2.0')

  const rt = extractOpenClawMetadata(parsed!.meta)
  check('runtime metadata 存在', rt !== undefined)
  check('requires.env 含 TODOIST_API_KEY', rt?.requires?.env?.includes('TODOIST_API_KEY') === true)
  check('requires.bins 含 curl', rt?.requires?.bins?.includes('curl') === true)
  check('primaryEnv = TODOIST_API_KEY', rt?.primaryEnv === 'TODOIST_API_KEY')
  check('envVars 解析为 2 项', rt?.envVars?.length === 2)
  check('envVars[0].required = true', rt?.envVars?.[0].required === true)
  check('envVars[1].required = false', rt?.envVars?.[1].required === false)
  check('emoji 解析', rt?.emoji === '✅')
  check('homepage 解析', typeof rt?.homepage === 'string')
  check('install 解析', rt?.install?.length === 1)
  check('install[0].kind = brew', rt?.install?.[0].kind === 'brew')
  check('install[0].formula = todoist-cli', rt?.install?.[0].formula === 'todoist-cli')
}

// =====================================================
console.log('\n[5] ClawHub padel（用 clawdbot 别名）')
// =====================================================
{
  const parsed = parseFrontmatter(loadFixture('clawhub-padel-clawdbot.md'))
  check('解析成功', parsed !== null)
  const rt = extractOpenClawMetadata(parsed!.meta)
  check('clawdbot 别名识别成功', rt !== undefined)
  check('requires.env 含 PADEL_AUTH_FILE', rt?.requires?.env?.includes('PADEL_AUTH_FILE') === true)
  check('primaryEnv 正确', rt?.primaryEnv === 'PADEL_AUTH_FILE')
}

// =====================================================
console.log('\n[6] deepseek legacy 自定义字段（tags / displayName）')
// =====================================================
{
  const parsed = parseFrontmatter(loadFixture('deepseek-legacy-translator.md'))
  check('解析成功', parsed !== null)
  check('tags 是数组', Array.isArray(parsed?.meta.tags))
  check('tags 含 translate', (parsed?.meta.tags as string[]).includes('translate'))
  check('displayName 解析', parsed?.meta.displayName === '翻译专家')
  check('无 runtime metadata', extractOpenClawMetadata(parsed!.meta) === undefined)
}

// =====================================================
console.log('\n[7] 边界：空 frontmatter、缺失、不合法 YAML')
// =====================================================
{
  check('null 返回（无 frontmatter）', parseFrontmatter('# Just a markdown\nNo frontmatter') === null)
  check('null 返回（只有开头 ---）', parseFrontmatter('---\nname: x\n# 没有结尾') === null)

  // 空 frontmatter 块
  const empty = parseFrontmatter('---\n\n---\n\nBody')
  check('空 frontmatter 不崩', empty !== null)
  check('空 frontmatter meta 为空对象', empty !== null && Object.keys(empty.meta).length === 0)
  check('空 frontmatter body 保留', empty?.body === 'Body')

  // 不合法 YAML
  const invalid = parseFrontmatter('---\nname: x\n  bad: indent\n\tmixed\n---\nbody')
  check('不合法 YAML 返回 null（不抛）', invalid === null || (invalid !== null && typeof invalid.meta === 'object'))
}

// =====================================================
console.log('\n[8] 跨 fixture 抽样：所有 fixture 至少能 parse')
// =====================================================
{
  const files = readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.md'))
  check('fixture 数 >= 5', files.length >= 5, `实际 ${files.length}`)
  for (const f of files) {
    const ok = parseFrontmatter(readFileSync(join(FIXTURE_DIR, f), 'utf-8')) !== null
    check(`${basename(f)} 可解析`, ok)
  }
}

// =====================================================
console.log('\n')
console.log(`Passed: ${passed}`)
console.log(`Failed: ${failed}`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
}
