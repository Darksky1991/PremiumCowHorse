import type { CSSProperties, HTMLAttributes, JSX, ReactNode, Ref } from 'react'
import { LayersIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from 'cn'
import type { Workspace, WorkspaceColor, WorkspaceSummary } from '@pch/shared'
import { FileIcon } from '@pch/ui/file-icon'
import { Kbd } from '@pch/ui/components/kbd'
import { normalizeForMatch } from '@renderer/lib/text-match'
import { colorVar } from '../workspace-color'
import { absoluteTime, lastUsedText } from '../workspace-time'

/**
 * 名称中与筛选词匹配的部分加下划线。只在规范化前后长度一致时标出
 * （NFKC 可能改变长度，例如「㈱」，此时位置对不上，不标）
 */
export function Highlighted({ name, query }: { name: string; query: string }): ReactNode {
  const q = normalizeForMatch(query).trim()
  if (q === '') return name
  const n = normalizeForMatch(name)
  const at = n.indexOf(q)
  if (at < 0 || n.length !== name.length) return name
  return (
    <>
      {name.slice(0, at)}
      <mark className="bg-transparent text-inherit underline decoration-[color-mix(in_oklch,var(--primary)_80%,transparent)] decoration-2 underline-offset-[3px]">
        {name.slice(at, at + q.length)}
      </mark>
      {name.slice(at + q.length)}
    </>
  )
}

/**
 * 卡面的外壳（圆环中的卡片、编辑表单与删除确认共用）：圆角边框、顶部颜色带（无颜色时为 border 色）、
 * 正面的高亮边框与投影。className 只用于布局（背面的 3D 翻转等）
 */
export function CardFace({
  front,
  color,
  band = true,
  className,
  children,
  ref,
  ...rest
}: {
  front: boolean
  color: WorkspaceColor | null
  /** 顶部颜色带（删除确认的背面没有） */
  band?: boolean
  className?: string
  children: ReactNode
  ref?: Ref<HTMLDivElement>
} & Omit<HTMLAttributes<HTMLDivElement>, 'color'>): JSX.Element {
  const value = colorVar(color)
  return (
    <div
      {...rest}
      ref={ref}
      className={cn(
        'absolute inset-0 flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground',
        front
          ? 'border-[color-mix(in_oklch,var(--primary)_70%,var(--border))] shadow-[0_0_0_1px_color-mix(in_oklch,var(--primary)_70%,transparent),0_18px_36px_-14px_oklch(0_0_0/0.4)]'
          : 'hover:border-[color-mix(in_oklch,var(--foreground)_30%,var(--border))]',
        className
      )}
    >
      {band ? (
        <div
          aria-hidden
          data-slot="card-band"
          data-workspace-color={color ?? 'none'}
          className="h-[5px] flex-none bg-border"
          style={value === null ? undefined : ({ background: value } satisfies CSSProperties)}
        />
      ) : null}
      {children}
    </div>
  )
}

export interface PickerCardProps {
  workspace: Workspace
  name: string
  summary: WorkspaceSummary | undefined
  /** 卡片左上角的编号（sortOrder 前 9 个；筛选中不显示） */
  number: number | null
  current: boolean
  front: boolean
  detail: boolean
  query: string
  /** 打开选择器的时刻（相对时间的基准） */
  now: number
}

/**
 * 圆环中的一张卡片（只是卡面；位置、转动与变暗在 ring-view.tsx）。
 * 简要：颜色带、编号、「使用中」、名称、相对时间与条目数。
 * 详细：再加说明、根级前 4 个条目（文件图标着色）与「ほか N 項目」、绝对时间。
 */
export function PickerCard({
  workspace,
  name,
  summary,
  number,
  current,
  front,
  detail,
  query,
  now
}: PickerCardProps): JSX.Element {
  const { t, i18n } = useTranslation('workspace')
  const language = i18n.language
  const count = summary?.entryCount ?? 0
  const top = summary?.topEntries ?? []
  const rest = count - top.length
  return (
    <CardFace front={front} color={workspace.color}>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-3.5 py-3">
        <div className="flex min-h-[18px] items-center gap-1.5">
          {number === null ? null : <Kbd>{number}</Kbd>}
          {current ? (
            <span className="ml-auto rounded-full bg-[color-mix(in_oklch,var(--primary)_14%,transparent)] px-[7px] text-[11px] leading-[18px] whitespace-nowrap text-foreground">
              {t('current')}
            </span>
          ) : null}
        </div>
        <div
          className={cn(
            'leading-[1.35] font-semibold tracking-[-0.005em] [overflow-wrap:anywhere]',
            detail ? 'line-clamp-2 text-[15px]' : 'line-clamp-3 text-base'
          )}
        >
          <Highlighted name={name} query={query} />
        </div>
        {detail ? (
          <>
            {workspace.description ? (
              <p className="line-clamp-3 text-xs leading-normal text-muted-foreground">
                {workspace.description}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground italic opacity-80">
                {t('noDescription')}
              </p>
            )}
            <ul className="mt-1 flex flex-col gap-[3px] border-t border-dashed pt-2 text-xs">
              {top.map((entry, i) => (
                <li key={`${i}:${entry.label}`} className="flex min-w-0 items-center gap-1.5">
                  {entry.kind === 'group' ? (
                    <LayersIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <FileIcon
                      name={entry.label}
                      kind={entry.kind === 'folder' ? 'directory' : 'file'}
                      className="size-4 shrink-0"
                    />
                  )}
                  <span className="truncate">{entry.label}</span>
                </li>
              ))}
              {rest > 0 ? (
                <li className="pl-[22px] text-muted-foreground">
                  {t('moreEntries', { count: rest })}
                </li>
              ) : null}
            </ul>
          </>
        ) : null}
        <div className="mt-auto flex justify-between gap-2 text-xs text-muted-foreground">
          {detail ? (
            <>
              <span>{t('lastUsed')}</span>
              <span>
                {workspace.lastOpenedAt === null
                  ? '—'
                  : absoluteTime(workspace.lastOpenedAt, language)}
              </span>
            </>
          ) : (
            <>
              <span>{lastUsedText(workspace.lastOpenedAt, now, language, t)}</span>
              <span>{t('entryCount', { count })}</span>
            </>
          )}
        </div>
        <div
          className={cn(
            'flex items-center gap-[5px] border-t pt-2 text-[11.5px] text-muted-foreground',
            front ? undefined : 'invisible'
          )}
        >
          {current ? (
            t('hintCurrent')
          ) : (
            <>
              <Kbd>Enter</Kbd>
              {t('hintSwitch')}
            </>
          )}
        </div>
      </div>
    </CardFace>
  )
}
