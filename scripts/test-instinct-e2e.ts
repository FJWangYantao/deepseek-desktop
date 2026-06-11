// 端到端测试：Instinct Engine
//
// 用法：
//   node --import tsx scripts/test-instinct-e2e.ts                # 仅 Path A
//   DS_API_KEY=sk-... node --import tsx scripts/test-instinct-e2e.ts  # Path A + Path B
//
// 在 Node 环境下打 stub：localStorage 用 MemoryStorage，避免 useInstinct 内部的
// localStorage 调用爆炸。Vue 的 ref 来自真实包，可正常工作。

// ===== Polyfill localStorage =====
class MemoryStorage {
  private store = new Map<string, string>()
  getItem(k: string) { return this.store.get(k) ?? null }
  setItem(k: string, v: string) { this.store.set(k, v) }
  removeItem(k: string) { this.store.delete(k) }
  clear() { this.store.clear() }
  get length() { return this.store.size }
  key(i: number) { return [...this.store.keys()][i] ?? null }
}
;(globalThis as Record<string, unknown>).localStorage = new MemoryStorage()

// ===== Imports =====
import type { ObservationEvent } from '../src/types/observation'
import {
  detectStatisticalPatterns,
  mergeAndEvolve,
  buildInstinctContext,
  decayUnusedInstincts,
  useInstinct,
  resetInstinctStore,
  extractEnglishKeywords,
  jaccard,
  INSTINCT_CONFIG,
} from '../src/composables/useInstinct'
import { extractSemanticPatterns } from '../src/composables/instinct/semantic'

// ===== 测试工具 =====
let passCount = 0
let failCount = 0
function assert(cond: unknown, label: string, info?: unknown) {
  if (cond) {
    passCount++
    console.log(`  ✅ ${label}`)
  } else {
    failCount++
    console.log(`  ❌ ${label}`)
    if (info !== undefined) console.log('     ↳', info)
  }
}
function section(name: string) {
  console.log(`\n━━━ ${name} ━━━`)
}

// ===== 模拟数据：微博热榜场景 =====
const T0 = 1780000000000
let idCounter = 0
function obsId() { return `obs_test_${++idCounter}` }

function mockWeiboHotEvents(turnId: string, t0: number): ObservationEvent[] {
  return [
    {
      id: obsId(), type: 'llm.request', timestamp: t0, schemaVersion: 1, source: 'renderer',
      sessionId: 'sess_test_1', conversationTurnId: turnId,
      round: 1, model: 'deepseek-v4-pro', thinking: 'disabled',
      messageCount: 2, hasTools: true, inputPreview: '搜索微博实时热榜',
    },
    {
      id: obsId(), type: 'tool.request', timestamp: t0 + 100, schemaVersion: 1, source: 'renderer',
      sessionId: 'sess_test_1', conversationTurnId: turnId,
      toolCallId: 'call_a', toolName: 'web_search',
      argumentsPreview: { queries: ['微博 热榜 实时'] },
    },
    {
      id: obsId(), type: 'tool.result', timestamp: t0 + 1500, schemaVersion: 1, source: 'renderer',
      sessionId: 'sess_test_1', conversationTurnId: turnId,
      toolCallId: 'call_a', toolName: 'web_search',
      success: false, dataPreview: 'No relevant results', totalSize: 50, displayedSize: 50, truncated: false,
    },
    {
      id: obsId(), type: 'tool.request', timestamp: t0 + 2000, schemaVersion: 1, source: 'renderer',
      sessionId: 'sess_test_1', conversationTurnId: turnId,
      toolCallId: 'call_b', toolName: 'web_fetch',
      argumentsPreview: { url: 'https://s.weibo.com/top/summary' },
    },
    {
      id: obsId(), type: 'tool.result', timestamp: t0 + 3500, schemaVersion: 1, source: 'renderer',
      sessionId: 'sess_test_1', conversationTurnId: turnId,
      toolCallId: 'call_b', toolName: 'web_fetch',
      success: true, dataPreview: '微博热搜榜：1. ... 2. ... 3. ...', totalSize: 8000, displayedSize: 4000, truncated: true,
    },
  ]
}

function mockPermissionDeniedEvents(toolName: string, n: number, t0: number): ObservationEvent[] {
  const out: ObservationEvent[] = []
  for (let i = 0; i < n; i++) {
    out.push({
      id: obsId(), type: 'tool.permission', timestamp: t0 + i * 1000, schemaVersion: 1, source: 'renderer',
      sessionId: 'sess_test_2',
      toolCallId: `call_d_${i}`, toolName, decision: 'denied',
    })
  }
  return out
}

function mockPermissionApprovedEvents(toolName: string, n: number, t0: number): ObservationEvent[] {
  const out: ObservationEvent[] = []
  for (let i = 0; i < n; i++) {
    out.push({
      id: obsId(), type: 'tool.permission', timestamp: t0 + i * 1000, schemaVersion: 1, source: 'renderer',
      sessionId: 'sess_test_3',
      toolCallId: `call_app_${i}`, toolName, decision: 'approved',
    })
  }
  return out
}

function mockRepeatedSearchEvents(keyword: string, n: number, t0: number): ObservationEvent[] {
  const out: ObservationEvent[] = []
  for (let i = 0; i < n; i++) {
    out.push({
      id: obsId(), type: 'tool.request', timestamp: t0 + i * 5000, schemaVersion: 1, source: 'renderer',
      sessionId: 'sess_test_4', conversationTurnId: `turn_search_${i}`,
      toolCallId: `call_s_${i}`, toolName: 'web_search',
      argumentsPreview: { queries: [`${keyword} 最新进展 ${i}`] },
    })
  }
  return out
}

// ===== Suite 1: 纯函数（关键词抽取 / Jaccard） =====
async function suiteUtils() {
  section('Suite 1: 关键词抽取 & Jaccard')

  const kw1 = extractEnglishKeywords('当用户询问中文实时榜单时 → 优先用 web_fetch 抓官方榜单页')
  assert(kw1.includes('web_fetch') || kw1.includes('web') || kw1.includes('fetch'), '能抽出 web_fetch 类英文词', kw1)
  assert(!kw1.includes('the') && !kw1.includes('and'), '过滤了停用词', kw1)
  assert(kw1.length > 0, '至少有一个关键词', kw1)

  const kw2 = extractEnglishKeywords('当用户调用 web_fetch 工具时使用 the')
  const sim = jaccard(kw1, kw2)
  assert(sim > 0 && sim <= 1, 'Jaccard 在 (0,1] 之间', sim)

  const same = jaccard(['a', 'b', 'c'], ['a', 'b', 'c'])
  assert(same === 1, '完全相同的两组关键词 Jaccard=1', same)

  const disjoint = jaccard(['a', 'b'], ['c', 'd'])
  assert(disjoint === 0, '完全不相交 Jaccard=0', disjoint)
}

// ===== Suite 2: Path A 检测器 =====
async function suiteDetectors() {
  section('Suite 2: Path A 统计检测器')

  // ---- 检测器 1: 失败-恢复 ----
  const events1 = mockWeiboHotEvents('turn_weibo_1', T0)
  const cands1 = detectStatisticalPatterns(events1)
  const failRecover = cands1.find(c => c.action.includes('web_fetch') && c.action.includes('web_search'))
  assert(!!failRecover, '检测器1：web_search 失败→web_fetch 成功 能识别', cands1)
  if (failRecover) {
    assert(failRecover.domain === 'tool-strategy', '  → domain = tool-strategy')
    assert(failRecover.initialConfidence === 0.5, '  → initialConfidence = 0.5')
    assert(failRecover.source === 'statistical', '  → source = statistical')
    console.log('     trigger:', failRecover.trigger)
    console.log('     action :', failRecover.action)
  }

  // ---- 检测器 2: 拒绝模式（连续 ≥3 denied）----
  const eventsDenied = mockPermissionDeniedEvents('shell_command', 4, T0)
  const candsDenied = detectStatisticalPatterns(eventsDenied)
  const denyCand = candsDenied.find(c => c.action.includes('拒绝') && c.trigger.includes('shell_command'))
  assert(!!denyCand, '检测器2：连续 4 次 denied shell_command 能识别', candsDenied)

  const eventsDeniedSmall = mockPermissionDeniedEvents('shell_command', 2, T0)
  const candsSmall = detectStatisticalPatterns(eventsDeniedSmall)
  const noDenyCand = candsSmall.find(c => c.action.includes('拒绝'))
  assert(!noDenyCand, '检测器2：仅 2 次 denied 不应触发（阈值=3）')

  // ---- 检测器 3: 信任模式（≥5 approved + 0 denied）----
  const eventsApproved = mockPermissionApprovedEvents('write_file', 6, T0)
  const candsApproved = detectStatisticalPatterns(eventsApproved)
  const trustCand = candsApproved.find(c => c.action.includes('信任') || c.action.includes('批准'))
  assert(!!trustCand, '检测器3：连续 6 次 approved write_file 能识别', candsApproved)

  // approved 但被一次 denied 污染 → 不应触发"信任"
  const mixed = [
    ...mockPermissionApprovedEvents('write_file', 6, T0),
    ...mockPermissionDeniedEvents('write_file', 1, T0 + 10000),
  ]
  const candsMixed = detectStatisticalPatterns(mixed)
  const trustOnMixed = candsMixed.find(c => c.action.includes('信任') && c.trigger.includes('write_file'))
  assert(!trustOnMixed, '检测器3：approved+denied 混合不应触发"信任"')

  // ---- 检测器 4: 重复搜索关键词 ----
  const eventsSearch = mockRepeatedSearchEvents('北大软微', 4, T0)
  const candsSearch = detectStatisticalPatterns(eventsSearch)
  const searchCand = candsSearch.find(c => c.domain === 'context-pattern')
  assert(!!searchCand, '检测器4：4 次搜索都含"北大软微"应识别为研究主题', candsSearch)
  if (searchCand) {
    console.log('     trigger:', searchCand.trigger)
  }
}

// ===== Suite 3: 演化（mergeAndEvolve） =====
async function suiteEvolve() {
  section('Suite 3: mergeAndEvolve 演化')
  resetInstinctStore()
  const inst = useInstinct()
  assert(inst.store.value.instincts.length === 0, '清空后 store 为空')

  // 首次：4 个检测器输入，应该新建若干 candidate
  const allEvents = [
    ...mockWeiboHotEvents('turn_weibo_e1', T0),
    ...mockPermissionDeniedEvents('shell_command', 3, T0 + 10000),
    ...mockPermissionApprovedEvents('write_file', 5, T0 + 20000),
  ]
  const cands = detectStatisticalPatterns(allEvents)
  console.log(`     candidates 共 ${cands.length} 条`)
  assert(cands.length >= 3, '至少产出 3 条 candidate（失败恢复 + 拒绝 + 信任）')

  const r1 = mergeAndEvolve(cands)
  console.log('     第1次 merge:', r1)
  // 注：Jaccard 去重会把关键词重叠的 candidate 合并（比如两条 tool-preference 都含 tool/preference）
  // 所以 created < cands.length 是正常去重行为，关键是总数匹配
  assert(r1.created + r1.reinforced === cands.length, `processed(${r1.created + r1.reinforced}) === cands(${cands.length})`, r1)
  assert(r1.created >= 1, '至少新建一条', r1)
  const after1 = inst.store.value.instincts.length
  assert(after1 === r1.created, `store 数量(${after1}) === 新建数(${r1.created})`)

  const firstInst = inst.store.value.instincts[0]
  assert(firstInst.confidence === 0.5, '新建 instinct 初始 confidence = 0.5', firstInst.confidence)
  assert(firstInst.observedCount === 1, '初始 observedCount = 1')

  // 第二次：同样的 candidate 喂入，应全部强化
  const r2 = mergeAndEvolve(cands)
  console.log('     第2次 merge:', r2)
  assert(r2.reinforced === cands.length, `第二次应全部强化(${cands.length})`, r2)
  assert(r2.created === 0, '第二次不应新建')

  const firstInst2 = inst.store.value.instincts.find(i => i.id === firstInst.id)!
  assert(Math.abs(firstInst2.confidence - 0.55) < 1e-9, 'confidence 应从 0.5 涨到 0.55', firstInst2.confidence)
  assert(firstInst2.observedCount === 2, 'observedCount 应从 1 涨到 2')

  // 重复演化多次直到接近上限
  for (let i = 0; i < 20; i++) mergeAndEvolve(cands)
  const firstInst3 = inst.store.value.instincts.find(i => i.id === firstInst.id)!
  assert(firstInst3.confidence === INSTINCT_CONFIG.CONFIDENCE_CAP, `多次强化后达到上限 ${INSTINCT_CONFIG.CONFIDENCE_CAP}`, firstInst3.confidence)
}

// ===== Suite 4: 注入 system prompt =====
async function suiteInject() {
  section('Suite 4: buildInstinctContext 注入')

  resetInstinctStore()
  const inst = useInstinct()

  // 1. 空 store → 返回空字符串
  let ctx = buildInstinctContext()
  assert(ctx === '', '空 store 应返回空字符串', JSON.stringify(ctx))

  // 2. 只有 confidence < 0.7 的 → 不注入
  const allEvents = mockWeiboHotEvents('turn_inj_1', T0)
  mergeAndEvolve(detectStatisticalPatterns(allEvents))
  const lowConf = inst.store.value.instincts[0]
  assert(lowConf.confidence === 0.5, '新建 instinct confidence = 0.5')
  ctx = buildInstinctContext()
  assert(ctx === '', 'confidence=0.5 不应注入', JSON.stringify(ctx))

  // 3. 把 confidence 强行拉到 0.8 → 应该注入
  lowConf.confidence = 0.8
  ctx = buildInstinctContext()
  assert(ctx.length > 0, '强行 confidence=0.8 后应注入', ctx)
  assert(ctx.includes('[行为习惯'), '注入内容应包含标题', ctx)
  assert(ctx.includes('→'), '注入内容应有 trigger → action 形式')

  console.log('\n     ↓ 实际注入到 system prompt 的内容：')
  console.log('     ────────────────────────')
  ctx.split('\n').forEach(line => console.log('     ' + line))
  console.log('     ────────────────────────')

  // 4. 加一堆超过 MAX_INJECT 的 instinct，验证截断
  for (let i = 0; i < 15; i++) {
    inst.store.value.instincts.push({
      id: `inst_bulk_${i}`,
      trigger: `测试触发器 ${i}`,
      action: `测试行为 ${i}`,
      domain: 'workflow',
      confidence: 0.75 + i * 0.005,
      source: 'statistical',
      evidence: `bulk test ${i}`,
      observedCount: 1,
      validatedCount: 0,
      lastObservedAt: T0,
      createdAt: T0,
      deprecated: false,
      keywords: [`bulk${i}`],
    })
  }
  const ctxFull = buildInstinctContext()
  const lineCount = ctxFull.split('\n').filter(l => l.startsWith('- ')).length
  assert(lineCount <= INSTINCT_CONFIG.MAX_INJECT, `注入条数 ${lineCount} <= MAX_INJECT(${INSTINCT_CONFIG.MAX_INJECT})`)

  // 5. deprecated 的不注入
  inst.store.value.instincts.forEach(i => { i.deprecated = true })
  const ctxAllDep = buildInstinctContext()
  assert(ctxAllDep === '', '全部 deprecated 后应返回空', JSON.stringify(ctxAllDep))
}

// ===== Suite 5: 衰减（decayUnusedInstincts） =====
async function suiteDecay() {
  section('Suite 5: decayUnusedInstincts 衰减')

  resetInstinctStore()
  const inst = useInstinct()

  // 制造一条 15 天前最后触发的 instinct
  const oldAt = new Date().getTime() - 15 * 24 * 3600 * 1000
  inst.store.value.instincts.push({
    id: 'inst_decay_1',
    trigger: '测试老 instinct',
    action: '测试动作',
    domain: 'workflow',
    confidence: 0.6,
    source: 'statistical',
    evidence: 'decay test',
    observedCount: 1,
    validatedCount: 0,
    lastObservedAt: oldAt,
    createdAt: oldAt,
    deprecated: false,
    keywords: ['decay', 'test'],
  })

  const before = inst.store.value.instincts[0].confidence
  const r = decayUnusedInstincts()
  console.log('     衰减结果:', r)
  const after = inst.store.value.instincts[0].confidence
  assert(Math.abs(before - after - 0.05) < 1e-9, `confidence 应衰减 0.05（${before} → ${after}）`)

  // 再衰减几次直到跌破 0.55 → deprecated
  for (let i = 0; i < 5; i++) {
    inst.store.value.instincts[0].lastObservedAt = oldAt
    decayUnusedInstincts()
  }
  assert(inst.store.value.instincts[0].deprecated, 'confidence < 0.55 后应自动 deprecated')
  console.log('     最终 confidence:', inst.store.value.instincts[0].confidence)
}

// ===== Suite 6: Jaccard 去重融合 =====
async function suiteDedupe() {
  section('Suite 6: Jaccard 跨语言去重')

  resetInstinctStore()
  const inst = useInstinct()

  // 第一条：英文关键词为主
  mergeAndEvolve([{
    trigger: '当需要调用 web_fetch 工具时',
    action: '直接用 web_fetch 抓官方页',
    domain: 'tool-strategy',
    source: 'statistical',
    evidence: 'test1',
    initialConfidence: 0.5,
  }])
  assert(inst.store.value.instincts.length === 1, '新建 1 条')

  // 第二条：中文不同但英文技术词共享 → 应被合并
  mergeAndEvolve([{
    trigger: '处理网页抓取任务时建议使用 web_fetch',
    action: '优先 web_fetch 处理网页内容',
    domain: 'tool-strategy',
    source: 'statistical',
    evidence: 'test2',
    initialConfidence: 0.5,
  }])
  console.log('     当前 store 数量:', inst.store.value.instincts.length)
  console.log('     候选关键词 vs 已有 keywords:',
    extractEnglishKeywords('处理网页抓取任务时建议使用 web_fetch 优先 web_fetch 处理网页内容 tool-strategy'),
    'vs',
    inst.store.value.instincts[0].keywords)
  const sim = jaccard(
    extractEnglishKeywords('处理网页抓取任务时建议使用 web_fetch 优先 web_fetch 处理网页内容 tool-strategy'),
    inst.store.value.instincts[0].keywords,
  )
  console.log('     Jaccard 相似度:', sim)
  assert(inst.store.value.instincts.length === 1, '高相似度 → 合并（仍为 1 条）')
  assert(inst.store.value.instincts[0].observedCount === 2, '合并后 observedCount = 2')
  assert(Math.abs(inst.store.value.instincts[0].confidence - 0.55) < 1e-9, '合并后 confidence = 0.55')

  // 第三条：完全无关 → 新建
  mergeAndEvolve([{
    trigger: '当用户要求总结时',
    action: '直接返回 markdown 摘要',
    domain: 'workflow',
    source: 'statistical',
    evidence: 'test3',
    initialConfidence: 0.5,
  }])
  assert(inst.store.value.instincts.length === 2, '无关 trigger → 新建（2 条）')
}

// ===== Suite 7: Path B LLM 语义（可选） =====
async function suiteSemantic() {
  section('Suite 7: Path B LLM 语义')
  const apiKey = process.env.DS_API_KEY
  if (!apiKey) {
    console.log('  ⚠ 未设置 DS_API_KEY 环境变量，跳过 Path B 测试')
    return
  }
  if (!apiKey.startsWith('sk-')) {
    console.log('  ⚠ DS_API_KEY 不像 DeepSeek key（应以 sk- 开头），跳过')
    return
  }

  // 给 LLM 一段含明显模式的 observation 流
  const events: ObservationEvent[] = [
    ...mockWeiboHotEvents('turn_sem_1', T0),
    ...mockWeiboHotEvents('turn_sem_2', T0 + 100000),  // 复现一次相同模式
    ...mockRepeatedSearchEvents('知乎热榜', 3, T0 + 200000),
  ]
  console.log(`  → 发送 ${events.length} 条 observation 给 deepseek-v4-flash，请稍候...`)
  const t0 = Date.now()
  const cands = await extractSemanticPatterns(events, apiKey)
  const dt = Date.now() - t0
  console.log(`  → ${dt}ms，得到 ${cands.length} 条 candidate`)

  assert(Array.isArray(cands), 'extractSemanticPatterns 返回数组')
  for (const c of cands) {
    assert(typeof c.trigger === 'string' && c.trigger.length > 0, `candidate.trigger 是非空字符串`, c)
    assert(typeof c.action === 'string' && c.action.length > 0, `candidate.action 是非空字符串`)
    assert(c.initialConfidence >= 0.4 && c.initialConfidence <= 0.7, `confidence ∈ [0.4, 0.7]: ${c.initialConfidence}`)
    assert(c.source === 'semantic', `source = semantic`)
    console.log(`     [${c.initialConfidence}] ${c.domain}`)
    console.log(`       trigger: ${c.trigger}`)
    console.log(`       action : ${c.action}`)
    console.log(`       evidence: ${c.evidence}`)
  }

  // 兜底脱敏检查
  for (const c of cands) {
    const all = c.trigger + c.action + c.evidence
    assert(!/sk-[a-z0-9]{20,}/i.test(all), 'evidence 不包含 sk- 形式的 API Key')
    assert(!/[A-Z]:\\[^\s]+/.test(all), 'evidence 不包含完整 Windows 本地路径')
  }
}

// ===== 主入口 =====
async function main() {
  console.log('🚀 Instinct Engine 端到端测试\n')
  console.log('INSTINCT_CONFIG:', INSTINCT_CONFIG)

  await suiteUtils()
  await suiteDetectors()
  await suiteEvolve()
  await suiteInject()
  await suiteDecay()
  await suiteDedupe()
  await suiteSemantic()

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`  ✅ Passed: ${passCount}`)
  console.log(`  ❌ Failed: ${failCount}`)
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━`)
  process.exit(failCount === 0 ? 0 : 1)
}

main().catch(e => {
  console.error('💥 测试脚本崩溃:', e)
  process.exit(2)
})
