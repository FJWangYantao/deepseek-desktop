import type { LocalSearchItem } from './types'

function jaccard(a: string, b: string): number {
  const sa = new Set(a.split(''))
  const sb = new Set(b.split(''))
  let intersection = 0
  for (const c of sa) { if (sb.has(c)) intersection++ }
  return intersection / (sa.size + sb.size - intersection)
}

export function deduplicateAcrossSources(items: LocalSearchItem[]): LocalSearchItem[] {
  const groups: LocalSearchItem[][] = []
  const used = new Set<number>()

  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue
    const group = [items[i]]
    used.add(i)

    for (let j = i + 1; j < items.length; j++) {
      if (used.has(j)) continue
      if (items[i].source === items[j].source) continue
      if (jaccard(items[i].title, items[j].title) > 0.5) {
        group.push(items[j])
        used.add(j)
      }
    }
    groups.push(group)
  }

  return groups.map(group => {
    // 取热度最高的条目作为代表，跨源加权
    const sourceCount = new Set(group.map(g => g.source)).size
    const best = group.reduce((a, b) => a.score > b.score ? a : b)
    return {
      ...best,
      score: best.score * sourceCount,
    }
  }).sort((a, b) => b.score - a.score)
}
