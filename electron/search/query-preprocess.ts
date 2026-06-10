export function preprocessQuery(query: string): string {
  let q = query.trim().replace(/\s+/g, ' ').slice(0, 200)
  if (!q) return q

  // 仅在查询看起来像是查词/释义时添加排除词
  // 避免盲目的排除误伤政策、技术、新闻类搜索
  const isChinese = /[一-鿿]/.test(q)
  const looksLikeDictionary = /什么意思|是什么意思|含义|定义|解释|翻译|怎么读|读音|拼音|近义词|反义词|用法/.test(q)

  if (isChinese && looksLikeDictionary) {
    // 查词场景：排除词典网站干扰
    q += ' -site:dict.baidu.com -site:zdic.net'
  }

  return q
}
