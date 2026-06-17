/**
 * web_search 工具层纯函数测试 — classifyQuery（意图分类）+ expandQueries（查询变体扩展）。
 * 用法：npx tsx tests/web-search-units.test.ts  或  npm test
 *
 * 这是 web_search tool 在"抓取之前"的那层逻辑——benchmark 完全没覆盖。
 * 断言锁定"函数当前行为"作为回归基线；改正则时这里会先红。
 */
import { classifyQuery, expandQueries } from '../electron/tools/builtins/web-search'

let passed = 0
let failed = 0
const failures: string[] = []
function check(name: string, cond: unknown, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

console.log('\n[1] classifyQuery — 意图分类')
{
  check('"是什么" → definitional', classifyQuery('Transformer 是什么') === 'definitional')
  check('"概念" → definitional', classifyQuery('量子退火 概念') === 'definitional')
  check('"怎么" → howto', classifyQuery('Vue3 怎么用') === 'howto')
  check('"教程" → howto', classifyQuery('pytorch 训练循环 教程') === 'howto')
  check('"区别" → comparison', classifyQuery('PostgreSQL 和 MySQL 区别') === 'comparison')
  check('"vs" → comparison', classifyQuery('React vs Vue 对比') === 'comparison')
  check('"最新" → news', classifyQuery('OpenAI 最新发布') === 'news')
  check('"今日" → news', classifyQuery('比特币 价格 今日') === 'news')
  check('"多少" → factual', classifyQuery('珠穆朗玛峰 海拔 多少') === 'factual')
  check('"办法" → policy', classifyQuery('生成式人工智能服务管理办法') === 'policy')
  check('"数据安全法 主要内容" → policy（法律名 + 主要内容）', classifyQuery('数据安全法 主要内容') === 'policy')
  // 已知分类缺口：缺关键词的 factual/policy query 落到 generic（改正则时更新）
  check('"出生年份" → factual', classifyQuery('鲁迅 出生年份') === 'factual')
  check('"光速 数值" → factual', classifyQuery('光速 数值') === 'factual')
}

console.log('\n[2] expandQueries — 变体扩展')
{
  check('howto 加"教程 方法"', expandQueries('Vue3 怎么用').includes('Vue3 用 教程 方法'))
  check('howto 保留原始查询', expandQueries('Vue3 怎么用')[0] === 'Vue3 怎么用')
  check('news 加门户 site 限定', expandQueries('OpenAI 最新发布').some(v => v.includes('site:sina.com.cn')))
  check('policy 加"全文"', expandQueries('生成式人工智能服务管理办法').includes('生成式人工智能服务管理办法 全文'))
  check('policy 加 gov.cn 官方源 fallback', expandQueries('数据安全法 主要内容').some(v => v.includes('site:gov.cn')))
  check('policy 加 npc.gov.cn 法规源 fallback', expandQueries('数据安全法 主要内容').some(v => v.includes('site:npc.gov.cn')))
  check('policy 提取法规核心名加全文', expandQueries('数据安全法 主要内容').includes('数据安全法 全文'))
  check('policy 补中华人民共和国前缀', expandQueries('数据安全法 主要内容').includes('中华人民共和国数据安全法'))
  check('definitional 不扩展', expandQueries('Transformer 是什么').length === 1)
  check('英文查询不扩展', expandQueries('Transformer architecture').length === 1)
  check('sites 限定时不自动扩展', expandQueries('OpenAI', ['openai.com']).length === 1)
  check('sites 限定加 site:', expandQueries('OpenAI', ['openai.com'])[0].includes('site:openai.com'))
}

console.log(`\n${failed === 0 ? '✓' : '✗'} ${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.log('\n失败项：')
  failures.forEach(f => console.log('  - ' + f))
}
process.exit(failed > 0 ? 1 : 0)
