/**
 * 助手对话历史裁剪纯函数。
 *
 * 独立成文件、无任何依赖（不 import vue/pinia/DOM），
 * 以便被 tsx 测试直接 import（见 tests/assistant-chat.test.ts）。
 *
 * 超过 max 条时丢弃最早的 user/assistant，保留近期；未超限时原样返回（同引用）。
 * 注意：助手对话历史本就只含 user/assistant（system 上下文每次发送时即时组装），
 * 故此处不做角色区分，简单 slice。
 */
export function trimHistory<T extends { role: string }>(
  messages: T[],
  max: number = 20,
): T[] {
  if (messages.length <= max) return messages
  return messages.slice(messages.length - max)
}
