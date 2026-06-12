import { app } from 'electron'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { dirname, extname, join, resolve } from 'path'
import type {
  LegacySkillMeta,
  SkillIndex,
  SkillPackage,
  SkillResource,
  SkillResourceReadResult,
  SkillValidationIssue,
  SkillValidationResult,
} from '../../src/types/skills'
import { parseFrontmatter, serializeFrontmatter, extractOpenClawMetadata } from './frontmatter'
import { assertSafeRelativePath, isValidSkillId, safeJoin, slugifySkillId } from './path-safety'
import { DEFAULT_SKILL_PACKAGES } from './defaults'

/**
 * ClawHub 文本文件白名单（与 packages/schema/src/textFiles.ts 对齐 + 我们关心的资源类型）。
 * 这是"可作为 resource 读取"的扩展；与"package 是否合法包"无关。
 */
const TEXT_EXTS = new Set([
  // 通用文本
  '.md', '.mdx', '.txt', '.rst',
  // 数据/配置
  '.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml', '.ini', '.env', '.csv', '.tsv',
  // 代码（按 ClawHub 允许的范围）
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.pyi', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.php',
  '.c', '.h', '.cc', '.cpp', '.hpp', '.cs',
  '.sh', '.bash', '.zsh', '.fish',
  '.ps1', '.psm1', '.psd1',
  // 模板/标记
  '.html', '.htm', '.xml', '.svg', '.css', '.scss', '.less',
  // 其它常见
  '.sql', '.graphql', '.proto', '.dockerfile',
])
const MAX_RESOURCE_SIZE = 1 * 1024 * 1024 // 单个 resource 最大 1MB
const MAX_BUNDLE_SIZE = 50 * 1024 * 1024 // ClawHub 标准：bundle 50MB

export const skillsDir = join(app.getPath('userData'), 'skills')

function ensureDir(path = skillsDir) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean)
  return []
}

function validation(errors: SkillValidationIssue[] = [], warnings: SkillValidationIssue[] = []): SkillValidationResult {
  return { ok: errors.length === 0, errors, warnings }
}

/**
 * 资源分类规则（兼容两个生态）：
 * - Anthropic 风格：references/ / assets/ / scripts/ 三个目录
 * - ClawHub 风格：包内任意文本文件都是 resource，不强制目录布局
 *
 * 我们按"位于已知目录前缀 → 取该 kind，否则归为 reference（说明性文本）"处理；
 * 顶层文件如 forms.md / reference.md 也按 reference 处理（pdf skill 就是这么做的）。
 */
function getResourceKind(path: string): SkillResource['kind'] {
  if (path.startsWith('scripts/')) return 'script'
  if (path.startsWith('assets/')) return 'asset'
  return 'reference'
}

function mediaTypeFor(path: string): string | undefined {
  const ext = extname(path).toLowerCase()
  if (ext === '.md' || ext === '.txt') return 'text/plain'
  if (ext === '.json') return 'application/json'
  if (ext === '.csv') return 'text/csv'
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.svg') return 'image/svg+xml'
  return undefined
}

/** 跳过的目录/文件名（不进 resource 列表） */
const SKIP_NAMES = new Set([
  'SKILL.md', 'skill.md', 'LICENSE', 'LICENSE.txt', 'LICENSE.md',
  '.clawhub', '.clawdhub', '.git', '.DS_Store',
])

function shouldSkip(name: string): boolean {
  return SKIP_NAMES.has(name) || name.startsWith('.')
}

function walkResources(baseDir: string, prefix: string, acc: SkillResource[]) {
  const dir = prefix ? join(baseDir, prefix) : baseDir
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (shouldSkip(entry.name)) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    const full = join(baseDir, rel)
    if (entry.isDirectory()) {
      walkResources(baseDir, rel, acc)
      continue
    }
    if (!entry.isFile()) continue
    const stats = statSync(full)
    const ext = extname(rel).toLowerCase()
    const kind = getResourceKind(rel)
    acc.push({
      path: rel,
      kind,
      mediaType: mediaTypeFor(rel),
      size: stats.size,
      readable: kind !== 'script' && TEXT_EXTS.has(ext) && stats.size <= MAX_RESOURCE_SIZE,
      executable: false,
    })
  }
}

function listResources(packageDir: string): SkillResource[] {
  const resources: SkillResource[] = []
  walkResources(packageDir, '', resources)
  return resources
}

function calcBundleSize(packageDir: string): number {
  let total = 0
  const stack: string[] = [packageDir]
  while (stack.length) {
    const dir = stack.pop()!
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (shouldSkip(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) {
        try { total += statSync(full).size } catch { /* ignore */ }
      }
    }
  }
  return total
}

function buildIndexFromReadme(id: string, readmePath: string, kind: SkillIndex['kind'], updatedAt: number): SkillIndex | null {
  const text = readFileSync(readmePath, 'utf-8')
  const parsed = parseFrontmatter(text)
  if (!parsed) return null

  const errors: SkillValidationIssue[] = []
  const warnings: SkillValidationIssue[] = []
  const name = asString(parsed.meta.name, id)
  const description = asString(parsed.meta.description)
  const displayName = asString(parsed.meta.displayName) || asString(parsed.meta.display_name) || undefined

  if (!name) errors.push({ code: 'missing-name', message: '缺少 name' })
  if (!description) errors.push({ code: 'missing-description', message: '缺少 description' })
  if (kind === 'package' && name !== id) warnings.push({ code: 'name-mismatch', message: '建议 name 与目录名保持一致', path: 'SKILL.md' })
  if (description && description.length < 20) warnings.push({ code: 'short-description', message: 'description 太短，不利于模型触发 Skill', path: 'SKILL.md' })
  if (parsed.body.split('\n').length > 500) warnings.push({ code: 'long-readme', message: 'SKILL.md 超过 500 行，建议拆分到 references', path: 'SKILL.md' })

  const packageDir = kind === 'package' ? dirname(readmePath) : ''
  const resources = kind === 'package' ? listResources(packageDir) : []
  const bundleSize = kind === 'package' ? calcBundleSize(packageDir) : statSync(readmePath).size
  if (bundleSize > MAX_BUNDLE_SIZE) {
    errors.push({ code: 'bundle-too-large', message: `Skill 包超过 ${MAX_BUNDLE_SIZE / 1024 / 1024}MB 上限` })
  }

  const runtime = extractOpenClawMetadata(parsed.meta)

  // 兼容 ClawHub 的 emoji/homepage：如果 frontmatter 顶层也声明了，且 runtime 没有，回填
  if (runtime) {
    if (!runtime.emoji && typeof parsed.meta.emoji === 'string') runtime.emoji = parsed.meta.emoji
    if (!runtime.homepage && typeof parsed.meta.homepage === 'string') runtime.homepage = parsed.meta.homepage
  }

  return {
    id,
    name,
    description,
    displayName,
    version: asString(parsed.meta.version) || undefined,
    tags: asTags(parsed.meta.tags),
    kind,
    enabled: true,
    source: 'user',
    entry: kind === 'package' ? 'SKILL.md' : 'legacy.md',
    hasReferences: resources.some(r => r.kind === 'reference'),
    hasAssets: resources.some(r => r.kind === 'asset'),
    hasScripts: resources.some(r => r.kind === 'script'),
    scriptExecution: 'disabled',
    validation: validation(errors, warnings),
    updatedAt,
    runtime,
    bundleSize,
  }
}

export function ensureDefaultSkills() {
  ensureDir()
  for (const skill of DEFAULT_SKILL_PACKAGES) {
    const skillDir = join(skillsDir, skill.id)
    const readmePath = join(skillDir, 'SKILL.md')
    if (existsSync(readmePath) || existsSync(join(skillsDir, `${skill.id}.md`))) continue

    ensureDir(skillDir)
    writeFileSync(readmePath, skill.readme, 'utf-8')
    for (const [rel, content] of Object.entries(skill.resources ?? {})) {
      const target = safeJoin(skillDir, rel)
      ensureDir(dirname(target))
      writeFileSync(target, content, 'utf-8')
    }
  }
}

export function listSkillIndex(): SkillIndex[] {
  ensureDir()
  const entries = readdirSync(skillsDir, { withFileTypes: true })
  const byId = new Map<string, SkillIndex>()

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const id = entry.name
    if (!isValidSkillId(id)) continue
    const readmePath = join(skillsDir, id, 'SKILL.md')
    if (!existsSync(readmePath)) continue
    const index = buildIndexFromReadme(id, readmePath, 'package', statSync(readmePath).mtimeMs)
    if (index) byId.set(id, index)
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const id = entry.name.slice(0, -3)
    if (!isValidSkillId(id) || byId.has(id)) continue
    const legacyPath = join(skillsDir, entry.name)
    const index = buildIndexFromReadme(id, legacyPath, 'legacy-md', statSync(legacyPath).mtimeMs)
    if (index) byId.set(id, index)
  }

  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

export function getSkillPackage(id: string): SkillPackage | null {
  if (!isValidSkillId(id)) return null
  const index = listSkillIndex().find(s => s.id === id)
  if (!index) return null

  const readmePath = index.kind === 'package'
    ? join(skillsDir, id, 'SKILL.md')
    : join(skillsDir, `${id}.md`)
  const readme = readFileSync(readmePath, 'utf-8')
  const parsed = parseFrontmatter(readme)
  if (!parsed) return null
  const packageDir = index.kind === 'package' ? join(skillsDir, id) : ''

  return {
    ...index,
    readme,
    frontmatter: parsed.meta,
    body: parsed.body,
    resources: index.kind === 'package' ? listResources(packageDir) : [],
  }
}

export function readLegacySkill(id: string): LegacySkillMeta | null {
  const pkg = getSkillPackage(id)
  if (!pkg) return null
  return {
    id: pkg.id,
    name: pkg.displayName || pkg.name,
    description: pkg.description,
    version: pkg.version || '1.0.0',
    tags: pkg.tags,
    content: pkg.body,
  }
}

export function listLegacySkills(): LegacySkillMeta[] {
  return listSkillIndex().map(s => readLegacySkill(s.id)).filter(Boolean) as LegacySkillMeta[]
}

export function createSkillPackage(id: string, readme: string): SkillPackage | null {
  const safeId = slugifySkillId(id)
  if (!isValidSkillId(safeId)) return null
  const skillDir = join(skillsDir, safeId)
  const readmePath = join(skillDir, 'SKILL.md')
  if (existsSync(readmePath) || existsSync(join(skillsDir, `${safeId}.md`))) return null
  ensureDir(skillDir)
  writeFileSync(readmePath, readme, 'utf-8')
  return getSkillPackage(safeId)
}

export function saveSkillPackage(id: string, readme: string): boolean {
  if (!isValidSkillId(id)) return false
  const skillDir = join(skillsDir, id)
  ensureDir(skillDir)
  writeFileSync(join(skillDir, 'SKILL.md'), readme, 'utf-8')
  return true
}

export function saveLegacySkill(skill: LegacySkillMeta): boolean {
  const id = slugifySkillId(skill.id || skill.name)
  const readme = serializeFrontmatter({
    name: skill.name || id,
    description: skill.description || '',
    version: skill.version || '1.0.0',
    tags: skill.tags || [],
  }, skill.content || '')
  ensureDir()
  writeFileSync(join(skillsDir, `${id}.md`), readme, 'utf-8')
  return true
}

export function deleteSkill(id: string): boolean {
  if (!isValidSkillId(id)) return false
  const packageDir = join(skillsDir, id)
  const legacyPath = join(skillsDir, `${id}.md`)
  if (existsSync(packageDir) && statSync(packageDir).isDirectory()) {
    rmSync(packageDir, { recursive: true, force: true })
    return true
  }
  if (existsSync(legacyPath)) {
    unlinkSync(legacyPath)
    return true
  }
  return false
}

export async function importSkillFromUrl(url: string): Promise<SkillPackage | null> {
  const res = await fetch(url)
  if (!res.ok) return null
  const text = await res.text()
  const parsed = parseFrontmatter(text)
  if (!parsed) return null
  const id = slugifySkillId(asString(parsed.meta.name) || `skill-${Date.now().toString(36)}`)
  return createSkillPackage(id, text)
}

export function migrateLegacySkill(id: string): SkillPackage | null {
  if (!isValidSkillId(id)) return null
  const legacyPath = join(skillsDir, `${id}.md`)
  const packagePath = join(skillsDir, id, 'SKILL.md')
  if (!existsSync(legacyPath) || existsSync(packagePath)) return null
  const content = readFileSync(legacyPath, 'utf-8')
  return createSkillPackage(id, content)
}

export function readSkillResource(id: string, rawPath: string): SkillResourceReadResult {
  try {
    if (!isValidSkillId(id)) return { error: '无效的 Skill ID' }
    const pkg = getSkillPackage(id)
    if (!pkg || pkg.kind !== 'package') return { error: 'Skill 不存在或不是目录包' }

    const rel = assertSafeRelativePath(rawPath)
    const resource = pkg.resources.find(r => r.path === rel)
    if (!resource) return { error: '资源不存在' }
    if (resource.kind === 'script') return { error: 'scripts 不通过 read_resource 读取内容；如需运行，请用 skill_script_run 执行（仅限 frontmatter 声明过的命令）。', resource }
    if (!resource.readable) return { error: '资源不可读或超过大小限制', resource }

    const target = safeJoin(resolve(skillsDir, id), rel)
    return { content: readFileSync(target, 'utf-8'), resource }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export function validateSkill(id: string): SkillValidationResult {
  const pkg = getSkillPackage(id)
  return pkg?.validation ?? validation([{ code: 'not-found', message: 'Skill 不存在' }])
}
