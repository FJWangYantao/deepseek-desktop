import type { DataSource } from '../types'
import { weiboSource } from './weibo'
import { zhihuSource } from './zhihu'
import { bilibiliSource } from './bilibili'
import { baiduSource } from './baidu'
import { toutiaoSource } from './toutiao'
import { sinaFinanceSource } from './sina-finance'
import { githubSource } from './github'
import { hackernewsSource } from './hackernews'

export const allSources: DataSource[] = [
  weiboSource,
  zhihuSource,
  bilibiliSource,
  baiduSource,
  toutiaoSource,
  sinaFinanceSource,
  githubSource,
  hackernewsSource,
]
