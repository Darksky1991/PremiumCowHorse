import { useEffect, useRef, useState, type JSX, type KeyboardEvent, type MouseEvent } from 'react'
import { PencilIcon, PlusIcon, RotateCcwIcon, Trash2Icon, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from 'cn'
import {
  AppError,
  DEFAULT_WORKSPACE_ID,
  WORKSPACES_URI,
  workspaceIdOfUri,
  workspaceLocation,
  type TabState,
  type Workspace
} from '@pch/shared'
import { Button } from '@pch/ui/components/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@pch/ui/components/context-menu'
import { Spinner } from '@pch/ui/components/spinner'
import {
  useActiveWorkspace,
  useReadActiveWorkspaceId,
  useWorkspaceActions,
  useWorkspaces,
  workspaceDisplayName
} from '@renderer/data/workspace'
import { notify } from '@renderer/stores/messages-store'
import { onTabRefresh, useTabsStore } from '@renderer/stores/tabs-store'
import {
  DeleteWorkspaceDialog,
  NewWorkspaceDialog,
  RenameWorkspaceDialog
} from './workspace-dialogs'
import { gridNeighbor } from './grid-nav'
import { listTabToLeave } from './workspace-flows'

export interface WorkspacesPageProps {
  /** 显示工作区一览（kind 为 workspaces，uri 为 pch-workspaces:）的标签 */
  tab: TabState
}

/** 一项工作区的操作（卡片上的按钮与右键菜单共用同一份） */
interface WorkspaceAction {
  key: string
  label: string
  Icon: LucideIcon
  destructive?: boolean
  run: () => void
}

/**
 * 工作区一览（M2 反馈第 8 项）：应用内置视图（与工作区总览相同，不是插件），是工作区总览的上一级。
 * 以卡片网格列出全部工作区（名称、最近使用时间，当前工作区有标记；各行等高 auto-rows-fr），最后一张是「新建工作区」卡片：
 * - 单击只获得焦点；双击 / Enter 切换到该工作区；当前工作区双击 / Enter 在本标签进入其总览（下一级）。
 *   ←→↑↓ / Home / End 在卡片之间移动焦点（按实际位置，列数随宽度变化，见 grid-nav.ts）。
 * - 「新建」卡片单击 / Enter 打开新建对话框（是操作而不是选择对象，不需要双击）。
 * - 本页因切换工作区而卸载后（不论经一览、地址框的 Layers 菜单还是标题栏的切换器切换），本标签若仍是旧工作区的
 *   激活标签且有后退历史就后退一步（listTabToLeave + tabs-store 的 backFrom），以后切回旧工作区时不停在一览页。
 *   放在卸载清理中：那时 React 已提交新工作区的界面，旧标签的后退不会显示出来、不会挂载之前位置的视图。
 * - 新建对话框与每张卡片上的操作按钮 / 右键菜单（重命名、恢复默认名称、删除）复用标题栏切换器的对话框
 *   （workspace-dialogs.tsx）；删除其他工作区时不切换（removeWorkspace）。
 * 不访问文件系统；刷新（地址栏 / F5）重新取得工作区列表。
 */
export function WorkspacesPage({ tab }: WorkspacesPageProps): JSX.Element {
  const { t, i18n } = useTranslation()
  const workspaces = useWorkspaces()
  const { data: active } = useActiveWorkspace()
  const { update, activate } = useWorkspaceActions()
  const navigate = useTabsStore((s) => s.navigate)
  const readDisplayedWorkspace = useReadActiveWorkspaceId()
  const listRef = useRef<HTMLUListElement>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  // 重命名 / 删除的目标在打开对话框时锁定（与标题栏切换器相同）：名称取列表中的最新值，
  // 目标被删除后沿用打开时的快照，对话框在关闭动画期间保持挂载
  const [locked, setLocked] = useState<Workspace | null>(null)
  const target = locked ? (workspaces.data?.find((w) => w.id === locked.id) ?? locked) : null
  /** 右键菜单的目标（右键时的项；空白处为 null，不显示菜单） */
  const [menuTarget, setMenuTarget] = useState<Workspace | null>(null)

  const defaultName = t('common:defaultWorkspace')
  const title = t('workspace:listPage')
  const ready = workspaces.data !== undefined
  const fail = (e: unknown): void => {
    notify('error', t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`))
  }
  // 切换工作区后离开一览：卸载清理在新工作区的界面提交之后执行（此时查询缓存已是新的当前工作区），
  // 旧工作区的标签不在界面上，后退不会闪现之前的位置，也不会为它挂载插件 / 浏览器视图
  useEffect(
    () => () => {
      const { byWorkspace, backFrom } = useTabsStore.getState()
      if (listTabToLeave(byWorkspace, tab.id, readDisplayedWorkspace())) {
        backFrom(tab.id, WORKSPACES_URI)
      }
    },
    [tab.id, readDisplayedWorkspace]
  )

  // 刷新（地址栏 / F5）：重新取得工作区列表
  const { refetch } = workspaces
  useEffect(() => onTabRefresh(tab.id, () => void refetch()), [tab.id, refetch])

  // 在标签内导航到一览后（旧视图连同焦点一起被移除）：焦点落到刚离开的工作区（从总览上来时），
  // 否则当前工作区，再否则第一项，键盘可继续
  const cameFrom = workspaceIdOfUri(tab.history.back.at(-1)?.uri ?? '')
  useEffect(() => {
    if (!ready) return
    const focused = document.activeElement
    if (focused !== null && focused !== document.body) return
    const items = itemsOf(listRef.current)
    const target =
      items.find((el) => el.dataset.workspaceId === cameFrom) ??
      items.find((el) => el.dataset.workspaceId === active?.id) ??
      items[0]
    target?.focus()
  }, [ready, cameFrom, active?.id])

  /** 双击 / Enter：其他工作区 → 切换（本页随之卸载，见上面的离开一览）；当前工作区 → 在本标签进入其总览 */
  const enter = (w: Workspace): void => {
    if (w.id === active?.id) {
      navigate(tab.id, workspaceLocation(w.id, workspaceDisplayName(w, defaultName)))
      return
    }
    activate.mutate(w.id, { onError: fail })
  }

  const openFor = (w: Workspace, open: (v: boolean) => void): void => {
    setLocked(w)
    open(true)
  }
  const actionsFor = (w: Workspace): WorkspaceAction[] => {
    const isDefault = w.id === DEFAULT_WORKSPACE_ID
    const actions: WorkspaceAction[] = [
      {
        key: 'rename',
        label: t('workspace:renameMenu'),
        Icon: PencilIcon,
        run: () => openFor(w, setRenameOpen)
      }
    ]
    // 恢复默认名称只对默认工作区（名称为空时显示本地化的默认名）；默认工作区不可删除（与切换器相同）
    if (isDefault && w.name !== '') {
      actions.push({
        key: 'restore',
        label: t('workspace:restoreName'),
        Icon: RotateCcwIcon,
        run: () => update.mutate({ id: w.id, name: '' }, { onError: fail })
      })
    }
    if (!isDefault) {
      actions.push({
        key: 'delete',
        label: t('workspace:deleteMenu'),
        Icon: Trash2Icon,
        destructive: true,
        run: () => openFor(w, setDeleteOpen)
      })
    }
    return actions
  }

  const onListKeyDown = (e: KeyboardEvent<HTMLUListElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    const items = itemsOf(listRef.current)
    const index = items.findIndex((el) => el === document.activeElement)
    const rects = items.map((el) => el.getBoundingClientRect())
    const next = gridNeighbor(rects, index, e.key)
    if (next === null) return
    e.preventDefault()
    items[next]?.focus()
  }

  const onContextMenu = (
    e: MouseEvent<HTMLElement> & { preventBaseUIHandler?: () => void }
  ): void => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-workspace-row]')?.dataset
      .workspaceRow
    const w = workspaces.data?.find((x) => x.id === id) ?? null
    if (w === null) {
      // 空白处没有菜单：交由浏览器默认行为（Electron 中不显示任何东西）
      e.preventBaseUIHandler?.()
      return
    }
    setMenuTarget(w)
  }

  const formatTime = (ms: number): string =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(ms)

  let body: JSX.Element
  if (workspaces.isError) {
    body = (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-muted-foreground">
          {t('errors:UNKNOWN')}
        </p>
        <Button variant="outline" size="sm" onClick={() => void workspaces.refetch()}>
          {t('preview:retry')}
        </Button>
      </div>
    )
  } else if (!ready) {
    body = <Spinner aria-label={t('preview:loading')} />
  } else {
    body = (
      <ContextMenu>
        <ContextMenuTrigger onContextMenu={onContextMenu} className="block">
          <ul
            ref={listRef}
            aria-label={title}
            onKeyDown={onListKeyDown}
            className="grid auto-rows-fr grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3"
          >
            {workspaces.data.map((w) => (
              <WorkspaceRow
                key={w.id}
                workspace={w}
                name={workspaceDisplayName(w, defaultName)}
                current={w.id === active?.id}
                lastOpened={w.lastOpenedAt === null ? null : formatTime(w.lastOpenedAt)}
                actions={actionsFor(w)}
                onEnter={() => enter(w)}
              />
            ))}
            <li className="min-w-0">
              <button
                type="button"
                data-workspace-nav
                onClick={() => setNewOpen(true)}
                className="flex h-full min-h-24 w-full cursor-default flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-muted-foreground/40 p-4 text-[13px] text-muted-foreground outline-none select-none hover:bg-accent/50 hover:text-foreground focus-visible:outline-1 focus-visible:outline-ring focus:bg-accent focus:text-accent-foreground"
              >
                <PlusIcon aria-hidden className="size-5" />
                {t('workspace:newItem')}
              </button>
            </li>
          </ul>
        </ContextMenuTrigger>
        {menuTarget ? (
          <ContextMenuContent className="w-56">
            {actionsFor(menuTarget).map(({ key, label, Icon, destructive, run }) => (
              <ContextMenuItem
                key={key}
                variant={destructive ? 'destructive' : 'default'}
                onClick={run}
              >
                <Icon />
                {label}
              </ContextMenuItem>
            ))}
          </ContextMenuContent>
        ) : null}
      </ContextMenu>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <h2 className="truncate text-lg font-semibold">{title}</h2>
        {body}
      </div>

      <NewWorkspaceDialog open={newOpen} onOpenChange={setNewOpen} />
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
    </div>
  )
}

/** 网格中可获得焦点的项（每张工作区卡片的主按钮与「新建」卡片），按显示顺序 */
function itemsOf(list: HTMLElement | null): HTMLElement[] {
  return [...(list?.querySelectorAll<HTMLElement>('[data-workspace-nav]') ?? [])]
}

function WorkspaceRow({
  workspace,
  name,
  current,
  lastOpened,
  actions,
  onEnter
}: {
  workspace: Workspace
  name: string
  current: boolean
  lastOpened: string | null
  actions: WorkspaceAction[]
  onEnter: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <li
      data-workspace-row={workspace.id}
      className={cn(
        'relative min-w-0 rounded-lg border bg-card text-card-foreground shadow-xs hover:bg-accent/50 has-[[data-workspace-id]:focus]:bg-accent has-[[data-workspace-id]:focus]:text-accent-foreground',
        current && 'border-primary/50'
      )}
    >
      {/* 单击只获得焦点（选中）；双击 / Enter 切换（Enter 的默认 click 被阻止，避免与单击语义混淆） */}
      <button
        type="button"
        data-workspace-id={workspace.id}
        data-workspace-nav
        aria-current={current ? 'true' : undefined}
        title={name}
        onDoubleClick={onEnter}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
          e.preventDefault()
          onEnter()
        }}
        className="flex h-full min-h-24 w-full min-w-0 cursor-default flex-col items-start rounded-lg p-4 pb-10 text-left outline-none select-none focus-visible:outline-1 focus-visible:outline-ring"
      >
        <span className="flex w-full min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-medium">{name}</span>
            {current ? (
              <span className="shrink-0 rounded-sm border px-1.5 text-[11px] leading-4 text-muted-foreground">
                {t('workspace:current')}
              </span>
            ) : null}
          </span>
          {lastOpened !== null ? (
            <span className="truncate text-xs text-muted-foreground">
              {t('workspace:lastOpened', { time: lastOpened })}
            </span>
          ) : null}
        </span>
      </button>
      {/* 操作直接以按钮显示在卡片右下角（不折叠进菜单）；右键菜单是同一份操作 */}
      <div className="absolute right-2 bottom-2 flex items-center gap-0.5">
        {actions.map(({ key, label, Icon, destructive, run }) => (
          <Button
            key={key}
            variant={destructive ? 'destructive' : 'ghost'}
            size="icon-xs"
            aria-label={label}
            title={label}
            onClick={run}
          >
            <Icon />
          </Button>
        ))}
      </div>
    </li>
  )
}
