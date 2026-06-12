/** 笔记/Insight 数据模型 */

export interface Insight {
  id: string
  /** 收藏的文本内容 */
  content: string
  /** 来源消息 ID */
  sourceMessageId: string
  /** 来源会话 ID */
  sourceSessionId: string
  /** 来源角色 */
  sourceRole: 'user' | 'assistant'
  /** 标签列表 */
  tags: string[]
  /** 颜色标记（hex） */
  color: string
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
  /** 编辑器中追加的笔记（Markdown） */
  note: string
  /** 所属笔记本 ID（null = 未分类） */
  notebookId: string | null
}

/** 笔记本 */
export interface Notebook {
  id: string
  /** 笔记本名称 */
  name: string
  /** 颜色标记（取自 INSIGHT_COLORS） */
  color: string
  /** 创建时间 */
  createdAt: number
  /** 排序权重 */
  order: number
  /** 父笔记本 ID（null = 顶级；只支持两级） */
  parentId: string | null
}

/** 预设色板 */
export const INSIGHT_COLORS = [
  '#ef4444', // 红
  '#f59e0b', // 橙
  '#10b981', // 绿
  '#3b82f6', // 蓝
  '#8b5cf6', // 紫
  '#ec4899', // 粉
  '#6366f1', // 靛
  '#14b8a6', // 青
] as const

/** 新建 Insight 的输入参数 */
export type InsightInput = Pick<Insight, 'content' | 'sourceMessageId' | 'sourceSessionId' | 'sourceRole' | 'tags' | 'color' | 'notebookId'>
