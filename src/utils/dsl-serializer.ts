import type { DSLStep } from '@/types/dsl'

/** 将 DSL 步骤 + meta + body 序列化为 .md 文件内容 */
export function serializeDSL(
  meta: { name: string; description: string; version: string; tags: string[] },
  body: string,
  steps: DSLStep[],
): string {
  const frontmatter = [`name: ${meta.name}`, `description: ${meta.description}`, `version: ${meta.version}`, `tags: [${meta.tags.join(', ')}]`]
  const stepsYaml = serializeStepArray(steps, 2)
  if (stepsYaml) frontmatter.push(`steps:\n${stepsYaml}`)
  return `---\n${frontmatter.join('\n')}\n---\n\n${body}`
}

function indent(text: string, level: number): string {
  return text.split('\n').map(l => (l.trim() ? '  '.repeat(level) + l : l)).join('\n')
}

function serializeStepArray(steps: DSLStep[], level: number): string {
  return steps.map(step => serializeStep(step, level)).join('\n')
}

function serializeStep(step: DSLStep, level: number): string {
  const prefix = '  '.repeat(level)
  const lines: string[] = []
  lines.push(`${prefix}- stage: ${step.stage}`)

  switch (step.type) {
    case 'prompt':
      lines.push(`${prefix}  prompt: |`)
      lines.push(...step.prompt.split('\n').map(l => `${prefix}    ${l}`))
      break

    case 'condition': {
      lines.push(`${prefix}  condition: ${step.condition}`)
      if (step.then.length > 0) {
        lines.push(`${prefix}  then:`)
        lines.push(serializeStepArray(step.then, level + 3))
      }
      if (step.else && step.else.length > 0) {
        lines.push(`${prefix}  else:`)
        lines.push(serializeStepArray(step.else, level + 3))
      }
      break
    }

    case 'tool':
      lines.push(`${prefix}  tool: ${step.tool}`)
      if (Object.keys(step.params).length > 0) {
        lines.push(`${prefix}  params:`)
        for (const [k, v] of Object.entries(step.params)) {
          lines.push(`${prefix}    ${k}: ${v}`)
        }
      }
      break

    case 'input':
      lines.push(`${prefix}  input: ${step.input}`)
      if (step.default) lines.push(`${prefix}  default: ${step.default}`)
      if (step.validate) lines.push(`${prefix}  validate: ${step.validate}`)
      break

    case 'output':
      lines.push(`${prefix}  output:`)
      lines.push(`${prefix}    format: ${step.output.format}`)
      lines.push(`${prefix}    template: |`)
      lines.push(...step.output.template.split('\n').map(l => `${prefix}      ${l}`))
      break

    case 'loop': {
      const loop = step.loop
      lines.push(`${prefix}  loop:`)
      if (loop.times) lines.push(`${prefix}    times: ${loop.times}`)
      if (loop.until) lines.push(`${prefix}    until: ${loop.until}`)
      if (loop.max) lines.push(`${prefix}    max: ${loop.max}`)
      if (loop.each) lines.push(`${prefix}    each: ${loop.each}`)
      lines.push(`${prefix}    as: ${loop.as}`)
      if (step.steps.length > 0) {
        lines.push(`${prefix}  steps:`)
        lines.push(serializeStepArray(step.steps, level + 2))
      }
      break
    }
  }

  return lines.join('\n')
}
