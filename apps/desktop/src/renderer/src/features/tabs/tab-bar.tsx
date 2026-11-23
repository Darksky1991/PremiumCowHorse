import { useEffect, useRef, type JSX, type KeyboardEvent, type WheelEvent } from 'react'
import {
  GalleryVerticalIcon,
  InfoIcon,
  LayoutGridIcon,
  MonitorIcon,
  SettingsIcon,
  XIcon,
  type LucideIcon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from 'cn'
import type { TabState, TabsState } from '@pch/shared'
import { Button } from '@pch/ui/components/button'
import { FileIcon } from '@pch/ui/file-icon'
import { useConnectionNames } from '@renderer/data/connections'
import { displayPath } from '@renderer/lib/display-path'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { panelDomId, tabDomId } from './dom-ids'

/** 标签类型 → 固定图标；null = 文件系统条目（directory / file），按名称用 FileIcon 显示 */
const KIND_ICON: Record<TabState['kind'], LucideIcon | null> = {
  workspace: LayoutGridIcon,
  workspaces: GalleryVerticalIcon,
  desktop: MonitorIcon,
  settings: SettingsIcon,
  about: InfoIcon,
  directory: null,
  file: null
}

export interface TabBarProps {
  state: TabsState
  /** 标签与标签面板的 DOM id 前缀（tab 的 aria-controls / 面板的 aria-labelledby） */
  baseId: string
}

/**
 * 标签栏：单击激活、× / 中键关闭；溢出时横向滚动（滚轮也可）。所有标签都是普通标签（M1-3b 起没有预览标签）。
 * 键盘：标签栏只有一个 Tab 停靠点（激活标签），←→ / Home / End 切换激活标签。
 */
export function TabBar({ state, baseId }: TabBarProps): JSX.Element {
  const { t } = useTranslation()
  const connectionNames = useConnectionNames()
  const listRef = useRef<HTMLDivElement>(null)
  const activate = useTabsStore((s) => s.activate)
  const close = useTabsStore((s) => s.close)
  const { tabs, activeId } = state

  /** 本次变化由标签栏内的键盘操作 / 焦点在栏内时的关闭引起：之后把焦点移到新的激活标签 */
  const refocus = useRef(false)

  // 激活标签滚动到可见范围（溢出时）；需要时移交焦点（被关闭的标签带走焦点后不落到 body）
  useEffect(() => {
    if (activeId === null) return
    const el = document.getElementById(tabDomId(baseId, activeId))
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    if (refocus.current) el?.focus()
    refocus.current = false
  }, [activeId, baseId, tabs])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    const index = tabs.findIndex((tab) => tab.id === activeId)
    let next: TabState | undefined
    if (e.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length]
    else if (e.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length]
    else if (e.key === 'Home') next = tabs[0]
    else if (e.key === 'End') next = tabs.at(-1)
    else return
    e.preventDefault()
    // 只有一个标签时激活不变、effect 不会运行：不留下待处理的 refocus（否则之后会夺走焦点）
    if (next && next.id !== activeId) {
      refocus.current = true
      activate(next.id)
    }
  }

  // 只有纵向滚轮时把它换成横向滚动（鼠标滚轮浏览溢出的标签）
  const onWheel = (e: WheelEvent<HTMLDivElement>): void => {
    if (e.deltaX !== 0 || e.deltaY === 0) return
    e.currentTarget.scrollLeft += e.deltaY
  }

  const closeTab = (id: string): void => {
    refocus.current = listRef.current?.contains(document.activeElement) ?? false
    close(id)
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={t('tabs:label')}
      onKeyDown={onKeyDown}
      onWheel={onWheel}
      className="flex h-9 shrink-0 overflow-x-auto overflow-y-hidden border-b bg-sidebar [scrollbar-width:thin]"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId
        const Icon = KIND_ICON[tab.kind]
        const domId = tabDomId(baseId, tab.id)
        // 工作区一览 / 设置页 / 关于页的标题按当前语言显示（标签标题是打开时的快照）
        const title =
          tab.kind === 'workspaces'
            ? t('workspace:listPage')
            : tab.kind === 'settings'
              ? t('about:settingsTitle')
              : tab.kind === 'about'
                ? t('about:title')
                : tab.title
        return (
          <div
            key={tab.id}
            id={domId}
            role="tab"
            aria-selected={active}
            aria-controls={active ? panelDomId(baseId) : undefined}
            aria-labelledby={`${domId}-title`}
            tabIndex={active ? 0 : -1}
            // 悬停提示为完整路径；工作区总览 / 一览 / 桌面记录 / 设置 / 关于（不是文件系统）为标题
            title={
              tab.kind === 'workspace' ||
              tab.kind === 'workspaces' ||
              tab.kind === 'desktop' ||
              tab.kind === 'settings' ||
              tab.kind === 'about'
                ? title
                : displayPath(tab.uri, connectionNames)
            }
            onClick={() => activate(tab.id)}
            // 中键：按下时阻止自动滚动，auxclick 时关闭
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault()
            }}
            onAuxClick={(e) => {
              if (e.button !== 1) return
              e.preventDefault()
              closeTab(tab.id)
            }}
            className={cn(
              'group/tab flex max-w-60 min-w-0 shrink-0 cursor-default items-center gap-1.5 border-r pr-1 pl-3 text-[13px] outline-none select-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring',
              active
                ? 'bg-background text-foreground shadow-[inset_0_2px_0_0_var(--primary)]'
                : 'text-muted-foreground hover:bg-sidebar-accent/50'
            )}
          >
            {Icon ? (
              <Icon aria-hidden className="size-4 shrink-0" />
            ) : (
              <FileIcon
                // 标题可能是别名，类型按 uri 末段（真实文件名）判断
                name={tab.uri.split(/[\\/]/).pop() || title}
                kind={tab.kind === 'directory' ? 'directory' : 'file'}
                className="size-4 shrink-0"
              />
            )}
            <span id={`${domId}-title`} className="min-w-0 truncate">
              {title}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0"
              aria-label={t('tabs:close')}
              title={t('tabs:close')}
              // 标签栏只保留一个 Tab 停靠点；按下时不夺取焦点
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
            >
              <XIcon />
            </Button>
          </div>
        )
      })}
    </div>
  )
}
