# DeepSeek Desktop 开发备忘录

## 已实现

### 联网搜索
- Bing CN 搜索引擎，Flash 生成多角度搜索词，并行搜索
- AI 智能判断是否需要搜索，URL 自动抓取
- 日期注入 system prompt

### 文件上传
- PDF/DOCX/XLSX/PPTX/纯文本，按钮上传 + Ctrl+V 粘贴
- Electron 主进程解析，文本注入对话上下文

### 分层记忆系统
- 短期/中期/长期三层，token 预算控制
- Dreaming 梦境自动整理（归类/合并/分级/删除）
- /memory 可视化记忆管理页面

### 记忆系统 & Skill 系统优化 [进行中]
- 建立两个模块的测试基准（test benchmark）
- 记忆系统：验证写入/提取/去重/分级准确性，token 预算控制有效性
- Skill 系统：验证 YAML 解析、CRUD 持久化、导入可靠性、prompt 注入正确性

### 多会话并行后台生成
- 切换会话不中断，侧栏旋转圈/未读圆点
- 多会话可同时生成，独立 abortController

### 字体设置
- 字体族选择（8 种预设）、字体大小、代码/表格跟随

### 角色模板
- 7 种预设角色，ChatHeader 下拉选择，选中即写入 system prompt

### 对话导出
- ChatHeader 导出按钮 → Electron dialog → Markdown/HTML 文件
- 含思考过程、附件标注

### UI
- 侧栏品牌名 + 收起按钮、统计/设置/记忆按钮
- 自定义 System Prompt
- 应用图标、亮暗主题切换、字体大小

---

## 待实现

### 划词助手（系统级全局）
- 全系统任意应用选中文本 → 快捷键触发 → 翻译/解释
- `globalShortcut` + `clipboard.readText()` + Flash 模型
- `BrowserWindow` frameless 浮动窗口，自动消失或固定

### 伪多模态（图片理解）
- 上传/粘贴图片 → 多模态模型解读 → 文本注入对话
- 待定：模型选型（GPT-4o / Qwen-VL / GLM-4V）、API Key 配置

### 数据可视化 [P1]
- Mermaid 图表渲染、ECharts 图表
- CSV/Excel 导入 → AI 分析 → 图表 + 洞察

### 多用户系统
- 启动选择/创建用户，独立数据目录
- 每个用户独立的 sessions/settings/memory

### Coding 系统
- 内置代码编辑器？沙箱运行？支持哪些语言？

### Vibe Reading 子系统
- AI 辅助阅读：导入文章/PDF → 总结/标注/提问
- 划线翻译、生词解释、知识图谱

### Vibe Writing 子系统
- AI 辅助写作：富文本编辑器 + AI 协作
- 续写/改写/翻译/摘要/语气调整

### 多轮工具调用系统
- AI 可多次调用工具/函数完成复杂任务（类似 Claude tool_use / OpenAI function calling）
- 工具注册 → AI 决策调用 → 执行结果回传 → 下一轮推理 → 循环至任务完成
- 典型场景：搜文件 → 读文件 → 改代码 → 运行测试 → 根据结果修正

### 自动化 & Agent [P1]
- Puppeteer 集成，定时任务，多步骤工作流

### 语音输入 [P2]
- Whisper API 语音转文字，TTS 朗读

### MCP 市场
- 插件商店，MCP 协议标准化接入

### Skill 市场
- 技能包生态，类似 Claude Code skills 机制
