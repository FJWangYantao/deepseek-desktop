/**
 * 启发式 judges：完全本地计算，零成本，零外部依赖。
 * 每个 judge 接收一组 SearchHit（结构上对应底层 searchWebLight 返回的形状），
 * 返回 0..1 区间的得分（1=完美），便于不同维度合成总分。
 */

export interface SearchHitLike {
  title: string
  url: string
  snippet: string
}

/** 已知的高噪声域名（与 site-filter.ts 保持口径一致；这里独立维护，避免互改导致 benchmark 变得"自评满分"） */
const NOISE_DOMAINS = new Set([
  // 词典
  'dict.baidu.com', 'hanyu.baidu.com', 'zdic.net', 'dict.cn',
  'iciba.com', 'youdao.com', 'haici.com', 'cidianwang.com',
  'chazidian.com', 'qianp.com', 'guoxuedashi.com',
  'dictionary.com', 'merriam-webster.com', 'translate.google.com',
  // 内容农场
  'wenku.baidu.com', 'doc.mbalib.com', 'docin.com', 'doc88.com',
  'csdn.net', 'jianshu.com', 'toutiao.com',
  'baijiahao.baidu.com', 'kuaibao.qq.com',
])

const AD_KEYWORDS = /(立即下载|马上下载|点击进入|点击查看|限时优惠|限时折扣|0元领|免费领取|官方授权|加微信|加客服|私聊|在线咨询|了解详情|咨询报价|官网入口)/

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

function isNoiseDomain(domain: string): boolean {
  if (NOISE_DOMAINS.has(domain)) return true
  for (const d of NOISE_DOMAINS) {
    if (domain.endsWith('.' + d)) return true
  }
  return false
}

/**
 * 噪声率：命中黑名单或广告诱导词的结果占比。
 * 越低越好；judge 输出 = 1 - rate。
 */
export function judgeNoiseRate(hits: SearchHitLike[]): { score: number; details: { rate: number; hitsHit: string[] } } {
  if (hits.length === 0) return { score: 0, details: { rate: 0, hitsHit: [] } }
  const hitsHit: string[] = []
  for (const h of hits) {
    const domain = getDomain(h.url)
    const isAd = AD_KEYWORDS.test(h.title) || AD_KEYWORDS.test(h.snippet)
    if (isNoiseDomain(domain) || isAd) hitsHit.push(`${domain} | ${h.title.slice(0, 40)}`)
  }
  const rate = hitsHit.length / hits.length
  return { score: 1 - rate, details: { rate, hitsHit } }
}

/**
 * 域名多样性：top-N 来自多少个不同二级域名。
 * 评分曲线：3 个以下 = 0.3；3-5 = 线性升到 0.7；6+ = 0.85；8+ = 1.0
 */
export function judgeDomainDiversity(hits: SearchHitLike[], topN = 10): { score: number; details: { uniqueDomains: number; domains: string[] } } {
  const top = hits.slice(0, topN)
  const domains = [...new Set(top.map(h => getDomain(h.url)).filter(Boolean))]
  const n = domains.length
  let score: number
  if (n <= 2) score = 0.3
  else if (n <= 5) score = 0.3 + (n - 2) * 0.4 / 3
  else if (n <= 7) score = 0.7 + (n - 5) * 0.15 / 2
  else score = Math.min(1, 0.85 + (n - 7) * 0.05)
  return { score, details: { uniqueDomains: n, domains } }
}

/**
 * 片段信息量：top-10 平均 snippet 长度。
 * <30 字 = 0；30-80 = 线性升到 0.6；80-150 = 0.6-0.9；>150 = 1.0
 */
export function judgeSnippetRichness(hits: SearchHitLike[], topN = 10): { score: number; details: { avgLen: number } } {
  const top = hits.slice(0, topN)
  if (top.length === 0) return { score: 0, details: { avgLen: 0 } }
  const avgLen = top.reduce((s, h) => s + (h.snippet?.length ?? 0), 0) / top.length
  let score: number
  if (avgLen < 30) score = 0
  else if (avgLen < 80) score = (avgLen - 30) * 0.6 / 50
  else if (avgLen < 150) score = 0.6 + (avgLen - 80) * 0.3 / 70
  else score = 1
  return { score, details: { avgLen: Math.round(avgLen) } }
}

/**
 * 期望关键词召回：title/snippet 中命中的关键词比例。
 *
 * 自动剔除"出现在 query 文本里的词"——这类词搜索引擎必然命中（它就是按这些词搜的），
 * 命中它不构成有效信号；只对 query 之外的"答案信号词"（如 fact 类的年份 '1881'、
 * howto 类的 'proxy_pass'）算召回，结果才真正反映"是否回答了 query"，而不是"是否
 * 重复了 query 自己的词"。
 *
 * 评分 = 命中的显著词 / 显著词总数（连续值，有区分度）；全是 query 词（无显著词）时
 * 退化为全量比例。没有给 expectKeywords 时返回 null（不计入总分）。
 */
export function judgeKeywordRecall(
  hits: SearchHitLike[],
  keywords: string[] | undefined,
  query: string,
  topN = 10,
): { score: number; details: { hitCount: number; evaluatedKeywords: string[]; missedKeywords: string[] } } | null {
  if (!keywords || keywords.length === 0) return null
  const top = hits.slice(0, topN)
  if (top.length === 0) return { score: 0, details: { hitCount: 0, evaluatedKeywords: keywords, missedKeywords: keywords } }

  const queryLower = query.toLowerCase()
  const significant = keywords.filter(k => !queryLower.includes(k.toLowerCase()))
  // 全是 query 词（无显著词）时退化为全量，避免分母为 0
  const evaluated = significant.length > 0 ? significant : keywords

  const lowerHits = top.map(h => `${h.title} ${h.snippet}`.toLowerCase())
  const hitKeywords = evaluated.filter(k => {
    const lk = k.toLowerCase()
    return lowerHits.some(text => text.includes(lk))
  })
  const score = hitKeywords.length / evaluated.length
  const missedKeywords = evaluated.filter(k => !hitKeywords.includes(k))
  return { score, details: { hitCount: hitKeywords.length, evaluatedKeywords: evaluated, missedKeywords } }
}

/**
 * 硬约束：结果中是否出现 forbiddenDomains。
 * 命中视为严重退化，直接 0 分；否则 1 分。
 */
export function judgeForbiddenDomains(hits: SearchHitLike[], forbidden: string[] | undefined): { score: number; details: { hitDomains: string[] } } | null {
  if (!forbidden || forbidden.length === 0) return null
  const hitDomains: string[] = []
  for (const h of hits) {
    const domain = getDomain(h.url)
    for (const f of forbidden) {
      if (domain === f || domain.endsWith('.' + f)) {
        hitDomains.push(domain)
        break
      }
    }
  }
  return { score: hitDomains.length === 0 ? 1 : 0, details: { hitDomains: [...new Set(hitDomains)] } }
}
