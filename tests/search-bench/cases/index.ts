/**
 * 搜索 benchmark 测试用例
 *
 * 每条 case 描述一个 query 加可选的期望（expectations），用作启发式指标的硬断言。
 * - intent：分类，对应 web-search.ts:classifyQuery 的 7 类，确保各类覆盖均衡
 * - expectations.noiseRateMax：噪声率上限（命中黑名单 + 广告关键词的占比）
 * - expectations.minUniqueDomains：top-10 应当至少来自 N 个不同域名
 * - expectations.forbiddenDomains：硬约束，出现即扣分
 * - expectations.expectKeywords：title/snippet 中应当至少命中其中一个关键词（衡量基本召回）
 *
 * 期望都是经验值，目的是「看到回归」，不要追求完美阈值。
 */
export interface BenchCase {
  id: string
  query: string
  intent: 'definitional' | 'howto' | 'comparison' | 'news' | 'factual' | 'policy' | 'generic' | 'regression'
  expectations?: {
    noiseRateMax?: number
    minUniqueDomains?: number
    forbiddenDomains?: string[]
    expectKeywords?: string[]
  }
}

export const cases: BenchCase[] = [
  // ===== definitional =====
  { id: 'def-1', query: 'Transformer 是什么', intent: 'definitional',
    expectations: { noiseRateMax: 0.2, forbiddenDomains: ['dict.baidu.com', 'zdic.net'], expectKeywords: ['Transformer', '注意力', 'attention'] } },
  { id: 'def-2', query: 'RAG 含义', intent: 'definitional',
    expectations: { noiseRateMax: 0.2, expectKeywords: ['检索', 'retrieval', '生成'] } },
  { id: 'def-3', query: '量子退火 概念', intent: 'definitional',
    expectations: { noiseRateMax: 0.2, expectKeywords: ['量子', '退火', '原理', '计算'] } },
  { id: 'def-4', query: 'WebAssembly 是什么', intent: 'definitional',
    expectations: { noiseRateMax: 0.2, expectKeywords: ['WebAssembly', 'wasm', '字节码'] } },
  { id: 'def-5', query: 'gRPC 定义', intent: 'definitional',
    expectations: { noiseRateMax: 0.2, expectKeywords: ['gRPC', 'RPC', 'protobuf'] } },

  // ===== howto =====
  { id: 'how-1', query: 'Vue3 Composition API 怎么用', intent: 'howto',
    expectations: { noiseRateMax: 0.2, expectKeywords: ['Composition', '组件', '响应式'] } },
  { id: 'how-2', query: 'docker volume 如何挂载', intent: 'howto',
    expectations: { noiseRateMax: 0.2, expectKeywords: ['volume', '挂载', '-v'] } },
  { id: 'how-3', query: 'pytorch 训练循环 教程', intent: 'howto',
    expectations: { noiseRateMax: 0.25, expectKeywords: ['pytorch', '训练', '神经网络', '模型'] } },
  { id: 'how-4', query: 'nginx 反向代理 配置 步骤', intent: 'howto',
    expectations: { noiseRateMax: 0.2, expectKeywords: ['nginx', '反向', '服务器', '配置'] } },
  { id: 'how-5', query: 'python 虚拟环境 创建方法', intent: 'howto',
    expectations: { noiseRateMax: 0.2, expectKeywords: ['venv', '虚拟环境', 'virtualenv'] } },

  // ===== comparison =====
  { id: 'cmp-1', query: 'PostgreSQL 和 MySQL 区别', intent: 'comparison',
    expectations: { noiseRateMax: 0.2, expectKeywords: ['PostgreSQL', 'MySQL', '区别'] } },
  { id: 'cmp-2', query: 'React vs Vue 对比', intent: 'comparison',
    expectations: { noiseRateMax: 0.2, expectKeywords: ['React', 'Vue'] } },
  { id: 'cmp-3', query: 'gRPC 和 REST 差异', intent: 'comparison',
    expectations: { noiseRateMax: 0.2, expectKeywords: ['gRPC', 'REST'] } },
  { id: 'cmp-4', query: 'TCP 和 UDP 区别', intent: 'comparison',
    expectations: { noiseRateMax: 0.2, expectKeywords: ['TCP', 'UDP'] } },
  { id: 'cmp-5', query: 'Redis 和 Memcached 比较', intent: 'comparison',
    expectations: { noiseRateMax: 0.2, expectKeywords: ['Redis', 'Memcached'] } },

  // ===== news（标记为时间敏感，会随时间漂移；快照对比时人工看就行） =====
  { id: 'news-1', query: 'OpenAI 最新发布', intent: 'news',
    expectations: { noiseRateMax: 0.3, expectKeywords: ['OpenAI'] } },
  { id: 'news-2', query: 'NVIDIA 最新 GPU 消息', intent: 'news',
    expectations: { noiseRateMax: 0.3, expectKeywords: ['NVIDIA', '英伟达'] } },
  { id: 'news-3', query: '苹果 最新发布会', intent: 'news',
    expectations: { noiseRateMax: 0.3, expectKeywords: ['苹果', 'Apple'] } },
  { id: 'news-4', query: 'AI 监管 最新动态', intent: 'news',
    expectations: { noiseRateMax: 0.35 } },
  { id: 'news-5', query: '比特币 价格 今日', intent: 'news',
    expectations: { noiseRateMax: 0.35, expectKeywords: ['比特币', '行情', '价格'] } },

  // ===== factual =====
  { id: 'fact-1', query: '鲁迅 出生年份', intent: 'factual',
    expectations: { noiseRateMax: 0.2, expectKeywords: ['1881', '鲁迅'] } },
  { id: 'fact-2', query: '珠穆朗玛峰 海拔 多少', intent: 'factual',
    expectations: { noiseRateMax: 0.2, expectKeywords: ['8848', '珠穆朗玛'] } },
  { id: 'fact-3', query: '哈勃望远镜 发射时间', intent: 'factual',
    expectations: { noiseRateMax: 0.2, expectKeywords: ['1990', '哈勃'] } },
  { id: 'fact-4', query: 'Linux 内核 创始人 是谁', intent: 'factual',
    expectations: { noiseRateMax: 0.2, expectKeywords: ['Linus', 'Torvalds', '托瓦兹'] } },
  { id: 'fact-5', query: '光速 数值', intent: 'factual',
    expectations: { noiseRateMax: 0.2, expectKeywords: ['299792458', '光速', '30万'] } },

  // ===== policy =====
  { id: 'pol-1', query: '个人信息保护法 全文', intent: 'policy',
    expectations: { noiseRateMax: 0.2, expectKeywords: ['个人信息', '保护法'] } },
  { id: 'pol-2', query: '数据安全法 主要内容', intent: 'policy',
    expectations: { noiseRateMax: 0.2, expectKeywords: ['数据安全'] } },
  { id: 'pol-3', query: '生成式人工智能服务管理办法', intent: 'policy',
    expectations: { noiseRateMax: 0.2, expectKeywords: ['生成式', '人工智能', '管理'] } },
  { id: 'pol-4', query: '医疗保障基金 监管 条例', intent: 'policy',
    expectations: { noiseRateMax: 0.25, expectKeywords: ['医保', '监管'] } },
  { id: 'pol-5', query: '网络安全法 通过时间', intent: 'policy',
    expectations: { noiseRateMax: 0.2, expectKeywords: ['网络安全', '2016'] } },

  // ===== generic（事实性偏八卦/通用，用来测兜底分支） =====
  { id: 'gen-1', query: '黄仁勋 女儿 订婚', intent: 'generic',
    expectations: { noiseRateMax: 0.3, expectKeywords: ['黄仁勋', '女儿'] } },
  { id: 'gen-2', query: '马斯克 推特 收购 价格', intent: 'generic',
    expectations: { noiseRateMax: 0.3, expectKeywords: ['马斯克', '推特', 'Twitter'] } },
  { id: 'gen-3', query: 'OpenAI Sam Altman 履历', intent: 'generic',
    expectations: { noiseRateMax: 0.3, expectKeywords: ['Altman', 'OpenAI'] } },
  { id: 'gen-4', query: 'GTA6 发布 时间', intent: 'generic',
    expectations: { noiseRateMax: 0.3, expectKeywords: ['GTA', '发布'] } },
  { id: 'gen-5', query: '诺贝尔物理学奖 2024', intent: 'generic',
    expectations: { noiseRateMax: 0.25, expectKeywords: ['诺贝尔', 'Nobel', '物理'] } },

  // ===== regression（历史踩坑用例：每次出新 bug 就追加） =====
  { id: 'reg-1', query: '2027年二十一大可能议题', intent: 'regression',
    expectations: {
      noiseRateMax: 0.2,
      forbiddenDomains: ['dict.baidu.com', 'zdic.net', 'csdn.net', 'baijiahao.baidu.com'],
      minUniqueDomains: 5,
    } },
  { id: 'reg-2', query: '什么是大模型', intent: 'regression',
    expectations: {
      noiseRateMax: 0.2,
      forbiddenDomains: ['dict.baidu.com', 'zdic.net', 'iciba.com'],
      expectKeywords: ['大模型', 'LLM', '语言'],
    } },
]
