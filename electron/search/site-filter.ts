import type { SearchHit } from './duckduckgo'

/**
 * 完全排除：词典/工具类站点 + CSDN，对绝大部分搜索意图都是噪声
 * - 词典站：即便用户是查词，正经词义也能从更高质量的页面（百度百科、维基百科）拿到
 * - CSDN：从降权升级为完全排除——实测它频繁挤进 top（同域≤2 补足逻辑会把它捞回），
 *   且常字面误命中（如搜"比特币"命中 CSDN 的"bit/byte/KB"文章），噪声价值大于信息价值。
 *   若某 query 确实只有 CSDN 有答案，用户可换关键词或加 site: 限定。
 */
const EXCLUDED_DOMAINS = [
  // 词典站
  'dict.baidu.com', 'hanyu.baidu.com', 'baike.baidu.hk',
  'zdic.net', 'dict.cn', 'dictall.com', 'iciba.com',
  'youdao.com', 'fanyi.youdao.com', 'dict.youdao.com',
  'haici.com', 'cidianwang.com', 'chazidian.com',
  'qianp.com', 'guoxuedashi.com',
  'dictionary.com', 'merriam-webster.com',
  'translate.google.com',
  // 内容农场（曾降权，现完全排除）
  'csdn.net', 'blog.csdn.net',
]

/**
 * 降权（不删除，但排到末尾）：内容农场 / SEO 站 / 二次聚合
 * 这类站点偶尔有可用信息，所以不直接删，但默认放到结果末尾
 */
const LOW_QUALITY_DOMAINS = [
  'wenku.baidu.com', 'doc.mbalib.com', 'docin.com', 'doc88.com',
  'jianshu.com',
  'toutiao.com',  // 标题党+大量低质转载
  'sohu.com',     // 搜狐号 SEO 农场
  '163.com',      // 网易号同样 SEO 重灾
  'ifeng.com',
  'baijiahao.baidu.com',
  'kuaibao.qq.com',
  'sm.ms', 'tieba.baidu.com',
  'zhihu-tw.com', 'zhuanlan.zhihu.com',  // 知乎专栏单独走知乎管线，去重
]

/**
 * SEO 内容农场常见关键词域名片段（包含即降权）
 * 命中其一的域名都按低质处理
 */
const SEO_FARM_PATTERNS = [
  /^[a-z0-9-]{1,4}\.cn$/,                    // 短域名 SEO 站
  /(daquan|baike|zhishi|wenda)\d*\.(cn|com)$/, // xx大全 / xx百科 / xx知识 / xx问答
  /\.(net|cn|com)\.cn$/,                     // 多重 TLD 的二级目录站（很多 SEO 站）
]

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

function matchesDomain(domain: string, list: string[]): boolean {
  return list.some(d => domain === d || domain.endsWith('.' + d))
}

function looksLikeSeoFarm(domain: string): boolean {
  return SEO_FARM_PATTERNS.some(p => p.test(domain))
}

export function filterResults(results: SearchHit[]): SearchHit[] {
  const filtered: SearchHit[] = []
  const lowQuality: SearchHit[] = []

  for (const r of results) {
    const domain = getDomain(r.url)
    if (matchesDomain(domain, EXCLUDED_DOMAINS)) continue
    if (matchesDomain(domain, LOW_QUALITY_DOMAINS) || looksLikeSeoFarm(domain)) {
      lowQuality.push(r)
      continue
    }
    filtered.push(r)
  }

  return [...filtered, ...lowQuality]
}
