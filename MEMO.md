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

### 文件上传系统
- 支持格式：Word (.docx)、PPT (.pptx)、PDF、纯文本 (.txt/.md)
- 拖拽/粘贴/按钮上传 → Electron 主进程解析 → 提取文本 → 注入上下文
- PDF 解析：`pdf-parse` 或 `pdfjs-dist`
- Word 解析：`mammoth` 或 `docx-parser`
- PPT 解析：`pptx-parser` 或解压 XML 提取文本
- 大文件分块处理，保留页码/章节结构

### 伪多模态（图片理解）
- 方案：用户上传/粘贴图片 → 多模态模型解读 → 解读文本注入 DeepSeek → 回答
- 与文件上传共用入口（统一的上传按钮/拖拽区）
- 待定：
  - [ ] 多模态模型选型（GPT-4o / Qwen-VL / GLM-4V / Ollama）
  - [ ] API Key 配置（复用或新加）
  - [ ] 交互方式（粘贴/按钮/拖拽）

### 多用户记忆系统
- 登录页：启动 → 选择/创建用户 → 进入主界面
- 每个用户独立数据目录：`userData/users/{userId}/`
  - `sessions.json` 对话列表
  - `settings.json` 用户配置（API Key、主题等）
  - `memory.json` AI 记忆条目
- 记忆自动提取：每轮对话结束后，AI 扫描对话提取关键信息
- 记忆注入：下轮对话时，匹配到的记忆注入 system prompt
- 侧栏底部：当前用户名 + 切换用户入口

### 自定义 System Prompt
- 设置页面增加 system prompt 输入框
- 用户可自定义 AI 行为规则、角色设定、回答风格
- 每轮对话注入用户自定义的 system prompt

### Coding 系统（代码编写 + 运行）
- 待展开：内置代码编辑器？沙箱运行？支持哪些语言？

### Vibe Reading 子系统
- AI 辅助阅读模式
- 导入文章/PDF/网页 → AI 自动总结、标注、提问
- 划线翻译、生词解释、知识图谱
- 阅读笔记自动存入记忆系统

### Vibe Writing 子系统
- AI 辅助写作模式（类 Notion AI）
- 富文本编辑器 + AI 协作
- 续写、改写、翻译、摘要、语气调整
- 写作草稿自动保存、版本管理

### 对话导出 [P0]
- 对话导出为 Markdown / PDF / HTML
- 单条消息复制、收藏、书签
- 对话存档管理

### 角色模板 [P0]
- 预设角色场景（代码审查员、翻译官、写作助手、面试官...）
- 本质是预设 system prompt，用户可自定义保存
- 模板选择器放在 ChatInput 或设置页面

### 自动化 & Agent [P1]
- 定时任务：定时推送新闻、天气、AI 日报
- 浏览器自动化：Puppeteer 集成，填表、截图、爬取
- 多步骤工作流编排
- 文件系统操作

### 数据可视化 [P1]
- 对话内 ECharts/Mermaid 图表渲染
- CSV/Excel 导入 → AI 分析 → 图表 + 洞察
- SQLite 自然语言查询

### 语音输入 [P2]
- Whisper API 实时语音转文字
- TTS 语音朗读回答

### Hermes 风格助手工具集成
- 待展开：工具调用？Agent 框架？具体指什么能力？

### 子系统分模块架构
- 各功能模块独立：聊天、搜索、记忆、coding、工具调用
- 统一的工具/能力注册机制
- 模块间通过事件/接口通信

### MCP 市场
- 类似插件商店，浏览/安装 MCP 服务器
- MCP 协议标准化接入，扩展 DeepSeek 的工具能力
- 社区分享 + 官方认证机制
- 一键安装、启用/禁用、配置管理

### Skill 市场
- 用户可安装/分享技能包（Slash Command）
- 类似 Claude Code 的 skills 机制
- 社区生态：上传、评分、分类搜索
- 本地自定义 skill + 市场下载

