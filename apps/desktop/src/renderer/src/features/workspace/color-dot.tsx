import type { JSX } from 'react'
import { cn } from 'cn'
import type { WorkspaceColor } from '@pch/shared'
import { colorVar } from './workspace-color'

/** 工作区颜色的圆点（标题栏按钮、菜单式每项）；无颜色为空心圆 */
export function ColorDot({
  color,
  className
}: {
  color: WorkspaceColor | null
  className?: string
}): JSX.Element {
  const value = colorVar(color)
  return (
    <span
      aria-hidden
      data-workspace-color={color ?? 'none'}
      className={cn(
        'size-2 flex-none rounded-full',
        value === null
          ? 'shadow-[inset_0_0_0_1.5px_var(--muted-foreground)]'
          : 'shadow-[0_0_0_1px_color-mix(in_oklch,var(--foreground)_12%,transparent)]',
        className
      )}
      style={value === null ? undefined : { background: value }}
    />
  )
}
