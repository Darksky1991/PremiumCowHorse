import { useEffect, useMemo, useRef, type JSX, type MouseEvent } from 'react'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  RefreshCwIcon,
  type LucideIcon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AppError, workspaceLocation, type TabLocation } from '@pch/shared'
import { Button } from '@pch/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@pch/ui/components/dropdown-menu'
import { useEntries } from '@renderer/data/entries'
import {
  useActiveWorkspace,
  useWorkspaceActions,
  useWorkspaces,
  workspaceDisplayName
} from '@renderer/data/workspace'
import { fileUriToWindowsPath } from '@renderer/lib/file-uri'
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
 * 应用级地址栏（设计 devDoc/2026-11-19-15 第 2.2 节）：标题栏正下方、横跨侧栏与内容区的一行，
 * 显示当前工作区激活标签的位置（没有标签时只有工作区一段）：
 * `[←][→][↑][⟳]  工作区 ▾ › 条目别名 › 段 … › 文件名`。
 * - 段每次由 logicalPath 用最新的工作区名与条目计算（条目改名后随之更新），不用标签标题的快照。
 * - 单击段 = 在当前标签内导航（进入历史）；中键 / Ctrl+单击 = 在新标签打开（设计 2.8）；
 *   没有激活标签时单击也新建标签。段的悬停提示为真实路径（工作区段没有真实路径）。
 * - 工作区段的 ▾ 列出工作区，选中即切换（与标题栏的切换器相同，经 data/workspace）。
 * - 后退 / 前进按标签自己的历史；上一级为逻辑路径的上一段（parentLocation）；
 *   刷新经 tabs-store 的 requestRefresh 交给标签内容。快捷键见 use-navigation-shortcuts.ts。
 */
export function AddressBar(): JSX.Element {
  const { t } = useTranslation()
  const { data: workspace } = useActiveWorkspace()
  const { data: entries } = useEntries(workspace?.id)
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
  const ctx = useMemo<LogicalPathContext | null>(
    () =>
      workspace === undefined || workspaceName === undefined
        ? null
        : { workspace: { id: workspace.id, name: workspaceName }, entries: entries ?? [] },
    [workspace, workspaceName, entries]
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
    else requestRefresh(active.id)
  }
  useNavigationShortcuts(run)

  /** 打开段的位置：新标签（或没有激活标签）时 open，否则在激活标签内导航；当前位置不变 */
  const goTo = (target: TabLocation, newTab: boolean): void => {
    if (workspace === undefined) return
    if (!newTab && target.uri === active?.uri) return
    openHere(workspace.id, target, { newTab })
  }
  const segmentHandlers = (target: TabLocation): Record<SegmentEvent, (e: MouseEvent) => void> => ({
    onClick: (e) => goTo(target, e.ctrlKey || e.metaKey),
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
    shortcut: string | null
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
      shortcut: null,
      Icon: ArrowUpIcon,
      enabled: parent !== null,
      onClick: () => {
        if (active !== null && parent !== null) navigate(active.id, parent)
      }
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
            title={shortcut === null ? label : `${label} (${shortcut})`}
            disabled={!enabled}
            onClick={onClick}
          >
            <Icon />
          </Button>
        ))}
      </div>

      <ol
        ref={scrollRef}
        onWheel={(e) => {
          if (e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY
        }}
        className="flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none]"
      >
        {segments.map((segment, i) => {
          const current = i === segments.length - 1
          const path =
            segment.kind === 'workspace'
              ? undefined
              : (fileUriToWindowsPath(segment.target.uri) ?? segment.target.uri)
          return (
            <li key={`${i}:${segment.target.uri}`} className="flex shrink-0 items-center">
              {i > 0 ? (
                <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              ) : null}
              <Button
                variant="ghost"
                size="xs"
                className="max-w-48 font-normal"
                title={path}
                aria-current={current ? 'location' : undefined}
                {...segmentHandlers(segment.target)}
              >
                <span className="truncate">{segment.label}</span>
              </Button>
              {segment.kind === 'workspace' ? <WorkspaceMenu /> : null}
            </li>
          )
        })}
      </ol>

      <ViewerMenu tabId={active?.id ?? null} />
    </nav>
  )
}

/** 工作区段的下拉：列出工作区（当前项选中），选中即切换（与标题栏的切换器相同） */
function WorkspaceMenu(): JSX.Element {
  const { t } = useTranslation()
  const { data: workspaces } = useWorkspaces()
  const { data: active } = useActiveWorkspace()
  const { activate } = useWorkspaceActions()
  const defaultName = t('common:defaultWorkspace')
  const fail = (e: unknown): void => {
    toast.error(t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`))
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-xs" aria-label={t('workspace:switcherLabel')} />}
      >
        <ChevronDownIcon />
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
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
