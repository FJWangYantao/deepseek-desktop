/**
 * ClawHub Skill Installer
 *
 * 流程：
 *  1. 拿 version manifest（含 files 数组，每个带 sha256）
 *  2. 主路径：下载整包 zip
 *     - 整包 sha256 双校验（响应头 vs version.security.sha256hash）
 *     - jszip 解压
 *     - 对照 manifest 校验每个文件的 sha256
 *  3. fallback：zip 失败 → 按 manifest 逐文件 fetch；逐个 sha256 校验
 *  4. 安全校验通过后，all-or-nothing 写入：先写临时目录，全部 OK 再原子搬到目标
 *  5. 写 <slug>/.clawhub/origin.json 与全局 lock.json
 *
 * 不执行任何东西。
 */

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  renameSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

import { assertSafeRelativePath, isValidSkillId } from '../path-safety'
import { ClawHubClient } from './client'
import type {
  ClawHubFileEntry,
  ClawHubInstallResult,
  ClawHubLock,
  ClawHubOrigin,
  ClawHubVersionDetail,
} from './types'

const MAX_BUNDLE_SIZE = 50 * 1024 * 1024   // 50MB，与 service.ts 对齐
const MAX_FILES = 2000                     // 防 zip-bomb：单包文件数硬上限
const SINGLE_FILE_HTTP_LIMIT = 200 * 1024  // ClawHub 单文件端点硬限制

// installer 自己不引入新依赖，复用 jszip（项目已用于 PPTX 解析）
async function loadJSZip() {
  const mod = await import('jszip')
  return mod.default
}

function sha256Hex(bytes: Uint8Array | string): string {
  const buf = typeof bytes === 'string' ? Buffer.from(bytes, 'utf-8') : Buffer.from(bytes)
  return createHash('sha256').update(buf).digest('hex')
}

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
}

/**
 * 校验 manifest 自身的健全性：
 *  - 文件数不超 MAX_FILES
 *  - 总大小不超 MAX_BUNDLE_SIZE
 *  - 每个 path 通过 zip-slip 防御
 *  - 每个 sha256 是合法 64 位 hex
 */
function validateManifest(files: ClawHubFileEntry[]): { ok: true; totalSize: number } | { ok: false; code: string; error: string } {
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, code: 'empty-manifest', error: 'version manifest 没有任何文件' }
  }
  if (files.length > MAX_FILES) {
    return { ok: false, code: 'too-many-files', error: `Skill 文件数 ${files.length} 超过 ${MAX_FILES} 上限` }
  }
  let total = 0
  for (const f of files) {
    if (typeof f.path !== 'string' || typeof f.size !== 'number' || typeof f.sha256 !== 'string') {
      return { ok: false, code: 'malformed-manifest', error: `文件条目不合法：${JSON.stringify(f)}` }
    }
    if (f.size < 0 || !Number.isFinite(f.size)) {
      return { ok: false, code: 'malformed-manifest', error: `非法 size：${f.size}` }
    }
    if (!/^[a-f0-9]{64}$/i.test(f.sha256)) {
      return { ok: false, code: 'malformed-manifest', error: `非法 sha256：${f.sha256}` }
    }
    try {
      assertSafeRelativePath(f.path)
    } catch (err) {
      return { ok: false, code: 'unsafe-path', error: `不安全的文件路径 "${f.path}"：${err instanceof Error ? err.message : err}` }
    }
    total += f.size
    if (total > MAX_BUNDLE_SIZE) {
      return { ok: false, code: 'bundle-too-large', error: `Skill 包总大小 ${total} 超过 ${MAX_BUNDLE_SIZE} 上限` }
    }
  }
  return { ok: true, totalSize: total }
}

/**
 * 走 zip 主路径，把 zip 字节解开成 path → bytes 的映射。
 * 校验：整包 sha256 + 每个文件 sha256 对照 manifest。
 */
async function extractAndVerifyZip(
  zipBytes: Uint8Array,
  manifest: ClawHubFileEntry[],
  zipSha256Header: string | undefined,
  manifestZipSha256: string | undefined,
): Promise<{ ok: true; files: Map<string, Uint8Array> } | { ok: false; code: string; error: string }> {
  // 1. 整包 sha256：先信赖响应头；与 manifest 提供的整包 hash 比对
  const actualZipSha = sha256Hex(zipBytes)
  const expectedSources: string[] = []
  if (zipSha256Header) expectedSources.push(zipSha256Header.toLowerCase())
  if (manifestZipSha256) expectedSources.push(manifestZipSha256.toLowerCase())
  for (const expected of expectedSources) {
    if (expected !== actualZipSha) {
      return { ok: false, code: 'zip-sha256-mismatch', error: `整包 sha256 不匹配：expected ${expected} got ${actualZipSha}` }
    }
  }

  // 2. 解压
  let zip
  try {
    const JSZip = await loadJSZip()
    zip = await JSZip.loadAsync(zipBytes)
  } catch (err) {
    return { ok: false, code: 'zip-corrupt', error: `zip 解析失败：${err instanceof Error ? err.message : err}` }
  }

  // 探测公共顶层前缀：ClawHub 的 zip 通常把所有文件包在 `<slug>/` 下。
  // 找到顶层目录后，所有 manifest path 都加这个前缀去 zip 查找。
  let commonPrefix = ''
  const topLevelDirs = new Set<string>()
  let hasTopLevelFile = false
  for (const name of Object.keys(zip.files)) {
    if (name.endsWith('/')) continue
    const firstSlash = name.indexOf('/')
    if (firstSlash <= 0) {
      hasTopLevelFile = true
      break
    }
    topLevelDirs.add(name.slice(0, firstSlash))
  }
  if (!hasTopLevelFile && topLevelDirs.size === 1) {
    commonPrefix = `${[...topLevelDirs][0]}/`
  }

  // 3. 对 manifest 中每一项，从 zip 取出并验 sha256
  const result = new Map<string, Uint8Array>()
  for (const entry of manifest) {
    const safeRel = assertSafeRelativePath(entry.path)
    const zipEntry = zip.file(safeRel) ?? (commonPrefix ? zip.file(`${commonPrefix}${safeRel}`) : null)
    if (!zipEntry) {
      return { ok: false, code: 'zip-missing-file', error: `zip 中缺失 manifest 声明的文件：${safeRel}` }
    }
    const bytes = new Uint8Array(await zipEntry.async('uint8array'))
    const actual = sha256Hex(bytes)
    if (actual !== entry.sha256.toLowerCase()) {
      return { ok: false, code: 'file-sha256-mismatch', error: `文件 ${safeRel} sha256 不匹配` }
    }
    if (bytes.length !== entry.size) {
      return { ok: false, code: 'file-size-mismatch', error: `文件 ${safeRel} 大小不匹配：expected ${entry.size} got ${bytes.length}` }
    }
    result.set(safeRel, bytes)
  }
  return { ok: true, files: result }
}

/** fallback：逐文件下载 + 校验。registry 端点本身只允许文本类。 */
async function fetchAndVerifyByFile(
  client: ClawHubClient,
  slug: string,
  version: string,
  manifest: ClawHubFileEntry[],
): Promise<{ ok: true; files: Map<string, Uint8Array> } | { ok: false; code: string; error: string }> {
  const result = new Map<string, Uint8Array>()
  for (const entry of manifest) {
    if (entry.size > SINGLE_FILE_HTTP_LIMIT) {
      return { ok: false, code: 'file-too-large-for-fallback', error: `文件 ${entry.path} 大小 ${entry.size} 超过单文件端点 200KB 上限，无法走 fallback` }
    }
    const safeRel = assertSafeRelativePath(entry.path)
    let text: string
    try {
      text = await client.getFile(slug, safeRel, version)
    } catch (err) {
      return { ok: false, code: 'file-fetch-failed', error: err instanceof Error ? err.message : String(err) }
    }
    const bytes = new Uint8Array(Buffer.from(text, 'utf-8'))
    const actual = sha256Hex(bytes)
    if (actual !== entry.sha256.toLowerCase()) {
      return { ok: false, code: 'file-sha256-mismatch', error: `文件 ${safeRel} sha256 不匹配（fallback 路径）` }
    }
    result.set(safeRel, bytes)
  }
  return { ok: true, files: result }
}

function writeOrigin(skillDir: string, origin: ClawHubOrigin) {
  const dir = join(skillDir, '.clawhub')
  ensureDir(dir)
  writeFileSync(join(dir, 'origin.json'), JSON.stringify(origin, null, 2), 'utf-8')
}

function loadLock(skillsDir: string): ClawHubLock {
  const path = join(skillsDir, '.clawhub', 'lock.json')
  if (!existsSync(path)) return { version: 1, entries: {} }
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    if (data && typeof data === 'object' && data.version === 1 && data.entries && typeof data.entries === 'object') {
      return data as ClawHubLock
    }
  } catch { /* ignore, fall through to fresh lock */ }
  return { version: 1, entries: {} }
}

function saveLock(skillsDir: string, lock: ClawHubLock) {
  const dir = join(skillsDir, '.clawhub')
  ensureDir(dir)
  writeFileSync(join(dir, 'lock.json'), JSON.stringify(lock, null, 2), 'utf-8')
}

/**
 * 把 files map 全量写到 targetDir 下；写之前清空 targetDir（如果存在）。
 * 调用前已经做过 sha256/path 校验，这里只需要按 path 落盘。
 */
function flushFilesToDir(targetDir: string, files: Map<string, Uint8Array>) {
  if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true })
  ensureDir(targetDir)
  for (const [rel, bytes] of files) {
    const safeRel = assertSafeRelativePath(rel)
    const full = join(targetDir, safeRel)
    ensureDir(dirname(full))
    writeFileSync(full, Buffer.from(bytes))
  }
}

export interface InstallOptions {
  slug: string
  /** 不指定则取 latest */
  version?: string
  /** 已存在同 slug：true 则覆盖，false 则报错。默认 false。 */
  overwrite?: boolean
  /** 不走网络时的注入点，用于测试 */
  client?: ClawHubClient
  /** 注入的 skills 根目录 */
  skillsDir: string
}

/** 主入口：从 ClawHub 安装一个 Skill。 */
export async function installFromClawHub(opts: InstallOptions): Promise<ClawHubInstallResult> {
  const client = opts.client ?? new ClawHubClient()
  const slug = opts.slug

  if (!isValidSkillId(slug)) {
    return { ok: false, errorCode: 'invalid-slug', error: `非法的 Skill slug：${slug}` }
  }

  // 1. 解析版本（不指定就取 latest）
  let resolvedVersion: string | undefined = opts.version
  let manifestZipSha256: string | undefined
  let detail: ClawHubVersionDetail
  try {
    if (!resolvedVersion) {
      const meta = await client.getSkill(slug)
      resolvedVersion = meta.latestVersion?.version ?? meta.skill?.tags?.latest
      if (!resolvedVersion) return { ok: false, errorCode: 'no-version', error: `无法确定 ${slug} 的 latest 版本` }
    }
    detail = await client.getVersion(slug, resolvedVersion)
    manifestZipSha256 = detail.version.security?.sha256hash
  } catch (err) {
    return { ok: false, errorCode: 'manifest-fetch-failed', error: err instanceof Error ? err.message : String(err) }
  }
  const version = resolvedVersion

  // 2. 校验 manifest 自身
  const manifest = detail.version.files
  const manifestCheck = validateManifest(manifest)
  if (!manifestCheck.ok) return { ok: false, errorCode: manifestCheck.code, error: manifestCheck.error }

  // 3. 检查覆盖策略
  const targetDir = join(opts.skillsDir, slug)
  if (existsSync(targetDir) && !opts.overwrite) {
    return { ok: false, errorCode: 'already-installed', error: `${slug} 已存在，未指定 overwrite=true` }
  }
  // 同样要保护 legacy 同 id 文件
  if (existsSync(join(opts.skillsDir, `${slug}.md`)) && !opts.overwrite) {
    return { ok: false, errorCode: 'legacy-conflict', error: `${slug}.md 已存在为 legacy Skill，未指定 overwrite=true` }
  }

  // 4. 主路径：zip
  let files: Map<string, Uint8Array> | null = null
  let source: 'zip' | 'file-by-file' = 'zip'
  let zipHeaderSha: string | undefined

  try {
    const { bytes, sha256Header } = await client.downloadZip(slug, version)
    zipHeaderSha = sha256Header
    if (bytes.byteLength > MAX_BUNDLE_SIZE) {
      return { ok: false, errorCode: 'bundle-too-large', error: `下载到的 zip ${bytes.byteLength}B 超过 ${MAX_BUNDLE_SIZE}B 上限` }
    }
    const extracted = await extractAndVerifyZip(bytes, manifest, zipHeaderSha, manifestZipSha256)
    if (extracted.ok) {
      files = extracted.files
    } else {
      // zip 校验/解压失败 → 退化到单文件
      console.warn(`[clawhub] zip 路径失败 (${extracted.code})，尝试 fallback：${extracted.error}`)
    }
  } catch (err) {
    console.warn(`[clawhub] zip 下载失败，尝试 fallback：${err instanceof Error ? err.message : err}`)
  }

  // 5. fallback：单文件
  if (!files) {
    const oversize = manifest.find(f => f.size > SINGLE_FILE_HTTP_LIMIT)
    if (oversize) {
      return {
        ok: false,
        errorCode: 'fallback-blocked-by-large-file',
        error: `zip 路径失败，且 manifest 含 >200KB 文件（${oversize.path} = ${oversize.size}B）无法走单文件 fallback`,
      }
    }
    source = 'file-by-file'
    const fb = await fetchAndVerifyByFile(client, slug, version, manifest)
    if (!fb.ok) return { ok: false, errorCode: fb.code, error: fb.error }
    files = fb.files
  }

  // 6. 落盘（覆盖语义）
  try {
    flushFilesToDir(targetDir, files)
  } catch (err) {
    return { ok: false, errorCode: 'write-failed', error: err instanceof Error ? err.message : String(err) }
  }

  // 7. 写 origin & lock
  const totalSize = manifestCheck.totalSize
  const origin: ClawHubOrigin = {
    registry: client.baseUrl,
    slug,
    version,
    bundleSha256: manifestZipSha256 ?? zipHeaderSha,
    installedAt: Date.now(),
    source,
  }
  writeOrigin(targetDir, origin)

  const lock = loadLock(opts.skillsDir)
  lock.entries[slug] = {
    registry: origin.registry,
    slug,
    version,
    bundleSha256: origin.bundleSha256,
    fileCount: manifest.length,
    totalSize,
    installedAt: origin.installedAt,
    pinned: lock.entries[slug]?.pinned ?? false,
  }
  saveLock(opts.skillsDir, lock)

  return {
    ok: true,
    skillId: slug,
    version,
    filesWritten: manifest.length,
    totalSize,
    source,
  }
}

/** 卸载（只清 ClawHub 下来的，移除 lock 条目）。 */
export function uninstallClawHubSkill(skillsDir: string, slug: string): boolean {
  if (!isValidSkillId(slug)) return false
  const targetDir = join(skillsDir, slug)
  const lock = loadLock(skillsDir)
  if (!lock.entries[slug] && !existsSync(targetDir)) return false
  if (lock.entries[slug]?.pinned) return false
  if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true })
  delete lock.entries[slug]
  saveLock(skillsDir, lock)
  return true
}

/** 列出当前已通过 ClawHub 安装的 Skill。 */
export function listInstalled(skillsDir: string): ClawHubLock {
  return loadLock(skillsDir)
}
