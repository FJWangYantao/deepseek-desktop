/**
 * web_search tool 端到端测试（offline、确定性）。
 * 通过依赖注入把 searchWebLight/searchAll 换成 fixture，验证 tool 完整流程：
 * 变体扩展 → 抓取(假) → 去重 → 过滤 → 排序 → 片段质量过滤 → 包装成字符串。
 * 这正是 benchmark 绕过的 tool 层，闭合了"benchmark 分数 vs LLM 实际看到"的断层。
 * 用法：npx tsx tests/web-search-e2e.test.ts  或  npm test
 */
import { runWebSearch } from '../electron/tools/builtins/web-search'
import type { SearchHit } from '../electron/search/duckduckgo'

// 静默 runWebSearch 内部的 [web_search] 进度日志，保持测试输出干净
// （logger 输出格式如 "12:34:56 INFO  [web_search] ..."，所以匹配子串而非前缀）
const _log = console.log
console.log = (...a: unknown[]) => {
  if (typeof a[0] === 'string' && /\[(web_search|zhihu|tavily)\]/.test(a[0])) return
  _log(...a)
}

let passed = 0
let failed = 0
const failures: string[] = []
function check(name: string, cond: unknown, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// fixture：覆盖各分支的合成 raw
const FIXTURE: SearchHit[] = [
  { title: 'Transformer 是什么 - 官方文档', url: 'https://docs.example.com/transformer',
    snippet: 'Transformer 是一种基于自注意力机制的深度学习模型架构，由 Vaswani 等人在 2017 年提出，是现代大语言模型的基础。' },
  { title: 'Transformer 详解 - 技术博客', url: 'https://blog.example.org/transformer',
    snippet: '详解 Transformer 的注意力机制与位置编码，适合入门读者理解大模型原理与训练方法。' },
  { title: '广告垃圾页', url: 'https://ad.example.com/x',
    snippet: '立即下载 Transformer 教程，限时优惠免费领取！' },          // 广告词 → 应被过滤
  { title: '短片段页', url: 'https://short.example.com', snippet: '很短' }, // <20 字符 → 应被过滤
]

const fakeSearch = async (): Promise<SearchHit[]> => FIXTURE
const fakeZhihuFull = async () => ({
  zhihu: [{ title: '知乎深度回答', url: 'https://zhihu.com/question/123/answer/456',
    snippet: '这是一个用于测试的知乎回答摘要，长度需要超过五十个字符的过滤门槛，所以这里多写一些内容来确保它能够被正常展示在知乎结果分支里。', source: '站内' }],
  global: [],
})
const fakeZhihuEmpty = async () => ({ zhihu: [], global: [] })

console.log('\n[1] 基本流程：标签 + 好结果保留 + 广告/短片段过滤')
{
  const out = await runWebSearch(['Transformer 是什么'], undefined, { search: fakeSearch, zhihu: fakeZhihuFull })
  check('含【搜索结果】标签', out.includes('【搜索结果】'))
  check('保留好结果 docs.example.com', out.includes('docs.example.com'))
  check('保留好结果 blog.example.org', out.includes('blog.example.org'))
  check('过滤广告词（不含 立即下载）', !out.includes('立即下载'))
  check('过滤短片段（不含 很短）', !out.includes('很短'))
}

console.log('\n[2] 知乎分支：摘要格式 + 请勿抓取提示')
{
  const out = await runWebSearch(['Transformer 是什么'], undefined, { search: fakeSearch, zhihu: fakeZhihuFull })
  check('含【知乎】标签', out.includes('【知乎】'))
  check('含请勿调用 web_fetch 提示', out.includes('请勿调用 web_fetch'))
  check('含知乎摘要', out.includes('zhihu.com'))
}

console.log('\n[3] 多查询去重：同一 url 跨查询只出现一次')
{
  const out = await runWebSearch(['Transformer 是什么', 'transformer architecture'], undefined, { search: fakeSearch, zhihu: fakeZhihuEmpty })
  const count = (out.match(/docs\.example\.com/g) || []).length
  check('docs.example.com 只出现 1 次（去重生效）', count === 1, `实际 ${count} 次`)
}

console.log('\n[4] sites 限定：标签变化 + 不查知乎')
{
  const out = await runWebSearch(['Transformer'], ['gov.cn'], { search: fakeSearch, zhihu: fakeZhihuFull })
  check('含【限定域名: gov.cn】标签', out.includes('【限定域名: gov.cn】'))
  check('site 限定时不查知乎', !out.includes('【知乎】'))
}

console.log('\n[5] 空结果：兜底文案')
{
  const out = await runWebSearch(['Transformer 是什么'], undefined, { search: async () => [], zhihu: fakeZhihuEmpty })
  check('空结果给兜底提示', out.includes('未找到') && out.includes('建议'))
}

console.log('\n[6] policy fallback：法规精确结果应排在泛“数据”结果前')
{
  const policyHits: SearchHit[] = [
    { title: '国家数据', url: 'https://data.stats.gov.cn/',
      snippet: '相关链接 统计法规 标准制度 统计数据生产过程 版权所有：国家统计局。' },
    { title: '数据（计算机术语）_百度百科', url: 'https://baike.baidu.com/item/data',
      snippet: '数据是事实或观察的结果，是对客观事物的逻辑归纳。' },
    { title: '中华人民共和国数据安全法', url: 'https://www.npc.gov.cn/law/data-security-law',
      snippet: '中华人民共和国数据安全法全文，规范数据处理活动，保障数据安全，促进数据开发利用。' },
  ]
  const out = await runWebSearch(['数据安全法 主要内容'], undefined, { search: async () => policyHits, zhihu: fakeZhihuEmpty })
  const lawIdx = out.indexOf('中华人民共和国数据安全法')
  const genericIdx = out.indexOf('国家数据')
  check('法规精确结果排在泛数据结果前', lawIdx >= 0 && genericIdx >= 0 && lawIdx < genericIdx,
    `lawIdx=${lawIdx}, genericIdx=${genericIdx}`)
}

console.log(`\n${failed === 0 ? '✓' : '✗'} ${passed} passed, ${failed} failed`)
if (failed > 0) { console.log('\n失败项：'); failures.forEach(f => console.log('  - ' + f)) }
process.exit(failed > 0 ? 1 : 0)
