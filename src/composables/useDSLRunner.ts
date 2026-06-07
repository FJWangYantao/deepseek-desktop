import { ref, shallowRef } from 'vue'
import type { DSLStep, RunnerState, VariableEnvironment, DSLPauseInfo, DSLStepOutput, DSLLoopStep } from '@/types/dsl'
import { interpolate, evaluateCondition } from '@/utils/variable-interpolator'
import { deepSeekChat } from '@/composables/useDeepSeek'

// ===== 内部引擎 =====

type PauseResolver = (value: string) => void
type StepOutputCallback = (output: DSLStepOutput) => void

interface RunnerContext {
  apiKey: string
  model: string
  thinking: 'enabled' | 'disabled'
  onStepOutput: StepOutputCallback
  signal: AbortSignal
}

class DSLRunnerEngine {
  state: RunnerState = 'IDLE'
  env: VariableEnvironment = {
    input: {},
    context: { userInput: '', date: '' },
  }
  stack: DSLStep[][] = []
  private pauseResolver: PauseResolver | null = null
  private abortCtrl: AbortController | null = null
  currentPauseInfo: DSLPauseInfo | null = null
  onStateChange?: () => void

  async start(steps: DSLStep[], context: { userInput: string; files?: { name: string; text: string; size: number }[]; date: string; searchResults?: string }, ctx: RunnerContext) {
    this.state = 'RUNNING'
    this.env = {
      input: {},
      context: { userInput: context.userInput, files: context.files, date: context.date, searchResults: context.searchResults },
    }
    this.stack = [[...steps]]
    this.abortCtrl = new AbortController()

    try {
      while (this.stack.length > 0 && this.state === 'RUNNING') {
        const current = this.stack[0]
        if (current.length === 0) {
          this.stack.shift()
          continue
        }
        const step = current.shift()!
        if (ctx.signal.aborted) { this.state = 'IDLE'; return }
        await this.executeStep(step, ctx)
      }
      if (this.state === 'RUNNING') this.state = 'COMPLETED'
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        this.state = 'IDLE'
      } else {
        this.state = 'ERROR'
        throw e
      }
    }
  }

  private async executeStep(step: DSLStep, ctx: RunnerContext) {
    switch (step.type) {
      case 'prompt': return this.execPrompt(step, ctx)
      case 'condition': return this.execCondition(step, ctx)
      case 'tool': return this.execTool(step, ctx)
      case 'input': return this.execInput(step)
      case 'output': return this.execOutput(step, ctx)
      case 'loop': return this.execLoop(step, ctx)
    }
  }

  // ========== prompt ==========

  private async execPrompt(step: DSLStep & { type: 'prompt' }, ctx: RunnerContext) {
    const content = interpolate(step.prompt, this.env as unknown as Record<string, unknown>)

    const messages: { role: 'user' | 'assistant' | 'system'; content: string }[] = [
      { role: 'system', content: `Skill: 正在执行步骤"${step.stage}"\n${content}` },
    ]

    let fullContent = ''
    const abortCtrl = new AbortController()
    ctx.signal.addEventListener('abort', () => abortCtrl.abort())

    await deepSeekChat({
      messages,
      model: ctx.model,
      thinking: ctx.thinking,
      apiKey: ctx.apiKey,
      signal: abortCtrl.signal,
      onToken: (token) => { fullContent += token },
      onThinking: () => {},
    })

    this.env[step.stage] = { output: fullContent }
    ctx.onStepOutput({ stage: step.stage, content: fullContent, stepType: 'prompt' })
  }

  // ========== condition ==========

  private execCondition(step: DSLStep & { type: 'condition' }, ctx: RunnerContext) {
    const result = evaluateCondition(step.condition, this.env)
    if (result && step.then.length > 0) {
      this.stack.unshift([...step.then])
    } else if (!result && step.else && step.else.length > 0) {
      this.stack.unshift([...step.else])
    }
    this.env[step.stage] = { result }
  }

  // ========== tool ==========

  private async execTool(step: DSLStep & { type: 'tool' }, ctx: RunnerContext) {
    const params: Record<string, string> = {}
    for (const [k, v] of Object.entries(step.params)) {
      params[k] = interpolate(v, this.env as unknown as Record<string, unknown>)
    }

    // 解析工具名：支持直接名称（web_search）或 mcp:serverId/toolName 格式
    const mcpMatch = step.tool.match(/^mcp:([a-z_][a-z0-9_]*)\/([a-z][a-z0-9_-]*)$/i)
    const toolName = mcpMatch ? mcpMatch[2] : step.tool

    try {
      // 通过统一工具系统执行
      const res = await (window as any).electronAPI.toolsCall({
        name: toolName,
        arguments: JSON.stringify(params),
        callId: `dsl_${step.stage}_${Date.now()}`,
      })
      if (res.success) {
        this.env[step.stage] = { output: res.data }
        ctx.onStepOutput({ stage: step.stage, content: res.data, stepType: 'tool' })
      } else {
        this.env[step.stage] = { output: null, error: res.data }
        ctx.onStepOutput({ stage: step.stage, content: `工具执行失败: ${res.data}`, stepType: 'tool' })
      }
    } catch (e: unknown) {
      this.env[step.stage] = { output: null, error: String(e) }
    }
  }

  // ========== input ==========

  private execInput(step: DSLStep & { type: 'input' }): Promise<void> {
    return new Promise((resolve) => {
      this.currentPauseInfo = { prompt: step.input, default: step.default, validate: step.validate, stage: step.stage }
      this.state = 'PAUSED'
      this.onStateChange?.()
      this.pauseResolver = (value: string) => {
        this.env.input[step.stage] = value
        this.currentPauseInfo = null
        this.state = 'RUNNING'
        this.pauseResolver = null
        resolve()
      }
    })
  }

  resume(value: string) {
    if (this.state !== 'PAUSED' || !this.pauseResolver) return
    this.pauseResolver(value)
  }

  // ========== output ==========

  private execOutput(step: DSLStep & { type: 'output' }, ctx: RunnerContext) {
    const content = interpolate(step.output.template, this.env as unknown as Record<string, unknown>)
    this.env[step.stage] = { output: content }
    ctx.onStepOutput({ stage: step.stage, content, stepType: 'output' })
  }

  // ========== loop ==========

  private async execLoop(step: DSLLoopStep, ctx: RunnerContext) {
    const loop = step.loop
    const iterVar = loop.as || 'i'
    let iterations = 0

    // Mode 1: times
    const times = loop.times ?? 0

    // Mode 3: each
    let eachArray: unknown[] | null = null
    if (loop.each) {
      const resolved = interpolate(loop.each, this.env as unknown as Record<string, unknown>)
      try { eachArray = JSON.parse(resolved) } catch {}
    }

    const maxIter = Math.max(times || eachArray?.length || 0, loop.max ?? 100)
    const max = Math.min(maxIter, 100) // 安全上限

    for (let i = 0; i < max; i++) {
      // Mode 2: until
      if (loop.until) {
        const shouldContinue = evaluateCondition(loop.until, this.env)
        if (!shouldContinue) break
      }

      if (ctx.signal.aborted) return

      // 设置循环变量
      this.env[iterVar] = eachArray ? eachArray[i] : i + 1
      iterations++

      // 执行子步骤
      if (step.steps.length > 0) {
        this.stack.unshift([...step.steps])
        // 等待子步骤执行完（pop 回当前执行）
        while (this.stack.length > 0 && this.state === 'RUNNING') {
          const current = this.stack[0]
          if (current.length === 0) { this.stack.shift(); continue }
          const subStep = current.shift()!
          await this.executeStep(subStep, ctx)
        }
        // 恢复执行栈：当前步骤移出后，还有可能剩下的栈项
      }
    }
  }
}

// ===== Vue Composable =====

const engine = new DSLRunnerEngine()

export function useDSLRunner() {
  const state = ref<RunnerState>('IDLE')
  const pauseInfo = shallowRef<DSLPauseInfo | null>(null)
  const error = ref<string | null>(null)

  function syncState() {
    state.value = engine.state
    syncPauseInfo()
  }

  async function startExecution(opts: {
    steps: DSLStep[]
    context: { userInput: string; files?: { name: string; text: string; size: number }[]; date: string; searchResults?: string }
    apiKey: string; model: string; thinking: 'enabled' | 'disabled'
    signal: AbortSignal
    onStepOutput: (o: DSLStepOutput) => void
  }) {
    error.value = null
    pauseInfo.value = null
    engine.onStateChange = syncState
    try {
      await engine.start(opts.steps, opts.context, {
        apiKey: opts.apiKey, model: opts.model, thinking: opts.thinking,
        signal: opts.signal, onStepOutput: opts.onStepOutput,
      })
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      engine.onStateChange = undefined
      syncState()
    }
  }

  function resume(value: string) {
    engine.resume(value)
    syncState()
  }

  function abort() {
    engine.currentPauseInfo = null
    engine.state = 'IDLE'
    syncState()
  }

  function syncPauseInfo() {
    if (engine.state === 'PAUSED' && engine.currentPauseInfo) {
      pauseInfo.value = { ...engine.currentPauseInfo }
    } else {
      pauseInfo.value = null
    }
  }

  // 定期同步（chat store 集成时会手动调）
  syncState()

  return { state, pauseInfo, error, startExecution, resume, abort, syncState }
}
