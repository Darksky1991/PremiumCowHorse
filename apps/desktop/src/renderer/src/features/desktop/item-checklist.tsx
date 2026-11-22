import { useMemo, type JSX } from 'react'
import {
  AppWindowIcon,
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
import { entryIdsOf, tabEntryId, type ChecklistItem } from './checklist-model'
import { itemLabel, tabLabel, type LabelText } from './item-label'

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

/** 卡片网格：响应式列数（窄宽度单列）；卡片固定高度，所有分组的卡片一样高 */
const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-2'

function categoryOf(item: DesktopItem): ChecklistCategory {
  return item.kind === 'office' ? item.app : item.kind
}

export interface ItemChecklistProps {
  /** id 为字符串：「现在」用项目 key，快照用 String(项目 id) */
  items: ChecklistItem[]
  /** 勾选单位的 id（见 checklist-model：Explorer 为 tabEntryId，其余为项目 id） */
  selected: Set<string>
  onChange: (next: Set<string>) => void
}

/**
 * 项目清单（设计第 9 节）：按软件分组（资源管理器 / Word / Excel / PowerPoint / VS Code / Eclipse），
 * 分组只是带图标的标题（不可聚焦、不可勾选，显示「已选 x / y」）；每个项目是一张固定高度的卡片
 * （主标题 + 完整路径 + 只读等标记），整张卡片是一个 checkbox（单击 / Space / Enter 切换）。
 * Explorer 每个标签一张卡片、分别勾选；同一窗口的多个标签用虚线框围起，框头写「同一窗口 · N 个标签」。
 * 选中：强调色边框 + 右上角实心勾选标记；未选中：右上角空心圆（不只靠颜色区分）。
 * 快照页与退出 / 恢复对话框共用
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
  const readOnlyLabel = t('desktop:readOnly')
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
        const ids = entryIdsOf(members)
        const count = ids.filter((id) => selected.has(id)).length
        return (
          <section key={category} aria-label={label} className="flex flex-col gap-2">
            <h3 className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{label}</span>
              <span className="shrink-0 text-xs font-normal text-muted-foreground">
                {t('desktop:groupSelected', { selected: count, total: ids.length })}
              </span>
            </h3>
            {category === 'explorer' ? (
              <ExplorerWindows
                members={members}
                text={text}
                selected={selected}
                onToggle={toggle}
              />
            ) : (
              <div className={GRID}>
                {members.map(({ id, item }) => {
                  const { title, detail } = itemLabel(item, text)
                  return (
                    <ItemCard
                      key={id}
                      title={title}
                      detail={detail}
                      readOnlyLabel={item.kind === 'office' && item.readOnly ? readOnlyLabel : null}
                      checked={selected.has(id)}
                      onToggle={() => toggle(id)}
                    />
                  )
                })}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

/**
 * 资源管理器：按清单顺序，单标签窗口连续排在普通网格里；多标签窗口各自一个虚线框
 * （role=group，名称为「同一窗口 · N 个标签」），框内每个标签一张卡片
 */
function ExplorerWindows({
  members,
  text,
  selected,
  onToggle
}: {
  members: ChecklistItem[]
  text: LabelText
  selected: Set<string>
  onToggle: (id: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const tabCards = (id: string, tabs: string[]): JSX.Element[] =>
    tabs.map((tab, i) => {
      const entry = tabEntryId(id, i)
      const { title, detail } = tabLabel(tab, text)
      return (
        <ItemCard
          key={entry}
          title={title}
          detail={detail}
          readOnlyLabel={null}
          checked={selected.has(entry)}
          onToggle={() => onToggle(entry)}
        />
      )
    })

  // 连续的单标签窗口合成一个网格；多标签窗口单独成块
  const blocks: JSX.Element[] = []
  let singles: JSX.Element[] = []
  const flush = (): void => {
    if (singles.length === 0) return
    blocks.push(
      <div key={`singles-${blocks.length}`} className={GRID}>
        {singles}
      </div>
    )
    singles = []
  }
  for (const { id, item } of members) {
    if (item.kind !== 'explorer') continue
    if (item.tabs.length <= 1) {
      singles.push(...tabCards(id, item.tabs))
      continue
    }
    flush()
    const label = t('desktop:explorerWindow', { count: item.tabs.length })
    blocks.push(
      <div
        key={id}
        role="group"
        aria-label={label}
        className="flex flex-col gap-2 rounded-xl border border-dashed border-muted-foreground/40 bg-muted/50 p-2"
      >
        <div className="flex min-w-0 items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <AppWindowIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">{label}</span>
        </div>
        <div className={GRID}>{tabCards(id, item.tabs)}</div>
      </div>
    )
  }
  flush()
  return <div className="flex flex-col gap-2">{blocks}</div>
}

function ItemCard({
  title,
  detail,
  readOnlyLabel,
  checked,
  onToggle
}: {
  title: string
  detail: string
  /** 只读标记的文字；null 表示不显示 */
  readOnlyLabel: string | null
  checked: boolean
  onToggle: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      title={[title, detail].filter((s) => s !== '').join('\n')}
      onClick={onToggle}
      className={cn(
        // 固定高度：两行（主标题、路径）各自单行省略，所有卡片一样高
        'relative flex h-16 min-w-0 cursor-default flex-col items-start justify-center gap-1 rounded-lg border bg-card px-3 pr-9 text-left text-card-foreground shadow-xs outline-none select-none hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50',
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
        <span className="min-w-0 truncate text-[13px] leading-5 font-medium">{title}</span>
        {readOnlyLabel === null ? null : (
          <span className="shrink-0 rounded-sm border px-1 text-[11px] leading-4 text-muted-foreground">
            {readOnlyLabel}
          </span>
        )}
      </span>
      <span className="w-full truncate text-xs leading-4 text-muted-foreground">{detail}</span>
    </button>
  )
}
