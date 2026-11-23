import type { WorkspaceColor } from '@pch/shared'

/** 工作区颜色键的 CSS 值（令牌 `--ws-<key>`，随明暗变化）；无颜色为 null，调用方自定占位样式 */
export function colorVar(color: WorkspaceColor | null): string | null {
  return color === null ? null : `var(--ws-${color})`
}
