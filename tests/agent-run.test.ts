/**
 * Agent Runtime Phase 1 — Domain Model 测试。
 * 用法：npx tsx tests/agent-run.test.ts
 */
import {
  appendAgentRound,
  createAgentRound,
  createAgentRun,
  startAgentRun,
} from '../src/runtime'

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

console.log('\n[1] createAgentRun — 初始实体')
{
  const run = createAgentRun({
    sessionId: 'session-1',
    conversationTurnId: 'turn-1',
    mode: 'chat',
    id: 'run-1',
    createdAt: 123,
  })

  check('保留 Run id', run.id === 'run-1')
  check('保留 sessionId', run.sessionId === 'session-1')
  check('保留 conversationTurnId', run.conversationTurnId === 'turn-1')
  check('保留 mode', run.mode === 'chat')
  check('初始状态为 created', run.status === 'created')
  check('初始 rounds 为空', run.rounds.length === 0)
  check('保留 createdAt', run.createdAt === 123)
  check('初始没有 startedAt', run.startedAt === undefined)
  check('初始没有 finishedAt', run.finishedAt === undefined)
}

console.log('\n[2] startAgentRun — 创建与启动时间分离')
{
  const run = createAgentRun({
    sessionId: 'session-1',
    conversationTurnId: 'turn-1',
    mode: 'chat',
    id: 'run-start',
    createdAt: 100,
  })
  const returned = startAgentRun(run, 250)

  check('返回同一个 Run 对象', returned === run)
  check('状态变为 running', run.status === 'running')
  check('记录 startedAt', run.startedAt === 250)
  check('保留 createdAt', run.createdAt === 100)

  let secondStartRejected = false
  try {
    startAgentRun(run, 300)
  } catch {
    secondStartRejected = true
  }
  check('已启动的 Run 不能重复启动', secondStartRejected)
}

console.log('\n[3] createAgentRound — 初始轮次')
{
  const round = createAgentRound({
    index: 0,
    roundId: 'round-1',
    inputMessages: [{ role: 'user', content: '你好' }],
    startedAt: 456,
  })

  check('保留 roundId', round.roundId === 'round-1')
  check('保留轮次 index', round.index === 0)
  check('保留输入消息', round.inputMessages.length === 1 && round.inputMessages[0].content === '你好')
  check('初始 tools 为空', round.tools.length === 0)
  check('保留轮次 startedAt', round.startedAt === 456)
}

console.log('\n[4] appendAgentRound — Run 与 Round 关联')
{
  const run = createAgentRun({
    sessionId: 'session-1',
    conversationTurnId: 'turn-1',
    mode: 'react',
    id: 'run-2',
  })
  const round = createAgentRound({ index: 0, roundId: 'round-2' })
  const returned = appendAgentRound(run, round)

  check('返回同一个 Run 对象', returned === run)
  check('Run 包含追加的 Round', run.rounds.length === 1 && run.rounds[0] === round)

  let outOfOrderRejected = false
  try {
    appendAgentRound(run, createAgentRound({ index: 2, roundId: 'round-out-of-order' }))
  } catch {
    outOfOrderRejected = true
  }
  check('拒绝非连续 round.index', outOfOrderRejected)

  let duplicateRejected = false
  try {
    appendAgentRound(run, round)
  } catch {
    duplicateRejected = true
  }
  check('拒绝重复 roundId', duplicateRejected)
}

console.log('\n[5] createAgentRun — 默认 id')
{
  const run = createAgentRun({
    sessionId: 'session-2',
    conversationTurnId: 'turn-2',
    mode: 'plan',
  })
  check('自动生成 id', run.id.length > 0)
  check('自动生成 id 以 run_ 开头', run.id.startsWith('run_'))
}

console.log('\n')
console.log(`Passed: ${passed}`)
console.log(`Failed: ${failed}`)
if (failed > 0) {
  console.log('\nFailures:')
  for (const failure of failures) console.log('  - ' + failure)
  process.exit(1)
}
