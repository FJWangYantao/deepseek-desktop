import { isAbsolute, relative, resolve } from 'path'

const SKILL_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isValidSkillId(id: string): boolean {
  return SKILL_ID_RE.test(id)
}

export function slugifySkillId(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || Date.now().toString(36)
}

export function isInsidePath(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function assertSafeRelativePath(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || isAbsolute(normalized) || /^[a-z]:/i.test(normalized)) {
    throw new Error('资源路径必须是相对路径')
  }
  if (normalized.split('/').some(part => part === '..')) {
    throw new Error('资源路径不能包含路径穿越')
  }
  return normalized.replace(/^\.\//, '')
}

export function safeJoin(root: string, relativePath: string): string {
  const safeRel = assertSafeRelativePath(relativePath)
  const target = resolve(root, safeRel)
  if (!isInsidePath(root, target)) throw new Error('资源路径越界')
  return target
}
