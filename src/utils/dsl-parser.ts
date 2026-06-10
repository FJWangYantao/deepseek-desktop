import type { DSLStep, DSLParseResult, DSLValidationError } from '@/types/dsl'

/**
 * 从 YAML frontmatter 提取 steps 数组
 * 使用缩进深度追踪检测 step 边界，零外部依赖
 */

function splitFrontmatter(text: string): { rawFrontmatter: string; body: string } | null {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!match) return null
  return { rawFrontmatter: match[1], body: match[2].trim() }
}

/**
 * 解析 DSL .md 内容，返回结构化的步骤数组
 */
export function parseDSL(text: string): DSLParseResult {
  const result: DSLParseResult = {
    meta: { name: '', description: '', version: '1.0.0', tags: [] },
    body: '',
    steps: null,
    isDSL: false,
    errors: [],
  }

  const split = splitFrontmatter(text)
  if (!split) return result

  result.body = split.body

  // 解析基础 meta
  for (const line of split.rawFrontmatter.split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/)
    if (!kv) continue
    const key = kv[1]
    let val: string = kv[2].trim()
    if (key === 'tags') {
      val = val.replace(/[\[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean).join(',')
      result.meta.tags = val ? val.split(',') : []
    } else if (key === 'name') result.meta.name = val
    else if (key === 'description') result.meta.description = val
    else if (key === 'version') result.meta.version = val
  }

  // 检查是否有 steps 定义
  const stepsMatch = split.rawFrontmatter.match(/^steps:\s*$/m)
  if (!stepsMatch) return result

  // 解析 steps 数组
  const stepsStart = stepsMatch.index! + stepsMatch[0].length
  const stepsYaml = split.rawFrontmatter.slice(stepsStart)
  const steps = parseStepArray(stepsYaml, result.errors)
  if (steps.length === 0) return result

  result.steps = steps
  result.isDSL = true
  return result
}

function parseStepArray(yaml: string, errors: DSLValidationError[]): DSLStep[] {
  const steps: DSLStep[] = []
  const lines = yaml.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    // 找每个步骤的起始行：- stage:
    const match = line.match(/^(\s*)-\s*stage:\s*(.+)$/)
    if (!match) { i++; continue }

    const indent = match[1].length
    const stage = match[2].trim()
    i++

    // 收集这个步骤的所有 key-value 行，直到缩进回退到 indent
    const stepLines: { key: string; value: string; nestedYaml?: string }[] = []
    while (i < lines.length) {
      const cur = lines[i]
      // 先检查缩进
      const leading = cur.match(/^(\s*)/)?.[1].length ?? 0

      // 缩进回到步骤级别（或者是个新的 - stage:）→ 结束
      if (leading <= indent && cur.trim()) break

      // 跳过空行
      if (!cur.trim()) { i++; continue }

      // key: value 行
      const kv = cur.match(/^\s*(\w+):\s*(.*)$/)
      if (kv) {
        const key = kv[1]
        let val = kv[2]

        // 多行字符串 (|)
        if (val.trim() === '|') {
          const multilineLines: string[] = []
          i++
          while (i < lines.length) {
            const ml = lines[i]
            const mlIndent = ml.match(/^(\s*)/)?.[1].length ?? 0
            if (mlIndent <= indent + 2 || !ml.trim()) {
              // 缩进回退或空行
              if (!ml.trim()) { i++; continue }
              break
            }
            multilineLines.push(ml.trim())
            i++
          }
          stepLines.push({ key, value: multilineLines.join('\n') })
          continue
        }

        // 嵌套结构（then:, else:, output:, loop:）
        if (['then', 'else', 'output', 'loop'].includes(key) && val.trim() === '') {
          // 收集嵌套内容
          const nestedLines: string[] = []
          i++
          while (i < lines.length) {
            const nl = lines[i]
            const nlIndent = nl.match(/^(\s*)/)?.[1].length ?? 0
            if (nlIndent <= indent + 2 || nl.trim() === '') {
              if (nl.trim() === '') { i++; continue }
              break
            }
            nestedLines.push(nl)
            i++
          }
          stepLines.push({ key, value: '', nestedYaml: nestedLines.join('\n') })
          continue
        }

        stepLines.push({ key, value: val.trim() })
        i++
      } else {
        i++
      }
    }

    const step = buildStep(stage, stepLines, errors, steps.length)
    if (step) steps.push(step)
  }

  return steps
}

function buildStep(
  stage: string,
  lines: { key: string; value: string; nestedYaml?: string }[],
  errors: DSLValidationError[],
  index: number,
): DSLStep | null {
  const map = new Map(lines.map(l => [l.key, l]))
  const getVal = (k: string) => map.get(k)?.value ?? ''
  const getNested = (k: string) => map.get(k)?.nestedYaml

  if (!stage) {
    errors.push({ stepIndex: index, field: 'stage', message: 'stage 名称不能为空' })
  }

  // 根据字段判断类型
  if (map.has('prompt')) {
    const promptVal = getVal('prompt')
    if (!promptVal || !promptVal.trim()) {
      errors.push({ stepIndex: index, field: 'prompt', message: 'prompt 步骤的 prompt 字段不能为空' })
    }
    return { type: 'prompt', stage, prompt: promptVal }
  }

  if (map.has('condition')) {
    const thenYaml = getNested('then')
    const elseYaml = getNested('else')
    const thenSteps = thenYaml ? parseStepArray(thenYaml, errors) : []
    const elseSteps = elseYaml ? parseStepArray(elseYaml, errors) : []
    if (thenSteps.length === 0) {
      errors.push({ stepIndex: index, field: 'then', message: 'condition 步骤的 then 分支不能为空' })
    }
    return { type: 'condition', stage, condition: getVal('condition'), then: thenSteps, else: elseSteps.length > 0 ? elseSteps : undefined }
  }

  if (map.has('tool')) {
    const tool = getVal('tool')
    if (tool && !/^mcp:[a-z_][a-z0-9_]+\/[a-z][a-z0-9_-]*$/i.test(tool)) {
      errors.push({ stepIndex: index, field: 'tool', message: 'tool 格式应为 mcp:server_id/tool_name' })
    }
    return { type: 'tool', stage, tool, params: {} }
  }

  if (map.has('input')) {
    return {
      type: 'input', stage,
      input: getVal('input'),
      default: map.has('default') ? getVal('default') : undefined,
      validate: map.has('validate') ? getVal('validate') : undefined,
    }
  }

  if (map.has('output')) {
    const format = getVal('format') || 'markdown'
    return {
      type: 'output', stage,
      output: { format: format as 'markdown' | 'text' | 'json', template: getVal('template') },
    }
  }

  if (map.has('loop')) {
    const nested = getNested('loop')
    const loopConfig: any = { as: 'i', steps: [] }
    if (nested) {
      for (const line of nested.split('\n')) {
        const kv = line.match(/^\s*(\w+):\s*(.*)$/)
        if (kv) {
          const lk = kv[1]; const lv = kv[2].trim()
          if (lk === 'times') loopConfig.times = parseInt(lv) || undefined
          else if (lk === 'until') loopConfig.until = lv
          else if (lk === 'max') loopConfig.max = parseInt(lv) || undefined
          else if (lk === 'each') loopConfig.each = lv
          else if (lk === 'as') loopConfig.as = lv
        }
      }
    }
    // 解析 loop 的子 steps
    const stepsNested = getNested('steps')
    const subSteps = stepsNested ? parseStepArray(stepsNested, errors) : []
    return { type: 'loop', stage, loop: loopConfig, steps: subSteps }
  }

  // 无匹配类型
  errors.push({ stepIndex: index, field: 'type', message: `无法确定步骤类型：stage="${stage}"` })
  return null
}

/** 检查技能内容是否为 DSL（快速检查：frontmatter 中有 steps: 键） */
export function isDSLContent(text: string): boolean {
  return /^steps:\s*$/m.test(splitFrontmatter(text)?.rawFrontmatter ?? '')
}
