/**
 * Phase 0：现有 useToolLoop 行为基线。
 *
 * 这些测试刻意直接调用当前的 Vue composable，并用 SSE/IPC mock 隔离网络与 Electron。
 * 在 Phase 2 抽出 AgentLoop 后，同一组场景应继续通过，作为迁移前后的行为契约。
 * 用法：npx tsx tests/tool-loop-baseline.test.ts
 */
import { useToolLoop } from '../src/composables/useToolLoop'
import type { ToolCallRequest, ToolCallResult, ToolDefinition } from '../src/types/tools'

type ModelResponse =
  | { events: unknown[] }
  | { abortText: string }

type MockRequest = {
  kind: 'toolsCall' | 'toolsCallApproved'
  request: ToolCallRequest
}

type MockEnvironment = {
  bodies: Record<string, unknown>[]
  requests: MockRequest[]
}

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, condition: unknown, detail?: string) {
  if (condition) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    failures.push(`${name}${detail ? ' — ' + detail : ''}`)
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

function toolDefinition(name: string): ToolDefinition {
  return {
    name,
    description: `${name} mock tool`,
    category: 'code',
    permissions: 'auto',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  }
}

function successfulToolResult(request: ToolCallRequest, data: string): ToolCallResult {
  return {
    callId: request.callId,
    name: request.name,
    success: true,
    data,
    truncated: false,
    totalSize: data.length,
    displayedSize: data.length,
    offset: 0,
  }
}

function approvalToolResult(request: ToolCallRequest, reason = '需要用户批准'): ToolCallResult {
  return {
    callId: request.callId,
    name: request.name,
    success: false,
    data: reason,
    truncated: false,
    totalSize: reason.length,
    displayedSize: reason.length,
    offset: 0,
    needsApproval: true,
    approvalReason: reason,
  }
}

function textResponse(text: string): ModelResponse {
  return {
    events: [
      { choices: [{ delta: { content: text }, finish_reason: 'stop' }] },
    ],
  }
}

function toolCallResponse(input: {
  id: string
  name: string
  arguments: string
  content?: string
}): ModelResponse {
  const events: unknown[] = []
  if (input.content) {
    events.push({ choices: [{ delta: { content: input.content } }] })
  }
  events.push(
    {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: input.id,
            type: 'function',
            function: { name: input.name },
          }],
        },
      }],
    },
    {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            function: { arguments: input.arguments },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    },
  )
  return { events }
}

function sseText(events: unknown[]): string {
  return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
}

function abortingResponse(text: string): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
      ))
      setTimeout(() => {
        controller.error(new DOMException('The operation was aborted.', 'AbortError'))
      }, 0)
    },
  })
  return new Response(stream)
}

function installMockEnvironment(options: {
  responses: ModelResponse[]
  toolNames?: string[]
  executeTool?: (request: ToolCallRequest) => Promise<ToolCallResult>
  executeApproved?: (request: ToolCallRequest) => Promise<ToolCallResult>
}): MockEnvironment {
  const responses = [...options.responses]
  const bodies: Record<string, unknown>[] = []
  const requests: MockRequest[] = []
  const tools = (options.toolNames ?? []).map(toolDefinition)

  const executeTool = options.executeTool ?? (async request => successfulToolResult(request, 'mock tool result'))
  const executeApproved = options.executeApproved ?? executeTool

  ;(globalThis as any).localStorage = {
    setItem() { /* deepSeekChat 的调试快照不影响基线行为 */ },
  }

  ;(globalThis as any).window = {
    electronAPI: {
      toolsList: async () => ({ tools }),
      toolsCall: async (request: ToolCallRequest) => {
        requests.push({ kind: 'toolsCall', request })
        return executeTool(request)
      },
      toolsCallApproved: async (request: ToolCallRequest) => {
        requests.push({ kind: 'toolsCallApproved', request })
        return executeApproved(request)
      },
    },
  }

  ;(globalThis as any).fetch = async (_input: unknown, init?: { body?: unknown }) => {
    const body = init?.body
    if (typeof body === 'string') bodies.push(JSON.parse(body) as Record<string, unknown>)

    const response = responses.shift()
    if (!response) throw new Error('mock LLM 响应队列已耗尽')
    if ('abortText' in response) return abortingResponse(response.abortText)
    return new Response(sseText(response.events))
  }

  return { bodies, requests }
}

function baseOptions(overrides: Record<string, unknown> = {}) {
  return {
    messages: [{ role: 'user' as const, content: '测试问题' }],
    model: 'deepseek-chat',
    thinking: 'disabled' as const,
    apiKey: 'test-key',
    onToken: (_token: string) => { /* per-test override */ },
    onThinking: (_token: string) => { /* per-test override */ },
    ...overrides,
  }
}

async function runBaselineTests() {
  console.log('\n[1] 普通 Chat：User → LLM → Final Answer')
  {
    const env = installMockEnvironment({ responses: [textResponse('普通回答')] })
    const tokens: string[] = []
    const result = await useToolLoop().run(baseOptions({
      onToken: (token: string) => tokens.push(token),
    }))

    check('返回最终正文', result.content === '普通回答')
    check('流式 token 已回调', tokens.join('') === '普通回答')
    check('产生一个 text block', result.blocks.length === 1 && result.blocks[0].type === 'text')
    check('普通 Chat 不发送 tools', env.bodies.length === 1 && env.bodies[0].tools === undefined)
  }

  console.log('\n[2] 单 Tool：LLM → file_read → Tool Result → LLM → Final')
  {
    const env = installMockEnvironment({
      toolNames: ['file_read'],
      responses: [
        toolCallResponse({ id: 'call-read', name: 'file_read', arguments: '{"path":"README.md"}' }),
        textResponse('文件内容已读取'),
      ],
      executeTool: async request => successfulToolResult(request, 'README 内容'),
    })
    const updates: any[][] = []
    const blocks: any[] = []
    const result = await useToolLoop().run(baseOptions({
      sessionId: 'session-baseline',
      conversationTurnId: 'turn-single-tool',
      modePolicy: { maxRounds: 3, allowedTools: ['file_read'], accumulate: false },
      onToolCallUpdate: (calls: any[]) => updates.push([...calls]),
      onBlock: (block: any) => blocks.push(block),
    }))

    check('工具链返回最终正文', result.content === '文件内容已读取')
    check('只执行一次 file_read', env.requests.length === 1 && env.requests[0].request.name === 'file_read')
    check('第二次 LLM 请求包含 assistant tool_calls',
      env.bodies.length === 2
      && Array.isArray(env.bodies[1].messages)
      && (env.bodies[1].messages as any[]).some(message => message.role === 'assistant' && message.tool_calls?.[0]?.id === 'call-read'))
    check('第二次 LLM 请求包含 tool result',
      (env.bodies[1].messages as any[]).some(message => message.role === 'tool' && message.tool_call_id === 'call-read' && message.content === 'README 内容'))
    check('内容块顺序为 text → tool → text',
      blocks.map(block => block.type).join(',') === 'tool,text'
      || result.blocks.map(block => block.type).join(',') === 'tool,text')
    check('工具最终状态为 completed', updates.at(-1)?.[0]?.status === 'completed')
  }

  console.log('\n[3] 多轮 Tool：web_search → web_fetch → Final')
  {
    const env = installMockEnvironment({
      toolNames: ['web_search', 'web_fetch'],
      responses: [
        toolCallResponse({ id: 'call-search', name: 'web_search', arguments: '{"query":"DeepSeek"}' }),
        toolCallResponse({ id: 'call-fetch', name: 'web_fetch', arguments: '{"url":"https://example.com"}' }),
        textResponse('搜索并抓取完成'),
      ],
      executeTool: async request => successfulToolResult(
        request,
        request.name === 'web_search' ? '搜索结果含 example.com' : '网页正文',
      ),
    })
    const result = await useToolLoop().run(baseOptions({
      modePolicy: { maxRounds: 4, allowedTools: ['web_search', 'web_fetch'], accumulate: true },
    }))

    check('多轮工具链返回最终正文', result.content === '搜索并抓取完成')
    check('按顺序执行 web_search → web_fetch',
      env.requests.map(item => item.request.name).join(' → ') === 'web_search → web_fetch')
    check('共发起三次 LLM 请求', env.bodies.length === 3)
    check('第三次请求携带两次 tool result',
      (env.bodies[2].messages as any[]).filter(message => message.role === 'tool').length === 2)
  }

  console.log('\n[4] Permission approve：请求批准 → 执行 → Final')
  {
    const env = installMockEnvironment({
      toolNames: ['file_write'],
      responses: [
        toolCallResponse({ id: 'call-approve', name: 'file_write', arguments: '{"path":"out.txt"}' }),
        textResponse('文件已写入'),
      ],
      executeTool: async request => approvalToolResult(request, '写入文件需要批准'),
      executeApproved: async request => successfulToolResult(request, '写入成功'),
    })
    const approvals: unknown[] = []
    const result = await useToolLoop().run(baseOptions({
      onNeedsApproval: async (info: unknown) => {
        approvals.push(info)
        return true
      },
    }))

    check('批准流程返回最终正文', result.content === '文件已写入')
    check('触发一次审批回调', approvals.length === 1)
    check('批准后调用 toolsCallApproved', env.requests.map(item => item.kind).join(',') === 'toolsCall,toolsCallApproved')
    check('批准执行成功', env.requests[1]?.request.callId === 'call-approve')
  }

  console.log('\n[5] Permission deny：请求批准 → 拒绝 → Final')
  {
    const env = installMockEnvironment({
      toolNames: ['file_write'],
      responses: [
        toolCallResponse({ id: 'call-deny', name: 'file_write', arguments: '{"path":"out.txt"}' }),
        textResponse('未执行写入'),
      ],
      executeTool: async request => approvalToolResult(request, '写入文件需要批准'),
    })
    const result = await useToolLoop().run(baseOptions({
      onNeedsApproval: async () => false,
    }))

    check('拒绝流程返回最终正文', result.content === '未执行写入')
    check('拒绝后不调用批准执行接口', env.requests.length === 1 && env.requests[0].kind === 'toolsCall')
    check('拒绝结果回填给第二次 LLM',
      (env.bodies[1].messages as any[]).some(message => message.role === 'tool' && message.content === '用户拒绝执行此操作'))
  }

  console.log('\n[6] Plan planning：工具禁用 → 仅文本输出')
  {
    const env = installMockEnvironment({
      toolNames: ['file_write'],
      responses: [textResponse('计划：先分析，再执行')],
    })
    const result = await useToolLoop().run(baseOptions({
      modePolicy: { maxRounds: 1, allowedTools: [], accumulate: true },
    }))

    check('规划阶段返回文本', result.content === '计划：先分析，再执行')
    check('规划阶段不发送 tools', env.bodies.length === 1 && env.bodies[0].tools === undefined)
    check('规划阶段不执行工具', env.requests.length === 0)
  }

  console.log('\n[7] Abort：流式输出部分结果后传播 AbortError')
  {
    const env = installMockEnvironment({
      responses: [{ abortText: '部分回答' }],
    })
    const tokens: string[] = []
    let error: unknown
    try {
      await useToolLoop().run(baseOptions({
        signal: new AbortController().signal,
        onToken: (token: string) => tokens.push(token),
      }))
    } catch (caught) {
      error = caught
    }

    check('Abort 会拒绝当前 Run', error instanceof DOMException && error.name === 'AbortError')
    check('Abort 前保留已收到的部分 token', tokens.join('') === '部分回答')
    check('Abort 场景确实发起了 LLM 请求', env.bodies.length === 1)
  }
}

await runBaselineTests()

console.log('\n')
console.log(`Passed: ${passed}`)
console.log(`Failed: ${failed}`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const failure of failures) console.log('  - ' + failure)
  process.exit(1)
}
