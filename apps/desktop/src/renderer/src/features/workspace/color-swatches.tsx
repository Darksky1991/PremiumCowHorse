import { useRef, type CSSProperties, type JSX, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from 'cn'
import { WORKSPACE_COLORS, type WorkspaceColor } from '@pch/shared'
import { colorVar } from './workspace-color'

/** 「なし」+ 9 个颜色键 */
const CHOICES: readonly (WorkspaceColor | null)[] = [null, ...WORKSPACE_COLORS]

/**
 * 工作区颜色的选择（选择器编辑卡片与一览页的编辑对话框共用，设计稿 1.4）：radiogroup，
 * 「なし」（空心圆加斜线）+ 9 个颜色圆点。只有选中项在 Tab 顺序中；←→↑↓ / Home / End 移动并选中
 * （与原生单选组相同），这些键不再向外传（选择器中不会转动圆环）。
 * gap：选中圆环与圆点之间那一圈的颜色，取所在表面的背景色（卡片 / 对话框）
 */
export function ColorSwatches({
  value,
  onChange,
  labelledBy,
  gap = 'var(--card)'
}: {
  value: WorkspaceColor | null
  onChange: (color: WorkspaceColor | null) => void
  /** 组标签元素的 id */
  labelledBy: string
  gap?: string
}): JSX.Element {
  const { t } = useTranslation('workspace')
  const groupRef = useRef<HTMLSpanElement>(null)
  const index = Math.max(0, CHOICES.indexOf(value))

  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const last = CHOICES.length - 1
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? index === last
          ? 0
          : index + 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? index === 0
            ? last
            : index - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null
    if (next === null) return
    e.preventDefault()
    e.stopPropagation()
    onChange(CHOICES[next] ?? null)
    groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
  }

  return (
    <span
      ref={groupRef}
      role="radiogroup"
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
      className="flex flex-wrap gap-[5px] py-[3px]"
      style={{ '--swatch-gap': gap } as CSSProperties}
    >
      {CHOICES.map((color, i) => {
        const checked = i === index
        const fill = colorVar(color)
        const label = t(`colors.${color ?? 'none'}`)
        return (
          <button
            key={color ?? 'none'}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={label}
            title={label}
            data-color={color ?? 'none'}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(color)}
            className={cn(
              'relative size-[18px] cursor-default rounded-full p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-ring',
              fill === null
                ? 'shadow-[inset_0_0_0_1.5px_var(--muted-foreground)] after:absolute after:top-[2px] after:left-[8px] after:h-[14px] after:w-[1.5px] after:rotate-45 after:bg-muted-foreground'
                : 'shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--foreground)_15%,transparent)]',
              checked && 'shadow-[0_0_0_2px_var(--swatch-gap),0_0_0_3.5px_var(--foreground)]'
            )}
            style={fill === null ? undefined : { background: fill }}
          />
        )
      })}
    </span>
  )
}
