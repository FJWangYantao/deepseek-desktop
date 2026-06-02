# DeepSeek Desktop 开发备忘录

## 已实现

### 联网搜索
- 搜索引擎：Bing CN（`cn.bing.com`），纯正则解析，国内可用
- 查询优化：DeepSeek Flash 生成 2-3 个多角度搜索词，并行搜索
- 智能判断：Flash 先判断是否需要搜索（Y/N），不浪费搜索次数
- URL 抓取：自动识别 URL 并抓取网页内容（无需开关），cheerio 提取正文
- 提取上限：单页 30KB，每词抓 4 页，合并去重上限 10 条
- 开关位置：ChatInput 底部，ModelSelector 右侧
- 日期注入：每轮 system 消息注入当前日期 + 搜索状态

### UI
- 侧栏左上角：DeepSeek Desktop 品牌名 + 收起按钮
- 侧栏左下角：统计 + 设置按钮
- 应用图标：DeepSeek 官方 icon（`electron/icon_dl.ico`）

## 待实现

### 伪多模态（图片理解）
- 方案：用户上传/粘贴图片 → 多模态模型解读 → 解读文本注入 DeepSeek → 回答
- 待定：
  - [ ] 多模态模型选型（GPT-4o / Qwen-VL / GLM-4V / Ollama）
  - [ ] API Key 配置（复用或新加）
  - [ ] 交互方式（粘贴/按钮/拖拽）
