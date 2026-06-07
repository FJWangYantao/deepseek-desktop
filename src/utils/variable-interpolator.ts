import type { VariableEnvironment } from '@/types/dsl'

/** 插值：将 {{var.path}} 替换为环境变量中的值 */
export function interpolate(template: string, env: Record<string, unknown>): string {
  return template.replace(/\{\{([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\}\}/g, (_, path: string) => {
    const segments = path.split('.')
    let current: unknown = env

    for (const seg of segments) {
      if (current === null || current === undefined) return `{{${path}}}`
      if (typeof current === 'object' && current !== null && seg in current) {
        current = (current as Record<string, unknown>)[seg]
      } else {
        return `{{${path}}}`
      }
    }

    if (current === null || current === undefined) return `{{${path}}}`
    if (typeof current === 'object') return JSON.stringify(current)
    return String(current)
  })
}

/** 为 DSL 运行器构建完整的变量环境并插值 */
export function evaluateCondition(condition: string, env: VariableEnvironment): boolean {
  const resolved = interpolate(condition, env as unknown as Record<string, unknown>)

  // 中文操作符
  if (resolved.includes(' 包含 ')) {
    const parts = resolved.split(' 包含 ')
    if (parts.length === 2) return parts[0].includes(parts[1])
  }
  if (resolved.includes(' 不包含 ')) {
    const parts = resolved.split(' 不包含 ')
    if (parts.length === 2) return !parts[0].includes(parts[1])
  }
  if (resolved.includes(' 等于 ')) {
    const parts = resolved.split(' 等于 ')
    if (parts.length === 2) return parts[0].trim() === parts[1].trim()
  }
  if (resolved.includes(' 不等于 ')) {
    const parts = resolved.split(' 不等于 ')
    if (parts.length === 2) return parts[0].trim() !== parts[1].trim()
  }

  // 无操作符：当成 boolean/truthy
  if (resolved === 'true') return true
  if (resolved === 'false') return false
  return resolved.length > 0
}
