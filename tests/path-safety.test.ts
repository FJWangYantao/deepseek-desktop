/**
 * path-safety 测试：覆盖 zip-slip / 绝对路径 / Windows drive / UNC。
 * 用法：npx tsx tests/path-safety.test.ts
 */
import { assertSafeRelativePath, isInsidePath, isValidSkillId, safeJoin, slugifySkillId } from '../electron/skills/path-safety'

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, cond: unknown, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

function shouldThrow(fn: () => unknown): boolean {
  try { fn(); return false } catch { return true }
}

console.log('\n[1] assertSafeRelativePath - 合法路径')
{
  check('SKILL.md 通过', assertSafeRelativePath('SKILL.md') === 'SKILL.md')
  check('references/x.md 通过', assertSafeRelativePath('references/x.md') === 'references/x.md')
  check('反斜杠转正斜杠', assertSafeRelativePath('references\\x.md') === 'references/x.md')
  check('./x.md 去掉前缀', assertSafeRelativePath('./x.md') === 'x.md')
  check('深嵌套通过', assertSafeRelativePath('a/b/c/d/e.md') === 'a/b/c/d/e.md')
}

console.log('\n[2] assertSafeRelativePath - zip-slip 与绝对路径')
{
  check('../x 抛异常', shouldThrow(() => assertSafeRelativePath('../x')))
  check('../../x 抛异常', shouldThrow(() => assertSafeRelativePath('../../x')))
  check('a/../../../x 抛异常', shouldThrow(() => assertSafeRelativePath('a/../../../x')))
  check('/etc/passwd 抛异常', shouldThrow(() => assertSafeRelativePath('/etc/passwd')))
  check('C:/Windows 抛异常', shouldThrow(() => assertSafeRelativePath('C:/Windows')))
  check('c:\\windows 抛异常', shouldThrow(() => assertSafeRelativePath('c:\\windows')))
  check('D:/users 抛异常', shouldThrow(() => assertSafeRelativePath('D:/users')))
  check('空字符串抛异常', shouldThrow(() => assertSafeRelativePath('')))
}

console.log('\n[3] safeJoin - 越界拒绝')
{
  const root = '/tmp/skill-test'
  check('正常 join', safeJoin(root, 'a.md').includes('a.md'))
  check('深嵌套 join', safeJoin(root, 'a/b/c.md').includes('c.md'))
  check('../ 越界抛异常', shouldThrow(() => safeJoin(root, '../x')))
  check('绝对路径抛异常', shouldThrow(() => safeJoin(root, '/etc/x')))
}

console.log('\n[4] isInsidePath')
{
  check('子目录 = true', isInsidePath('/tmp/a', '/tmp/a/b/c'))
  check('同一目录 = true', isInsidePath('/tmp/a', '/tmp/a'))
  check('兄弟目录 = false', !isInsidePath('/tmp/a', '/tmp/b'))
  check('父目录 = false', !isInsidePath('/tmp/a/b', '/tmp/a'))
}

console.log('\n[5] isValidSkillId')
{
  check('todoist-cli ok', isValidSkillId('todoist-cli'))
  check('a ok', isValidSkillId('a'))
  check('a1-b2-c3 ok', isValidSkillId('a1-b2-c3'))
  check('大写拒绝', !isValidSkillId('TodoistCli'))
  check('下划线拒绝', !isValidSkillId('todoist_cli'))
  check('空格拒绝', !isValidSkillId('todoist cli'))
  check('开头连字符拒绝', !isValidSkillId('-todo'))
  check('结尾连字符拒绝', !isValidSkillId('todo-'))
  check('连续连字符拒绝', !isValidSkillId('to--do'))
  check('点号拒绝', !isValidSkillId('a.b'))
  check('斜杠拒绝', !isValidSkillId('a/b'))
}

console.log('\n[6] slugifySkillId')
{
  check('Hello World → hello-world', slugifySkillId('Hello World') === 'hello-world')
  check('Foo  Bar → foo-bar', slugifySkillId('Foo  Bar') === 'foo-bar')
  check('---a--- → a', slugifySkillId('---a---') === 'a')
  check('中文 → 时间戳兜底', /^[a-z0-9]/.test(slugifySkillId('中文中文')))
  check('Foo_Bar! → foo-bar', slugifySkillId('Foo_Bar!') === 'foo-bar')
}

console.log('\n')
console.log(`Passed: ${passed}`)
console.log(`Failed: ${failed}`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
}
