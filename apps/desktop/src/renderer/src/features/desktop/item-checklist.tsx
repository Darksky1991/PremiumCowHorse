import { useMemo, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { DesktopItem } from '@pch/shared'
import { Checkbox } from '@pch/ui/components/checkbox'
import { itemLabel, type LabelText } from './item-label'

type ChecklistCategory = 'explorer' | 'word' | 'excel' | 'powerpoint' | 'vscode' | 'eclipse'

/** 分组的显示顺序 */
const CATEGORIES: readonly ChecklistCategory[] = [
  'explorer',
  'word',
  'excel',
  'powerpoint',
  'vscode',
  'eclipse'
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
 * 项目清单：按类别分组（资源管理器 / Word / Excel / PowerPoint / VS Code / Eclipse），
 * 每组一个全选勾选框（部分选中时为不确定状态），每项一个勾选框、显示名与完整路径。
 * 快照页与（Task 12 的）退出 / 恢复对话框共用
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
  const groups = CATEGORIES.map((category) => ({
    category,
    members: items.filter((i) => categoryOf(i.item) === category)
  })).filter((g) => g.members.length > 0)

  const toggle = (ids: string[], on: boolean): void => {
    const next = new Set(selected)
    for (const id of ids) {
      if (on) next.add(id)
      else next.delete(id)
    }
    onChange(next)
  }

  return (
    <div role="group" aria-label={t('desktop:checklistLabel')} className="flex flex-col gap-3">
      {groups.map(({ category, members }) => {
        const ids = members.map((m) => m.id)
        const count = ids.filter((id) => selected.has(id)).length
        const label = t(`desktop:category.${category}`)
        return (
          <section key={category} className="flex flex-col gap-0.5">
            <label className="flex min-w-0 items-center gap-2 px-2 py-1 text-xs font-medium text-muted-foreground">
              <Checkbox
                aria-label={t('desktop:selectGroup', { group: label })}
                checked={count === ids.length}
                indeterminate={count > 0 && count < ids.length}
                onCheckedChange={(on) => toggle(ids, on)}
              />
              <span className="min-w-0 truncate">{label}</span>
            </label>
            {members.map(({ id, item }) => {
              const { title, detail } = itemLabel(item, text)
              return (
                <label
                  key={id}
                  title={[title, detail].filter((s) => s !== '').join('\n')}
                  className="flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50"
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={selected.has(id)}
                    onCheckedChange={(on) => toggle([id], on)}
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px]">
                      {title}
                      {item.kind === 'office' && item.readOnly ? (
                        <span className="ml-2 rounded-sm border px-1 text-[11px] text-muted-foreground">
                          {t('desktop:readOnly')}
                        </span>
                      ) : null}
                    </span>
                    {detail === '' ? null : (
                      <span className="truncate text-xs text-muted-foreground">{detail}</span>
                    )}
                  </span>
                </label>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}
