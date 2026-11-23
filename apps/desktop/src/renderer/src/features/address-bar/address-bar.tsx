import { useEffect, useMemo, useRef, type JSX, type MouseEvent } from 'react'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  GalleryVerticalIcon,
  LayoutListIcon,
  RefreshCwIcon,
  type LucideIcon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { notify } from '@renderer/stores/messages-store'
import { AppError, workspaceLocation, workspacesLocation, type TabLocation } from '@pch/shared'
import { Button } from '@pch/ui/components/button'
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
import { useConnectionNames } from '@renderer/data/connections'
import { useEntries } from '@renderer/data/entries'
import {
  useActiveWorkspace,
  useWorkspaceActions,
  useWorkspaces,
  workspaceDisplayName
} from '@renderer/data/workspace'
import { copyablePath, displayPath } from '@renderer/lib/display-path'
import { call } from '@renderer/lib/ipc'
import {
  logicalPath,
  parentLocation,
  type LogicalPathContext,
  type PathSegment
} from '@renderer/lib/logical-path'
import { selectActiveTab, useTabsStore } from '@renderer/stores/tabs-store'
import type { NavCommand } from './commands'
import { useNavigationShortcuts } from './use-navigation-shortcuts'
import { ViewerMenu } from './viewer-menu'

type SegmentEvent = 'onClick' | 'onMouseDown' | 'onAuxClick'

/**
 * 应用级地址栏（设计 devDoc/2026-11-19-15 第 2.2 节；M2 反馈第 6–8 项）：标题栏正下方、横跨侧栏与内容区的一行，
 * 显示当前工作区激活标签的位置（没有标签时只有工作区一段）：
 * `[←][→][↑][⟳] ( [▤ 工作区] › 条目别名 › 段 … › 文件名 ) [查看器]`。
 * - 地址框：前置的工作区按钮（▤，lucide GalleryVertical）与路径各段放在一个圆角、浅底的框中，
 *   与框外的导航按钮、查看器按钮分开（像 Edge / Windows 资源管理器的地址框）。
 * - 工作区部分（按钮 + 工作区段，一览页时为一览段）是框内左端撑满框高、底色不同、以分隔线隔开的区域，与后面的路径区分；
 *   路径很长横向滚动时它固定在左端（sticky），工作区这一级始终可见。
 * - 单击当前位置（最后一段）或其后的空白处 = 复制当前位置的路径（文件 / 目录为 Windows 路径，其他为 URI；
 *   工作区 / 一览没有路径，不动作）。
 * - 段每次由 logicalPath 用最新的工作区名与条目计算（条目改名后随之更新），不用标签标题的快照。
 * - 单击其他段 = 在当前标签内导航（进入历史）；中键 / Ctrl+单击 = 在新标签打开（设计 2.8）；
 *   没有激活标签时单击也新建标签。段的悬停提示为真实路径（工作区 / 一览段没有真实路径）。
 * - 工作区按钮列出工作区，选中即切换（与标题栏的切换器相同，经 data/workspace）；
 *   菜单底部「管理工作区…」进入工作区一览（总览的上一级）。
 * - 后退 / 前进按标签自己的历史；上一级为逻辑路径的上一段（parentLocation：总览 → 一览）；
 *   刷新经 tabs-store 的 requestRefresh 交给标签内容。快捷键见 use-navigation-shortcuts.ts。
 */
export function AddressBar(): JSX.Element {
  const { t } = useTranslation()
  const { data: workspace } = useActiveWorkspace()
  const { data: entries } = useEntries(workspace?.id)
  const connectionNames = useConnectionNames()
  const active = useTabsStore(selectActiveTab(workspace?.id))
  const openHere = useTabsStore((s) => s.openHere)
  const navigate = useTabsStore((s) => s.navigate)
  const back = useTabsStore((s) => s.back)
  const forward = useTabsStore((s) => s.forward)
  const requestRefresh = useTabsStore((s) => s.requestRefresh)
  const scrollRef = useRef<HTMLOListElement>(null)

  const workspaceName = workspace
    ? workspaceDisplayName(workspace, t('common:defaultWorkspace'))
    : undefined
  const workspacesTitle = t('workspace:listPage')
  const ctx = useMemo<LogicalPathContext | null>(
    () =>
      workspace === undefined || workspaceName === undefined
        ? null
        : {
            workspace: { id: workspace.id, name: workspaceName },
            workspacesTitle,
            entries: entries ?? []
          },
    [workspace, workspaceName, workspacesTitle, entries]
  )
  const segments = useMemo<PathSegment[]>(() => {
    if (ctx === null) return []
    return logicalPath(active ?? workspaceLocation(ctx.workspace.id, ctx.workspace.name), ctx)
  }, [ctx, active])
  const parent = active && ctx ? parentLocation(active, ctx) : null

  const run = (command: NavCommand): void => {
    if (active === null) return
    if (command === 'back') back(active.id)
    else if (command === 'forward') forward(active.id)
    else if (command === 'up') {
      if (parent !== null) navigate(active.id, parent)
    } else requestRefresh(active.id)
  }
  useNavigationShortcuts(run)

  /** 打开段的位置：新标签（或没有激活标签）时 open，否则在激活标签内导航；当前位置不变 */
  const goTo = (target: TabLocation, newTab: boolean): void => {
    if (workspace === undefined) return
    if (!newTab && target.uri === active?.uri) return
    openHere(workspace.id, target, { newTab })
  }
  /**
   * 当前位置（最后一段）的显示路径（悬停提示；远程为 `<连接名>:<路径>`）与复制的内容
   * （本地为 Windows 路径，远程为服务器上的绝对路径，其他为 URI）；工作区 / 一览为 null
   */
  const currentPath = pathOf(segments.at(-1), connectionNames)
  const copyCurrentPath = (): void => {
    const last = segments.at(-1)
    if (currentPath === null || last === undefined) return
    const path = copyablePath(last.target.uri)
    call('system.copyText', { text: path ?? last.target.uri })
      .then(() =>
        notify('success', t(path !== null ? 'explorer:copiedPath' : 'explorer:copiedUri'))
      )
      .catch((e: unknown) => {
        notify('error', t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`))
      })
  }
  const copyTitle =
    currentPath === null
      ? undefined
      : `${currentPath}
${t('addressBar:copyHint')}`
  const segmentHandlers = (
    target: TabLocation,
    current: boolean
  ): Record<SegmentEvent, (e: MouseEvent) => void> => ({
    onClick: (e) => {
      const newTab = e.ctrlKey || e.metaKey
      // 单击当前位置：复制路径（Ctrl+单击仍在新标签打开）
      if (current && !newTab && active !== null) copyCurrentPath()
      else goTo(target, newTab)
    },
    // 中键：在新标签打开（mousedown 的默认动作是自动滚动，阻止）
    onMouseDown: (e) => {
      if (e.button === 1) e.preventDefault()
    },
    onAuxClick: (e) => {
      if (e.button !== 1) return
      e.preventDefault()
      goTo(target, true)
    }
  })

  // 段很多时横向滚动（滚动条隐藏，滚轮也可横向滚动）：路径变化、宽度变化后滚到末尾，
  // 当前位置（最后一段）保持可见
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const toEnd = (): void => {
      el.scrollLeft = el.scrollWidth
    }
    toEnd()
    const observer = new ResizeObserver(toEnd)
    observer.observe(el)
    return () => observer.disconnect()
  }, [segments])

  const hasTab = active !== null
  const navButtons: Array<{
    label: string
    shortcut: string
    Icon: LucideIcon
    enabled: boolean
    onClick: () => void
  }> = [
    {
      label: t('addressBar:back'),
      shortcut: 'Alt+←',
      Icon: ArrowLeftIcon,
      enabled: (active?.history.back.length ?? 0) > 0,
      onClick: () => run('back')
    },
    {
      label: t('addressBar:forward'),
      shortcut: 'Alt+→',
      Icon: ArrowRightIcon,
      enabled: (active?.history.forward.length ?? 0) > 0,
      onClick: () => run('forward')
    },
    {
      label: t('addressBar:up'),
      shortcut: 'Alt+↑',
      Icon: ArrowUpIcon,
      enabled: parent !== null,
      onClick: () => run('up')
    },
    {
      label: t('addressBar:refresh'),
      shortcut: 'F5',
      Icon: RefreshCwIcon,
      enabled: hasTab,
      onClick: () => run('refresh')
    }
  ]

  return (
    <nav
      aria-label={t('addressBar:label')}
      className="flex h-9 shrink-0 items-center gap-2 border-b bg-background px-2 text-[13px]"
    >
      <div className="flex shrink-0 items-center gap-0.5">
        {navButtons.map(({ label, shortcut, Icon, enabled, onClick }) => (
          <Button
            key={label}
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            title={`${label} (${shortcut})`}
            disabled={!enabled}
            onClick={onClick}
          >
            <Icon />
          </Button>
        ))}
      </div>

      {/* 地址框：工作区部分 + 路径各段（导航按钮与查看器按钮在框外）。
          单击框内空白处（框本身或段列表的空白）= 复制当前位置的路径 */}
      <div
        data-slot="address-box"
        title={copyTitle}
        onClick={(e) => {
          if (e.target === e.currentTarget || e.target === scrollRef.current) copyCurrentPath()
        }}
        className="flex h-7 min-w-0 flex-1 items-center overflow-hidden rounded-md border bg-muted/50 pr-0.5"
      >
        <ol
          ref={scrollRef}
          onWheel={(e) => {
            if (e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY
          }}
          className="flex h-full min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none]"
        >
          {segments.map((segment, i) => {
            const current = i === segments.length - 1
            const path = pathOf(segment, connectionNames)
            const button = (
              <Button
                variant="ghost"
                size="xs"
                className="max-w-48 font-normal"
                title={current ? (copyTitle ?? '') : (path ?? '')}
                aria-current={current ? 'location' : undefined}
                {...segmentHandlers(segment.target, current)}
              >
                <span className="truncate">{segment.label}</span>
              </Button>
            )
            if (i === 0) {
              // 工作区部分：工作区按钮 + 第一段（工作区 / 一览）。地址框左端的一个区域（不是框中的框）：
              // 撑满框高、底色不同、右侧一条分隔线；左侧圆角由地址框的 overflow-hidden 裁出，与框一致。
              // 固定在左端（sticky），滚动的路径从下面经过，所以底色用不透明的 color-mix 而不是半透明
              return (
                <li
                  key={`${i}:${segment.target.uri}`}
                  data-slot="address-workspace"
                  className="sticky left-0 z-10 flex shrink-0 items-center self-stretch border-r bg-[color-mix(in_oklch,var(--background),var(--foreground)_7%)] px-0.5 dark:bg-[color-mix(in_oklch,var(--background),var(--foreground)_20%)]"
                >
                  <WorkspaceMenu
                    onManage={() => goTo(workspacesLocation(workspacesTitle), false)}
                  />
                  {button}
                </li>
              )
            }
            return (
              <li key={`${i}:${segment.target.uri}`} className="flex shrink-0 items-center">
                <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                {button}
              </li>
            )
          })}
          {segments.length === 0 ? (
            <li className="flex shrink-0 items-center">
              <WorkspaceMenu onManage={() => goTo(workspacesLocation(workspacesTitle), false)} />
            </li>
          ) : null}
        </ol>
      </div>

      <ViewerMenu tabId={active?.id ?? null} />
    </nav>
  )
}

/**
 * 段的显示路径：本地文件 / 目录为 Windows 路径，远程为 `<连接名>:<路径>`，其他（网页等）为 URI；
 * 工作区 / 一览 / 桌面记录 / 设置 / 关于段没有路径
 */
function pathOf(
  segment: PathSegment | undefined,
  connectionNames: Readonly<Record<string, string>>
): string | null {
  if (
    segment === undefined ||
    segment.kind === 'workspace' ||
    segment.kind === 'workspaces' ||
    segment.kind === 'desktop' ||
    segment.kind === 'settings' ||
    segment.kind === 'about'
  ) {
    return null
  }
  return displayPath(segment.target.uri, connectionNames)
}

/**
 * 地址框前置的工作区按钮（lucide GalleryVertical）：列出工作区（当前项选中），选中即切换（与标题栏的切换器相同）；
 * 底部「管理工作区…」进入工作区一览（onManage：有激活标签时在其中导航，没有时新建标签）
 */
function WorkspaceMenu({ onManage }: { onManage: () => void }): JSX.Element {
  const { t } = useTranslation()
  const { data: workspaces } = useWorkspaces()
  const { data: active } = useActiveWorkspace()
  const { activate } = useWorkspaceActions()
  const defaultName = t('common:defaultWorkspace')
  const fail = (e: unknown): void => {
    notify('error', t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`))
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('workspace:switcherLabel')}
            title={t('workspace:switcherLabel')}
          />
        }
      >
        <GalleryVerticalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('workspace:listLabel')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={active?.id ?? ''}
            onValueChange={(id) => activate.mutate(id, { onError: fail })}
            className="max-h-64 overflow-y-auto"
          >
            {(workspaces ?? []).map((w) => (
              <DropdownMenuRadioItem key={w.id} value={w.id} closeOnClick>
                <span className="truncate">{workspaceDisplayName(w, defaultName)}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onManage}>
          <LayoutListIcon />
          {t('workspace:manage')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
