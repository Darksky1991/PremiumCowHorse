/** 工作区颜色键；`color` 列存键或 null，界面用 CSS 令牌 `--ws-<key>` */
export const WORKSPACE_COLORS = [
  'blue',
  'teal',
  'green',
  'amber',
  'orange',
  'red',
  'pink',
  'violet',
  'slate'
] as const
export type WorkspaceColor = (typeof WORKSPACE_COLORS)[number]

/** 库中读到的值若不是合法颜色键（旧数据）则视为 null */
export function toWorkspaceColor(value: string | null): WorkspaceColor | null {
  return (WORKSPACE_COLORS as readonly string[]).includes(value ?? '')
    ? (value as WorkspaceColor)
    : null
}
