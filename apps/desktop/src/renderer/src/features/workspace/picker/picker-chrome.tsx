import type { ChangeEvent, CompositionEvent, JSX, RefObject } from 'react'
import { GalleryHorizontalIcon, LayoutListIcon, ListIcon, SearchIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from 'cn'
import { Button } from '@pch/ui/components/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText
} from '@pch/ui/components/input-group'
import { Kbd } from '@pch/ui/components/kbd'
import { Label } from '@pch/ui/components/label'
import { Switch } from '@pch/ui/components/switch'

export type PickerView = 'ring' | 'list'

export interface PickerHeaderProps {
  filterRef: RefObject<HTMLInputElement | null>
  /** 圆环 / 列表的 listbox id（筛选框的 aria-controls） */
  listId: string
  /** 正面卡片 / 选中行的元素 id */
  activeDescendant: string | undefined
  /** 筛选框（use-filter-input：组字中不筛选） */
  text: string
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
  onCompositionEnd: (e: CompositionEvent<HTMLInputElement>) => void
  filtering: boolean
  shown: number
  total: number
  view: PickerView
  onView: (view: PickerView) => void
  detail: boolean
  onDetail: (detail: boolean) => void
}

/** 选择器头部：筛选框（combobox）+ 计数、「リング / リスト」切换、「詳細」开关 */
export function PickerHeader({
  filterRef,
  listId,
  activeDescendant,
  text,
  onChange,
  onCompositionEnd,
  filtering,
  shown,
  total,
  view,
  onView,
  detail,
  onDetail
}: PickerHeaderProps): JSX.Element {
  const { t } = useTranslation('workspace')
  return (
    <div className="flex items-center gap-2.5 border-b px-3.5 pt-3 pb-2.5">
      <InputGroup className="min-w-0 flex-1">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          ref={filterRef}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeDescendant}
          aria-label={t('filterLabel')}
          placeholder={t('filterPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={onChange}
          onCompositionEnd={onCompositionEnd}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText className="tabular-nums">
            {filtering ? t('countFiltered', { shown, total }) : t('countAll', { count: total })}
          </InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      <div
        role="group"
        aria-label={t('viewLabel')}
        className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5"
      >
        {(
          [
            ['ring', GalleryHorizontalIcon, 'viewRing', 'viewRingTitle'],
            ['list', ListIcon, 'viewList', 'viewListTitle']
          ] as const
        ).map(([value, Icon, label, title]) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            title={t(title)}
            onClick={() => onView(value)}
            className={cn(
              'inline-flex h-[26px] items-center gap-[5px] rounded-md px-[9px] text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4',
              view === value
                ? 'bg-background text-foreground shadow-[0_1px_2px_oklch(0_0_0/0.12)]'
                : 'text-muted-foreground'
            )}
          >
            <Icon aria-hidden />
            {t(label)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-[7px]">
        <Switch id={`${listId}-detail`} size="sm" checked={detail} onCheckedChange={onDetail} />
        <Label htmlFor={`${listId}-detail`} className="font-normal whitespace-nowrap">
          {t('detail')}
        </Label>
      </div>
    </div>
  )
}

/** 选择器页脚：按键提示与「ワークスペース一覧を開く」 */
export function PickerFooter({
  view,
  filtering,
  onOpenList
}: {
  view: PickerView
  filtering: boolean
  onOpenList: () => void
}): JSX.Element {
  const { t } = useTranslation('workspace')
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 border-t px-3.5 py-2 text-xs text-muted-foreground">
      {view === 'ring' ? (
        <KeyHint keys={['←', '→']} label={t('keyRotate')} />
      ) : (
        <KeyHint keys={['↑', '↓']} label={t('keyMove')} />
      )}
      <KeyHint keys={['Enter']} label={t('keySwitch')} />
      <KeyHint keys={['Alt', '1–9']} label={t('keyDirect')} />
      {view === 'ring' ? <span>{t('keyFilter')}</span> : null}
      <KeyHint keys={['Esc']} label={filtering ? t('keyClear') : t('keyClose')} />
      <Button variant="ghost" size="xs" className="ml-auto" onClick={onOpenList}>
        <LayoutListIcon />
        {t('openList')}
      </Button>
    </div>
  )
}

function KeyHint({ keys, label }: { keys: readonly string[]; label: string }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-[5px]">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
      {label}
    </span>
  )
}
