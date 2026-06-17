# 搜索 Benchmark

衡量 `web_search` 搜索管线的输出质量,用于在改动 search/site-filter/query-preprocess 等代码后**对比前后效果**。

## 跑法

```bash
# 跑全部 case(约 70 秒,串行调网络,纯启发式 0 成本)
npm run bench:search

# 启用 LLM judge(默认走 DeepSeek)
set DEEPSEEK_API_KEY=sk-xxx
npm run bench:search -- --llm

# 只跑某类
npx tsx tests/search-bench/runner.ts --intent=howto

# 只跑前 5 条(快速验证)
npx tsx tests/search-bench/runner.ts --limit=5

# 与基线快照对比
npx tsx tests/search-bench/runner.ts --diff=baseline.json

# 把当前结果保存为基线(典型流程:先在 main 跑一次保存,改完后 diff)
npx tsx tests/search-bench/runner.ts --save=baseline
```

### 切换 LLM 评审模型

LLM judge 走 OpenAI 兼容协议,通过 3 个环境变量切端点。任意中转(RightCode、One-API、自建反代)、官方 OpenAI、阿里百炼、字节 Doubao 都行:

```bash
# Windows cmd
set LLM_JUDGE_BASE_URL=https://your-endpoint/v1/chat/completions
set LLM_JUDGE_API_KEY=sk-xxx
set LLM_JUDGE_MODEL=claude-opus-4-8
npm run bench:search -- --llm

# Git Bash / *nix
export LLM_JUDGE_BASE_URL=...
```

**用 RightCode 的 Claude 通道**(裁判用 Claude 的优点:幻觉低、JSON 输出更稳、对中文 query 的判断更细):

```cmd
set LLM_JUDGE_BASE_URL=https://right.codes/claude-aws/v1/chat/completions
set LLM_JUDGE_API_KEY=sk-你的-rightcode-key
set LLM_JUDGE_MODEL=claude-opus-4-8
npm run bench:search -- --llm --limit=5
```

> URL 末尾是否带 `/v1/chat/completions` 看 RightCode 文档而定;如果端点本身已经是 chat 兼容根路径,就把完整路径填进去。先用 `--limit=5` 试一次,观察控制台 `[llm-judge]` 的报错(401/404/JSON 解析失败)再调整。

不同 provider 的缓存彼此独立(hashKey 包含 model 名),换模型不会读到旧分。

## 离线 replay（改 filter/rank/judge 后做确定性对比）

默认每次跑都打实时网络，结果随搜索引擎漂移——你改了一条 filter 规则，diff 显示 +2%，却分不清是你的规则生效了还是 DDG 今天心情好。

replay 把搜索拆成两段：

- **阶段A**（打网络，会漂移）：`preprocessQuery` + `searchWebLight` → 产出 `raw` hits
- **阶段B**（纯本地，确定性）：`filterResults` + `scoreAndRank` + 所有 judge

fixture 冻结阶段A的产物。之后改阶段B的代码，用 replay 重放，diff 的每一格变化都纯粹来自你的改动——零网络、秒级、可复现。

### 典型工作流

```bash
# 1) 在稳定基线上打一次网络，把 raw 冻结成 fixture
npx tsx tests/search-bench/runner.ts --save-fixture=base

# 2) 改 site-filter / rank / judge 代码

# 3) 反复 replay 验证效果，零网络秒级
npx tsx tests/search-bench/runner.ts --replay=base

# 4) replay 出来的结果再和某次结果快照对比
npx tsx tests/search-bench/runner.ts --replay=base --diff=baseline.json
```

> `--save-fixture` 与 `--replay` 互斥（一个写、一个读 fixture）。`--llm` 可与 `--replay` 叠用（LLM 读的是阶段B产出的 hits，仍确定性，且有独立缓存）。

### replay 的边界（重要）

replay **只覆盖阶段B**。改了下面这些（影响抓取本身），fixture 里的 raw 就过时了，必须重新 `--save-fixture` 重抓：

- `electron/search/query-preprocess.ts`（query 改写）
- `electron/search/duckduckgo.ts`（抓取 + 解析，含 `searchWebLight`）
- `cases/index.ts` 里 case 的 `query` 本身

改 `site-filter.ts` / `rank.ts` / judges / runner 合成逻辑 → 直接 replay，无需重抓。

### fixture 进 git

`fixtures/<name>.json` **应该提交**——它是确定性的测试原料，团队共享、跨机器一致；和 `snapshots/`（每次跑的临时成品，已 gitignore）相反。fixture 只含公开搜索结果的 title/url/snippet，无敏感信息。

## 产出

每次跑都会在 `snapshots/` 下生成两份文件:

- `report-<时间戳>.md` — 人类可读的 markdown 报告
- `snapshot-<时间戳>.json` — 结构化 JSON,用作下次的 baseline

## 指标

| 指标 | 含义 | 满分条件 |
|---|---|---|
| **噪声** | 1 − 命中黑名单/广告关键词的比例 | 没有词典/SEO 农场/广告条 |
| **多样性** | top-10 不同二级域名数 | ≥ 8 个不同域名 |
| **信息量** | top-10 平均 snippet 字符数 | ≥ 150 字符 |
| **召回** | 答案信号词命中比例（自动排除 query 本身的词） | query 之外的答案词出现在 top-10 |
| **禁域** | 不命中 forbiddenDomains 的比例 | 黑名单完全不出现 |
| **LLM judge**(可选) | 让模型按 4 个子项打分:relevance/answerable/credibility/freshness | 平均 ≥ 0.8 |

总分 = 上述项的算术平均(召回/LLM 无对应输入时不计)；**禁域为硬约束：命中禁用域的 case overall 直接归零**（不进平均，避免被软指标稀释）。

### LLM judge 子项

| 子项 | 看什么 |
|---|---|
| relevance | top-N 整体跟 query 是不是讲一回事 |
| answerable | 仅看 snippet,用户能不能拿到答案 |
| credibility | 来源整体可信度(官方文档 vs SEO 农场) |
| freshness | 仅 news/factual 类,信息是否够新 |

LLM judge 抓的是启发式抓不到的:**字面相关但答非所问**、**snippet 关键词没命中但实际等价表达**、**域名没进黑名单但来源仍不靠谱**。

成本控制:
- 默认 off,加 `--llm` 才走网络
- 命中缓存(`.llm-cache/<sha1>.json`)时不再调 API,改 search 代码导致 hits 变化才会重打分
- 全跑约 30 个 case 调 LLM,DeepSeek-Chat ≈ 0.05 元;后续跑全部走缓存。

## 加新 case

在 `cases/index.ts` 里追加。最重要的是 **regression 类**——你之前发现搜索踩坑的 query,加进去后未来回归会被立刻抓住。

最小例子:

```ts
{ id: 'reg-3', query: 'xxx', intent: 'regression',
  expectations: { forbiddenDomains: ['some-bad-site.com'] } },
```

## 不做什么

- **不接 npm test**:外部依赖太多(网络、引擎封 IP),手动跑就好。
- **不做严格回归门禁**:报告失败 case 数和 diff,具体 PR 是否通过由人判断。
- **不让 LLM judge 跑在每次提交上**:虽然便宜,但不必要;只在改了 search 管线时跑一次确认。
