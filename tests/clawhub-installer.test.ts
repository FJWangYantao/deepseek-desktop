/**
 * P1 测试：ClawHub Installer 安全校验与流程。
 *
 * 用法：npx tsx tests/clawhub-installer.test.ts
 *
 * 覆盖：
 *  - 正常 zip 安装 + sha256 双校验 + 文件落盘 + lock/origin
 *  - 整包 sha256 不匹配 → 退化到单文件 fallback
 *  - zip 解压失败（损坏 zip）→ fallback
 *  - 单文件 fallback 也 fail
 *  - zip-slip 路径（../../）→ 拒绝整包
 *  - bundle 超 50MB → 拒绝
 *  - manifest 文件数超 2000 → 拒绝
 *  - 覆盖安装（overwrite=true/false）
 *  - lock.json 读写正确
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { ClawHubClient } from '../electron/skills/clawhub/client'
import { installFromClawHub, uninstallClawHubSkill, listInstalled } from '../electron/skills/clawhub/installer'
import type {
  ClawHubFileEntry,
  ClawHubSkillDetail,
  ClawHubVersionDetail,
} from '../electron/skills/clawhub/types'

// ---- helpers ----

function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(typeof data === 'string' ? Buffer.from(data, 'utf-8') : Buffer.from(data)).digest('hex')
}

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, cond: unknown, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// ---- fixtures ----

interface FakeSkill {
  files: Array<{ path: string; content: string }>
  slug: string
  version: string
  bundleSha256?: string
}

function makeFakeSkill(overrides?: Partial<FakeSkill>): FakeSkill {
  return {
    slug: 'test-skill',
    version: '1.0.0',
    files: [
      { path: 'SKILL.md', content: '---\nname: test-skill\n---\n\n# Test' },
      { path: 'references/guide.md', content: '# Guide\n\nSome reference' },
    ],
    ...overrides,
  }
}

function makeManifest(skill: FakeSkill): ClawHubFileEntry[] {
  return skill.files.map(f => ({
    path: f.path,
    size: Buffer.byteLength(f.content, 'utf-8'),
    sha256: sha256Hex(f.content),
    contentType: f.path.endsWith('.md') ? 'text/markdown' : 'text/plain',
  }))
}

/**
 * 创建采用 jszip 生成的真实压缩包，并返回文件内容映射和整包 hash。
 * 模拟 ClawHub zip 格式，在最外层添加 <slug>/ 前缀目录作为测试。
 */
async function createFakeZipBytes(skill: FakeSkill): Promise<{ bytes: Uint8Array; sha256: string }> {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  for (const f of skill.files) {
    // ClawHub zip 最外层技能名称前缀目录
    zip.file(`${skill.slug}/${f.path}`, f.content)
  }
  const bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
  return { bytes, sha256: sha256Hex(bytes) }
}

/**
 * 创建一个损坏的 zip（字节被篡改）。
 */
async function createCorruptZipBytes(skill: FakeSkill): Promise<Uint8Array> {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  for (const f of skill.files) {
    zip.file(`${skill.slug}/${f.path}`, f.content)
  }
  const bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
  // 篡改最后一个字节
  bytes[bytes.length - 1] ^= 0xff
  return bytes
}

/**
 * 创建 Mock ClawHubClient，返回预置的数据。
 * 用 reset 方法切换各路径的行为。
 */
class MockClawHubClient extends ClawHubClient {
  private skill: FakeSkill
  mockZipBytes: Uint8Array | null = null          // null → zip 下载失败
  mockZipSha256Header: string | undefined = undefined
  mockFallbackFails: boolean = false               // true → 单文件下载也失败
  mockManifestSha256: string | undefined = undefined

  constructor(skill: FakeSkill) {
    super({ baseUrl: 'https://mock.clawhub.test' })
    this.skill = skill
  }

  override async getSkill(_slug: string): Promise<ClawHubSkillDetail> {
    return {
      skill: { slug: this.skill.slug },
      latestVersion: { version: this.skill.version },
    } as ClawHubSkillDetail
  }

  override async getVersion(_slug: string, _version: string): Promise<ClawHubVersionDetail> {
    const files = makeManifest(this.skill)
    const manifestSha = this.mockManifestSha256
    return {
      skill: { slug: this.skill.slug },
      version: {
        version: this.skill.version,
        files,
        security: manifestSha ? { sha256hash: manifestSha, status: 'ok' } : undefined,
      },
    } as ClawHubVersionDetail
  }

  override async downloadZip(_slug: string, _version?: string): Promise<{ bytes: Uint8Array; sha256Header?: string }> {
    if (!this.mockZipBytes) {
      throw new Error('模拟 zip 下载失败')
    }
    return { bytes: this.mockZipBytes, sha256Header: this.mockZipSha256Header }
  }

  override async getFile(_slug: string, path: string, _version?: string): Promise<string> {
    if (this.mockFallbackFails) {
      throw new Error(`模拟单文件下载失败：${path}`)
    }
    const f = this.skill.files.find(f => f.path === path)
    if (!f) throw new Error(`模拟文件不存在：${path}`)
    return f.content
  }
}

// ---- temp dir ----

function makeTempSkillsDir(): string {
  const dir = join(tmpdir(), `clawhub-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanDir(dir: string) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

// ========================================================
// 测试开始
// ========================================================

console.log('\n=== P1: ClawHub Installer 测试 ===\n')

// ===== 1. 正常安装（zip 路径）=====
console.log('\n[1] 正常安装（zip 路径）')
{
  const skillsDir = makeTempSkillsDir()
  try {
    const skill = makeFakeSkill()
    const { bytes, sha256 } = await createFakeZipBytes(skill)
    const client = new MockClawHubClient(skill)
    client.mockZipBytes = bytes
    client.mockZipSha256Header = sha256
    client.mockManifestSha256 = sha256

    const result = await installFromClawHub({ slug: skill.slug, overwrite: true, client, skillsDir })
    check('install 返回 ok', result.ok)
    check('skillId 正确', result.ok && result.skillId === skill.slug)
    check('version 正确', result.ok && result.version === skill.version)
    check('source = zip', result.ok && result.source === 'zip')
    check('filesWritten 正确', result.ok && result.filesWritten === skill.files.length)

    // 检查文件落盘
    const skillDir = join(skillsDir, skill.slug)
    check('SKILL.md 已落盘', existsSync(join(skillDir, 'SKILL.md')))
    check('references/guide.md 已落盘', existsSync(join(skillDir, 'references', 'guide.md')))
    // 检查内容正确
    const readme = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8')
    check('SKILL.md 内容正确', readme === skill.files[0].content)

    // 检查 origin.json
    const originPath = join(skillDir, '.clawhub', 'origin.json')
    check('origin.json 已写入', existsSync(originPath))
    const origin = JSON.parse(readFileSync(originPath, 'utf-8'))
    check('origin.slug 正确', origin.slug === skill.slug)
    check('origin.version 正确', origin.version === skill.version)
    check('origin.registry 正确', origin.registry === 'https://mock.clawhub.test')
    check('origin.source = zip', origin.source === 'zip')
    check('origin.installedAt 是数字', typeof origin.installedAt === 'number')

    // 检查 lock.json
    const lockPath = join(skillsDir, '.clawhub', 'lock.json')
    check('lock.json 已写入', existsSync(lockPath))
    const lock = JSON.parse(readFileSync(lockPath, 'utf-8'))
    check('lock.version = 1', lock.version === 1)
    check('lock.entries 含 test-skill', lock.entries[skill.slug] !== undefined)
    check('lock.entries.slug.version 正确', lock.entries[skill.slug].version === skill.version)
    check('lock.entries.slug.fileCount 正确', lock.entries[skill.slug].fileCount === skill.files.length)
  } finally {
    cleanDir(skillsDir)
  }
}

// ===== 2. 整包 sha256 不匹配 → fallback 到单文件 =====
console.log('\n[2] 整包 sha256 不匹配 → fallback 单文件')
{
  const skillsDir = makeTempSkillsDir()
  try {
    const skill = makeFakeSkill()
    const { bytes } = await createFakeZipBytes(skill)
    const client = new MockClawHubClient(skill)
    client.mockZipBytes = bytes
    // 给一个错误的 sha256 header 触发"不匹配"，让 zip 路径失败
    client.mockZipSha256Header = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    client.mockManifestSha256 = sha256Hex('wrong bundle hash')
    client.mockFallbackFails = false  // fallback 正常

    const result = await installFromClawHub({ slug: skill.slug, overwrite: true, client, skillsDir })
    check('fallback 后仍 ok', result.ok)
    check('source = file-by-file', result.ok && result.source === 'file-by-file')
    check('filesWritten 正确', result.ok && result.filesWritten === skill.files.length)

    // 文件仍然落盘
    const skillDir = join(skillsDir, skill.slug)
    check('fallback 后 SKILL.md 落盘', existsSync(join(skillDir, 'SKILL.md')))
    const origin = JSON.parse(readFileSync(join(skillDir, '.clawhub', 'origin.json'), 'utf-8'))
    check('origin.source = file-by-file', origin.source === 'file-by-file')
  } finally {
    cleanDir(skillsDir)
  }
}

// ===== 3. zip 损坏（解析失败）→ fallback =====
console.log('\n[3] zip 损坏 → fallback 单文件')
{
  const skillsDir = makeTempSkillsDir()
  try {
    const skill = makeFakeSkill()
    const corruptBytes = await createCorruptZipBytes(skill)
    const client = new MockClawHubClient(skill)
    client.mockZipBytes = corruptBytes
    client.mockZipSha256Header = sha256Hex(corruptBytes)
    client.mockManifestSha256 = sha256Hex(corruptBytes)
    client.mockFallbackFails = false

    const result = await installFromClawHub({ slug: skill.slug, overwrite: true, client, skillsDir })
    check('损坏 zip 后 fallback 仍 ok', result.ok)
    check('source = file-by-file', result.ok && result.source === 'file-by-file')
  } finally {
    cleanDir(skillsDir)
  }
}

// ===== 4. zip 损坏 + fallback 也失败 =====
console.log('\n[4] zip 损坏且 fallback 失败')
{
  const skillsDir = makeTempSkillsDir()
  try {
    const skill = makeFakeSkill()
    const corruptBytes = await createCorruptZipBytes(skill)
    const client = new MockClawHubClient(skill)
    client.mockZipBytes = corruptBytes
    client.mockZipSha256Header = sha256Hex(corruptBytes)
    client.mockManifestSha256 = sha256Hex(corruptBytes)
    client.mockFallbackFails = true  // fallback 也失败

    const result = await installFromClawHub({ slug: skill.slug, overwrite: true, client, skillsDir })
    check('整体失败', !result.ok)
    check('有 errorCode', result.errorCode !== undefined)
  } finally {
    cleanDir(skillsDir)
  }
}

// ===== 5. zip-slip 路径 → 拒绝 =====
console.log('\n[5] zip-slip 路径 → 拒绝')
{
  const skillsDir = makeTempSkillsDir()
  try {
    const skill = makeFakeSkill({
      files: [
        { path: 'SKILL.md', content: '---\nname: malicious\n---\n\n# Evil' },
        { path: '../../etc/passwd', content: 'root:x:0:0:root:/root:/bin/bash' },
      ],
    })
    // 创建正常 zip（跳过 JSZip 的 path 限制，因为 JSZip 会 normalize path）
    // 改为直接构造 manifest + 跳过 zip 直接测 manifest 校验
    const client = new MockClawHubClient(skill)
    // 让 zip 下载失败，直接走 manifest 校验
    client.mockZipBytes = null

    // 注意：installer 内部会在 validateManifest 时通过 assertSafeRelativePath('../../etc/passwd') 抛异常
    // 但用于构造 data 时仍然不会走 zip 路径。所以我们需要直接测 manifest 校验。
    const manifest = makeManifest(skill)
    // 用 manifest 控制验证 => utils 层面
    // validateManifest 会调用 assertSafeRelativePath('../../etc/passwd') → throw
    const installResult = await installFromClawHub({ slug: skill.slug, overwrite: true, client, skillsDir })
    check('zip-slip 被拒绝', !installResult.ok)
    check('errorCode = unsafe-path', installResult.errorCode === 'unsafe-path')
  } finally {
    cleanDir(skillsDir)
  }
}

// ===== 6. bundle > 50MB → 拒绝 =====
console.log('\n[6] bundle > 50MB → 拒绝')
{
  const skillsDir = makeTempSkillsDir()
  try {
    const skill = makeFakeSkill({
      files: [
        { path: 'SKILL.md', content: '---\nname: huge\n---\n\n# Huge' },
        { path: 'giant.bin', content: 'x'.repeat(60 * 1024 * 1024) },  // 60MB
      ],
    })
    const client = new MockClawHubClient(skill)
    client.mockZipBytes = null

    const result = await installFromClawHub({ slug: skill.slug, overwrite: true, client, skillsDir })
    check('超大包被拒绝', !result.ok)
    check('errorCode = bundle-too-large', result.errorCode === 'bundle-too-large')
  } finally {
    cleanDir(skillsDir)
  }
}

// ===== 7. 文件数 > 2000 → 拒绝 =====
console.log('\n[7] 文件数 > 2000 → 拒绝')
{
  const skillsDir = makeTempSkillsDir()
  try {
    const manyFiles: Array<{ path: string; content: string }> = []
    for (let i = 0; i < 2001; i++) {
      manyFiles.push({ path: `file-${i}.md`, content: `# File ${i}` })
    }
    const skill = makeFakeSkill({ files: manyFiles })
    const client = new MockClawHubClient(skill)
    client.mockZipBytes = null

    const result = await installFromClawHub({ slug: skill.slug, overwrite: true, client, skillsDir })
    check('超量文件被拒绝', !result.ok)
    check('errorCode = too-many-files', result.errorCode === 'too-many-files')
  } finally {
    cleanDir(skillsDir)
  }
}

// ===== 8. 覆盖策略：已存在且 overwrite=false =====
console.log('\n[8] 覆盖策略：已存在且 overwrite=false')
{
  const skillsDir = makeTempSkillsDir()
  try {
    const skill = makeFakeSkill()
    const { bytes, sha256 } = await createFakeZipBytes(skill)
    const client = new MockClawHubClient(skill)
    client.mockZipBytes = bytes
    client.mockZipSha256Header = sha256
    client.mockManifestSha256 = sha256

    // 第一次安装
    const first = await installFromClawHub({ slug: skill.slug, overwrite: true, client, skillsDir })
    check('第一次安装 ok', first.ok)

    // 第二次不指定 overwrite
    const second = await installFromClawHub({ slug: skill.slug, client, skillsDir })
    check('第二次不传 overwrite 被拒绝', !second.ok)
    check('errorCode = already-installed', second.errorCode === 'already-installed')

    // 第三次指定 overwrite=true
    const third = await installFromClawHub({ slug: skill.slug, overwrite: true, client, skillsDir })
    check('overwrite=true 再次安装 ok', third.ok)
  } finally {
    cleanDir(skillsDir)
  }
}

// ===== 9. uninstall =====
console.log('\n[9] uninstall')
{
  const skillsDir = makeTempSkillsDir()
  try {
    const skill = makeFakeSkill()
    const { bytes, sha256 } = await createFakeZipBytes(skill)
    const client = new MockClawHubClient(skill)
    client.mockZipBytes = bytes
    client.mockZipSha256Header = sha256
    client.mockManifestSha256 = sha256

    await installFromClawHub({ slug: skill.slug, overwrite: true, client, skillsDir })
    check('安装后目录存在', existsSync(join(skillsDir, skill.slug)))

    const uninstalled = uninstallClawHubSkill(skillsDir, skill.slug)
    check('uninstall 返回 true', uninstalled)
    check('uninstall 后目录已删除', !existsSync(join(skillsDir, skill.slug)))

    const lock = listInstalled(skillsDir)
    check('lock 中已移除', lock.entries[skill.slug] === undefined)

    // 重复卸载返回 false
    const again = uninstallClawHubSkill(skillsDir, skill.slug)
    check('重复卸载返回 false', !again)
  } finally {
    cleanDir(skillsDir)
  }
}

// ===== 10. listInstalled =====
console.log('\n[10] listInstalled')
{
  const skillsDir = makeTempSkillsDir()
  try {
    const skill1 = makeFakeSkill({ slug: 'skill-a', version: '1.0.0' })
    const skill2 = makeFakeSkill({ slug: 'skill-b', version: '2.0.0' })
    const z1 = await createFakeZipBytes(skill1)
    const z2 = await createFakeZipBytes(skill2)

    const c1 = new MockClawHubClient(skill1); c1.mockZipBytes = z1.bytes; c1.mockZipSha256Header = z1.sha256; c1.mockManifestSha256 = z1.sha256
    const c2 = new MockClawHubClient(skill2); c2.mockZipBytes = z2.bytes; c2.mockZipSha256Header = z2.sha256; c2.mockManifestSha256 = z2.sha256

    await installFromClawHub({ slug: 'skill-a', overwrite: true, client: c1, skillsDir })
    await installFromClawHub({ slug: 'skill-b', overwrite: true, client: c2, skillsDir })

    const lock = listInstalled(skillsDir)
    check('lock 含 2 个 skill', Object.keys(lock.entries).length === 2)
    check('skill-a 在 lock 中', lock.entries['skill-a'] !== undefined)
    check('skill-b 在 lock 中', lock.entries['skill-b'] !== undefined)
    check('skill-a 版本正确', lock.entries['skill-a'].version === '1.0.0')
    check('skill-b 版本正确', lock.entries['skill-b'].version === '2.0.0')
  } finally {
    cleanDir(skillsDir)
  }
}

// ===== 11. 单文件 fallback 触发 large-file 拒绝 =====
console.log('\n[11] fallback blocked by >200KB file')
{
  const skillsDir = makeTempSkillsDir()
  try {
    // 创建一个包含超大文件的 skill，让 zip 失败后 fallback 无法处理它
    const skill = makeFakeSkill({
      files: [
        { path: 'SKILL.md', content: '---\nname: big-file\n---\n\n# Big' },
        { path: 'huge.json', content: '[' + '"x",'.repeat(100_000) + '"end"]' },  // ~700KB
      ],
    })
    // 让 zip 下载失败
    const client = new MockClawHubClient(skill)
    client.mockZipBytes = null

    const result = await installFromClawHub({ slug: skill.slug, overwrite: true, client, skillsDir })
    check('fallback 因大文件被阻塞', !result.ok)
    check('errorCode = fallback-blocked-by-large-file', result.errorCode === 'fallback-blocked-by-large-file')
  } finally {
    cleanDir(skillsDir)
  }
}

// ===== 12. 不合法 slug → 提前拒绝 =====
console.log('\n[12] 不合法 slug → 提前拒绝')
{
  const skillsDir = makeTempSkillsDir()
  try {
    const result = await installFromClawHub({ slug: 'Invalid Slug!!!', client: new ClawHubClient({ baseUrl: 'https://mock.test' }), skillsDir })
    check('不合法 slug 被拒绝', !result.ok)
    check('errorCode = invalid-slug', result.errorCode === 'invalid-slug')
  } finally {
    cleanDir(skillsDir)
  }
}

// ========================================================
console.log('\n')
console.log(`Passed: ${passed}`)
console.log(`Failed: ${failed}`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
}