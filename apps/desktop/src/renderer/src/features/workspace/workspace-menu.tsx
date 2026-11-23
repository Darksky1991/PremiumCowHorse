import {
  useMemo,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode
} from 'react'
import {
  LayoutListIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  Trash2Icon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AppError, DEFAULT_WORKSPACE_ID, type Workspace } from '@pch/shared'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@pch/ui/components/dropdown-menu'
import { Kbd } from '@pch/ui/components/kbd'
import {
  useActiveWorkspace,
  useWorkspaceActions,
  useWorkspaces,
  workspaceDisplayName
} from '@renderer/data/workspace'
import { isImeKey } from '@renderer/lib/key-context'
import { matchScore } from '@renderer/lib/text-match'
import { notify } from '@renderer/stores/messages-store'
import { useUiStore, type PickerAnchor } from '@renderer/stores/ui-store'
import { ColorDot } from './color-dot'
import { keyToAction } from './picker/use-picker-state'
import { useOpenWorkspaceList } from './use-open-workspace-list'
import { DeleteWorkspaceDialog, RenameWorkspaceDialog } from './workspace-dialogs'
import { lastUsedText } from './workspace-time'

/** 工作区超过这个数时菜单顶部显示筛选框（设计 5.C「约 8 个」） */
const FILTER_THRESHOLD = 8

export interface WorkspaceMenuProps {
  /** 哪个入口的菜单：ui-store 的 pickerOpen.anchor 与之相同时展开（Alt+W 为 title） */
  anchor: PickerAnchor
  /** 触发按钮（Base UI 的 render 元素） */
  trigger: ReactElement
  children: ReactNode
}

/**
 * 菜单式的工作区选择器（`workspace.pickerStyle === 'menu'`，设计 5.C / 设计稿 1.10）：
 * 合并了原标题栏切换器与地址框的两份菜单，两个入口内容一致，锚定在触发它的按钮下方。
 * - 每项：颜色圆点、名称、相对时间、编号（Alt+1–9 直选，按 sortOrder）。
 * - 超过约 8 个时顶部有筛选框（名称与说明；输入法组字中不处理 Enter）；筛选框中的字符键不交给
 *   Base UI Menu 的首字母跳转（对日文名不实用，也会把焦点从输入框带走）。
 * - 新建 / 重命名 / 恢复默认名称 / 删除作用于当前工作区（控制者决定）；「管理…」打开工作区一览。
 */
export function WorkspaceMenu({ anchor, trigger, children }: WorkspaceMenuProps): JSX.Element {
  const { t, i18n } = useTranslation()
  const { data: workspaces } = useWorkspaces()
  const { data: active } = useActiveWorkspace()
  const { update, activate } = useWorkspaceActions()
  const open = useUiStore((s) => s.pickerOpen?.anchor === anchor)
  const setPickerOpen = useUiStore((s) => s.setPickerOpen)
  const setNewOpen = useUiStore((s) => s.setNewWorkspaceOpen)
  const openList = useOpenWorkspaceList()
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  // 重命名 / 删除的目标在打开对话框时锁定（对话框打开期间当前工作区可能被主进程事件改变）：
  // 名称取列表中的最新值；目标被删除后沿用打开时的快照，对话框在关闭动画期间保持挂载
  const [locked, setLocked] = useState<Workspace | null>(null)
  const target = locked ? (workspaces?.find((w) => w.id === locked.id) ?? locked) : null

  const defaultName = t('common:defaultWorkspace')
  const all = useMemo(() => (workspaces ?? []).filter((w) => !w.archived), [workspaces])
  const filterable = all.length > FILTER_THRESHOLD
  const shown = useMemo(() => {
    if (!filterable || query.trim() === '') return all
    return all.filter(
      (w) => matchScore(query, workspaceDisplayName(w, defaultName), w.description) !== null
    )
  }, [all, filterable, query, defaultName])
  const isDefault = active?.id === DEFAULT_WORKSPACE_ID

  const fail = (e: unknown): void => {
    notify('error', t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`))
  }
  const close = (): void => setPickerOpen(null)
  const switchTo = (w: Workspace): void => {
    close()
    if (w.id === active?.id) return
    activate.mutate(w.id, {
      onSuccess: () =>
        notify('success', t('workspace:switched', { name: workspaceDisplayName(w, defaultName) })),
      onError: fail
    })
  }
  const openFor = (setOpen: (v: boolean) => void): void => {
    if (!active) return
    setLocked(active)
    setOpen(true)
  }

  /** Alt+1–9：按 sortOrder 的第 n 个直接切换（菜单打开时） */
  const onMenuKeyDown = (e: KeyboardEvent): void => {
    const action = keyToAction(e.nativeEvent, 0)
    if (action?.type !== 'directPick') return
    const w = all[action.n - 1]
    if (w === undefined) return
    e.preventDefault()
    switchTo(w)
  }
  /** 筛选框：Enter = 切到最佳匹配；字符键不交给菜单（首字母跳转），↑↓ / Esc / Tab 照常 */
  const onFilterKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (isImeKey(e.nativeEvent)) {
      e.stopPropagation()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const best = bestMatch(shown, query, defaultName)
      if (best !== undefined) switchTo(best)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Escape', 'Tab'].includes(e.key) && !e.altKey) e.stopPropagation()
  }

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          if (next) {
            setQuery('')
            setNow(Date.now())
          }
          setPickerOpen(next ? { anchor } : null)
        }}
      >
        <DropdownMenuTrigger render={trigger}>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72" onKeyDown={onMenuKeyDown}>
          {filterable ? (
            <div className="flex items-center gap-1.5 border-b px-1.5 pb-1 [&_svg]:size-4 [&_svg]:text-muted-foreground">
              <SearchIcon aria-hidden />
              <input
                // 打开时焦点在筛选框（菜单项仍可用 ↓ 进入）
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onFilterKeyDown}
                aria-label={t('workspace:filterLabel')}
                placeholder={t('workspace:filterPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          ) : null}
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('workspace:listLabel')}</DropdownMenuLabel>
            {/* 工作区多时列表可滚动 */}
            <DropdownMenuRadioGroup
              value={active?.id ?? ''}
              onValueChange={(id) => {
                const w = all.find((x) => x.id === id)
                if (w !== undefined) switchTo(w)
              }}
              className="max-h-64 overflow-y-auto"
            >
              {shown.map((w) => {
                const name = workspaceDisplayName(w, defaultName)
                const n = all.indexOf(w) + 1
                return (
                  <DropdownMenuRadioItem key={w.id} value={w.id} closeOnClick aria-label={name}>
                    <ColorDot color={w.color} />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {lastUsedText(w.lastOpenedAt, now, i18n.language, (k) => t(`workspace:${k}`))}
                    </span>
                    {n <= 9 ? <Kbd>{n}</Kbd> : null}
                  </DropdownMenuRadioItem>
                )
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setNewOpen(true)}>
            <PlusIcon />
            {t('workspace:newItem')}
          </DropdownMenuItem>
          {active ? (
            <DropdownMenuItem onClick={() => openFor(setRenameOpen)}>
              <PencilIcon />
              {t('workspace:renameItem')}
            </DropdownMenuItem>
          ) : null}
          {active && isDefault && active.name !== '' ? (
            <DropdownMenuItem
              onClick={() => update.mutate({ id: active.id, name: '' }, { onError: fail })}
            >
              <RotateCcwIcon />
              {t('workspace:restoreName')}
            </DropdownMenuItem>
          ) : null}
          {active && !isDefault ? (
            <DropdownMenuItem variant="destructive" onClick={() => openFor(setDeleteOpen)}>
              <Trash2Icon />
              {t('workspace:deleteItem')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={openList}>
            <LayoutListIcon />
            {t('workspace:manage')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {target ? (
        <>
          <RenameWorkspaceDialog
            open={renameOpen}
            onOpenChange={setRenameOpen}
            target={target}
            displayName={workspaceDisplayName(target, defaultName)}
          />
          <DeleteWorkspaceDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            target={target}
            displayName={workspaceDisplayName(target, defaultName)}
          />
        </>
      ) : null}
    </>
  )
}

/** 筛选结果中得分最高的一项（同分取靠前者） */
function bestMatch(
  shown: readonly Workspace[],
  query: string,
  defaultName: string
): Workspace | undefined {
  let best: Workspace | undefined
  let bestScore = -1
  for (const w of shown) {
    const score = matchScore(query, workspaceDisplayName(w, defaultName), w.description) ?? -1
    if (score > bestScore) {
      best = w
      bestScore = score
    }
  }
  return best
}
