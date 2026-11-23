import { useEffect, useRef, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from 'cn'
import { Kbd } from '@pch/ui/components/kbd'
import { colorVar } from '../workspace-color'
import { lastUsedText } from '../workspace-time'
import { Highlighted } from './picker-card'
import {
  act,
  rowDomId,
  type PickerAction,
  type PickerRow,
  type PickerState
} from './use-picker-state'

export interface ListViewProps {
  listId: string
  state: PickerState
  rows: ReadonlyMap<string, PickerRow>
  currentId: string | undefined
  detail: boolean
  now: number
  dispatch: (action: PickerAction) => void
}

/**
 * 列表视图（设计稿 1.1 / 1.7）：与圆环并列的另一个视图，一行一项、可滚动；单击行即切换
 * （列表不转动，不存在「滑到光标下」的问题）。↑/↓ 移动选中行，选中行随之滚入可见范围。
 */
export function ListView({
  listId,
  state,
  rows,
  currentId,
  detail,
  now,
  dispatch
}: ListViewProps): JSX.Element {
  const { t, i18n } = useTranslation('workspace')
  const listRef = useRef<HTMLUListElement>(null)
  const frontId = state.order[state.front]

  useEffect(() => {
    if (frontId === undefined) return
    listRef.current
      ?.querySelector(`[id="${rowDomId(frontId)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [frontId])

  if (state.order.length === 0) {
    return (
      <div className="grid min-h-[200px] place-content-center gap-2.5 px-6 text-center text-muted-foreground">
        <strong className="text-sm font-semibold text-foreground">
          {t('emptyTitle', { query: state.query })}
        </strong>
        <span>{t('emptyHint')}</span>
      </div>
    )
  }

  return (
    <ul
      ref={listRef}
      id={listId}
      role="listbox"
      aria-orientation="vertical"
      aria-label={t('listLabel')}
      className="max-h-[392px] min-h-[200px] overflow-y-auto p-1.5"
    >
      {state.order.map((id, i) => {
        const row = rows.get(id)
        if (row === undefined) return null
        const selected = i === state.front
        const color = colorVar(row.workspace.color)
        const time = lastUsedText(row.workspace.lastOpenedAt, now, i18n.language, t)
        return (
          <li
            key={id}
            id={rowDomId(id)}
            role="option"
            aria-selected={selected}
            aria-label={row.label}
            data-workspace-row={id}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => dispatch(act.clickRow(i, performance.now()))}
            className={cn(
              'grid cursor-default grid-cols-[4px_22px_minmax(0,1fr)_auto_auto] items-center gap-2.5 rounded-lg py-[7px] pr-2.5',
              selected
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-[color-mix(in_oklch,var(--accent)_60%,transparent)]'
            )}
          >
            <span
              aria-hidden
              className="self-stretch rounded-r-[3px]"
              style={color === null ? undefined : { background: color }}
            />
            <span>
              {state.query === '' && row.number !== null ? <Kbd>{row.number}</Kbd> : null}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium">
                <Highlighted name={row.name} query={state.query} />
              </span>
              {detail && row.workspace.description ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {row.workspace.description}
                </span>
              ) : null}
            </span>
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              {detail ? `${t('entryCount', { count: row.summary?.entryCount ?? 0 })}・` : ''}
              {time}
            </span>
            {id === currentId ? (
              <span className="rounded-full bg-[color-mix(in_oklch,var(--primary)_14%,transparent)] px-[7px] text-[11px] leading-[18px] whitespace-nowrap text-foreground">
                {t('current')}
              </span>
            ) : (
              <span />
            )}
          </li>
        )
      })}
    </ul>
  )
}
