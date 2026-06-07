export function preprocessQuery(query: string): string {
  let q = query.trim().replace(/\s+/g, ' ').slice(0, 200)
  if (!q) return q

  const isChinese = /[一-鿿]/.test(q)
  if (isChinese) {
    q += ' -词典 -释义 -字典 -百科定义'
  } else {
    q += ' -define -definition -meaning -dictionary'
  }
  return q
}
