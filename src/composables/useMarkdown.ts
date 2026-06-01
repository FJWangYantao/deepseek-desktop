// 修复 CJK 标点紧贴 **/__ 导致 CommonMark 无法解析加粗/斜体
// 覆盖：弯引号、CJK符号、全角标点
export function fixCjkEmphasis(text: string): string {
  const punct = '‘-‟　-〿＀-￯，。、；：！？'
  return text
    .replace(new RegExp(`\\*\\*([${punct}])`, 'g'), '**​$1')
    .replace(new RegExp(`([${punct}])\\*\\*`, 'g'), '$1​**')
}
