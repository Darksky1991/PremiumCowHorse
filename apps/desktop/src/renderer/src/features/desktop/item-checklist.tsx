import { useMemo, type JSX } from 'react'
import {
  BlocksIcon,
  CheckIcon,
  CodeXmlIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FolderIcon,
  PresentationIcon,
  type LucideIcon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from 'cn'
import type { DesktopItem } from '@pch/shared'
import { itemLabel, type LabelText } from './item-label'

type ChecklistCategory = 'explorer' | 'word' | 'excel' | 'powerpoint' | 'vscode' | 'eclipse'

/** 分组的显示顺序与图标 */
const CATEGORIES: readonly { category: ChecklistCategory; Icon: LucideIcon }[] = [
  { category: 'explorer', Icon: FolderIcon },
  { category: 'word', Icon: FileTextIcon },
  { category: 'excel', Icon: FileSpreadsheetIcon },
  { category: 'powerpoint', Icon: PresentationIcon },
  { category: 'vscode', Icon: CodeXmlIcon },
  { category: 'eclipse', Icon: BlocksIcon }
]

function categoryOf(item: DesktopItem): ChecklistCategory {
  return item.kind === 'office' ? item.app : item.kind
}

export interface ItemChecklistProps {
  /** id 为字符串：「现在」用项目 key，快照用 String(项目 id) */
  items: { id: string; item: DesktopItem }[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}

/**
 * 项目清单（设计第 9 节）：按软件分组（资源管理器 / Word / Excel / PowerPoint / VS Code / Eclipse），
 * 分组只是带图标的标题（不可聚焦、不可勾选，显示「已选 x / y」）；每个项目是一张卡片
 * （主标题 + 完整路径 + 只读等标记），整张卡片是一个 checkbox（单击 / Space / Enter 切换）。
 * 选中：强调色边框 + 右上角实心勾选标记；未选中：右上角空心圆（不只靠颜色区分）。
 * 卡片排成响应式网格（窄宽度单列）。快照页与退出 / 恢复对话框共用
 */
export function ItemChecklist({ items, selected, onChange }: ItemChecklistProps): JSX.Element {
  const { t } = useTranslation()
  const text = useMemo<LabelText>(
    () => ({
      specialLocation: t('desktop:specialLocation'),
      tabCount: (count) => t('desktop:tabCount', { count })
    }),
    [t]
  )
  const groups = CATEGORIES.map(({ category, Icon }) => ({
    category,
    Icon,
    members: items.filter((i) => categoryOf(i.item) === category)
  })).filter((g) => g.members.length > 0)

  const toggle = (id: string): void => {
    const next = new Set(selected)
    if (!next.delete(id)) next.add(id)
    onChange(next)
  }

  return (
    <div role="group" aria-label={t('desktop:checklistLabel')} className="flex flex-col gap-5">
      {groups.map(({ category, Icon, members }) => {
        const label = t(`desktop:category.${category}`)
        const count = members.filter((m) => selected.has(m.id)).length
        return (
          <section key={category} aria-label={label} className="flex flex-col gap-2">
            <h3 className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{label}</span>
              <span className="shrink-0 text-xs font-normal text-muted-foreground">
                {t('desktop:groupSelected', { selected: count, total: members.length })}
              </span>
            </h3>
            <div className="grid auto-rows-fr grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-2">
              {members.map(({ id, item }) => (
                <ItemCard
                  key={id}
                  item={item}
                  text={text}
                  readOnlyLabel={t('desktop:readOnly')}
                  checked={selected.has(id)}
                  onToggle={() => toggle(id)}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function ItemCard({
  item,
  text,
  readOnlyLabel,
  checked,
  onToggle
}: {
  item: DesktopItem
  text: LabelText
  readOnlyLabel: string
  checked: boolean
  onToggle: () => void
}): JSX.Element {
  const { title, detail } = itemLabel(item, text)
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      title={[title, detail].filter((s) => s !== '').join('\n')}
      onClick={onToggle}
      className={cn(
        'relative flex h-full min-w-0 cursor-default flex-col items-start gap-1 rounded-lg border bg-card p-3 pr-9 text-left text-card-foreground shadow-xs outline-none select-none hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50',
        checked && 'border-primary bg-primary/5 hover:bg-primary/10'
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-2.5 right-2.5 flex size-5 items-center justify-center rounded-full border',
          checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
        )}
      >
        {checked ? <CheckIcon className="size-3.5" /> : null}
      </span>
      <span className="flex w-full min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-[13px] font-medium">{title}</span>
        {item.kind === 'office' && item.readOnly ? (
          <span className="shrink-0 rounded-sm border px-1 text-[11px] text-muted-foreground">
            {readOnlyLabel}
          </span>
        ) : null}
      </span>
      {detail === '' ? null : (
        <span className="line-clamp-2 w-full text-xs break-all text-muted-foreground">
          {detail}
        </span>
      )}
    </button>
  )
}
