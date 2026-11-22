import { useEffect, useId, useMemo, useRef, type JSX } from 'react'
import { FolderRootIcon, LayersIcon, ServerIcon } from 'lucide-react'
import { FileIcon } from '@pch/ui/file-icon'
import { useTranslation } from 'react-i18next'
import { workspaceIdOfUri, type TabState, type WorkspaceEntry } from '@pch/shared'
import { Button } from '@pch/ui/components/button'
import { Spinner } from '@pch/ui/components/spinner'
import { useConnectionNames } from '@renderer/data/connections'
import { useEntries } from '@renderer/data/entries'
import { useWorkspaces, workspaceDisplayName } from '@renderer/data/workspace'
import { displayPath, isLocalUri } from '@renderer/lib/display-path'
import { onTabRefresh, useTabsStore } from '@renderer/stores/tabs-store'
import { overviewSections, type OverviewSection } from './overview-model'

export interface WorkspaceOverviewProps {
  /** 显示工作区总览（kind 为 workspace，uri 为 pch-workspace:<id>）的标签 */
  tab: TabState
}

/**
 * 工作区总览（设计 devDoc/2026-11-19-15 第 2.3 节）：应用内置视图，不是插件（要用工作区数据）。
 * 工作区 id 取自标签的 URI（标签按工作区区分，总览只会是所属工作区的）。
 * 分组为分节（只读，分组不可打开）；folder / file 条目为项（别名、真实路径的悬停提示）：
 * 双击 / Enter 在当前标签打开（folder 与 file 都进入历史）；中键 / Ctrl+单击 / Ctrl+Enter 在新标签打开（设计 2.8）。
 * 不访问文件系统：不发给扫描进程，也不进 vfs.interest。
 */
export function WorkspaceOverview({ tab }: WorkspaceOverviewProps): JSX.Element {
  const { t } = useTranslation()
  const workspaceId = workspaceIdOfUri(tab.uri) ?? undefined
  const { data: workspaces } = useWorkspaces()
  const entries = useEntries(workspaceId)
  const navigate = useTabsStore((s) => s.navigate)
  const open = useTabsStore((s) => s.open)
  const rootRef = useRef<HTMLDivElement>(null)

  const workspace = workspaces?.find((w) => w.id === workspaceId)
  const title = workspace
    ? workspaceDisplayName(workspace, t('common:defaultWorkspace'))
    : tab.title
  const sections = useMemo(() => overviewSections(entries.data ?? []), [entries.data])
  const ready = entries.data !== undefined
  // 刷新（地址栏 / F5）：重新取得条目（总览不访问文件系统）
  const { refetch } = entries
  useEffect(() => onTabRefresh(tab.id, () => void refetch()), [tab.id, refetch])

  // 在标签内导航到总览后（旧视图连同焦点一起被移除）：焦点落到刚离开的条目（没有则第一项），键盘可继续
  const cameFrom = tab.history.back.at(-1)?.uri
  useEffect(() => {
    if (!ready) return
    const active = document.activeElement
    if (active !== null && active !== document.body) return
    const items = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-entry-uri]') ?? [])]
    const target = items.find((el) => el.dataset.entryUri === cameFrom) ?? items[0]
    target?.focus()
  }, [ready, cameFrom])

  /** 在当前标签打开（newTab 时在新标签打开）：folder 为目录、file 为文件，标题为别名 */
  const activate = (entry: WorkspaceEntry & { uri: string }, newTab: boolean): void => {
    const target = {
      uri: entry.uri,
      kind: entry.kind === 'folder' ? ('directory' as const) : ('file' as const),
      title: entry.label
    }
    if (!newTab) navigate(tab.id, target)
    else if (workspaceId !== undefined) open(workspaceId, target)
  }

  let body: JSX.Element
  if (entries.isError) {
    body = (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-muted-foreground">
          {t('errors:UNKNOWN')}
        </p>
        <Button variant="outline" size="sm" onClick={() => void entries.refetch()}>
          {t('preview:retry')}
        </Button>
      </div>
    )
  } else if (!ready) {
    body = <Spinner aria-label={t('preview:loading')} />
  } else if (sections.length === 0) {
    body = <p className="text-sm text-muted-foreground">{t('preview:overviewEmpty')}</p>
  } else {
    body = (
      <div className="flex flex-col gap-6">
        {sections.map((section) => (
          <Section key={section.group?.id ?? ''} section={section} onActivate={activate} />
        ))}
      </div>
    )
  }

  return (
    <div ref={rootRef} className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <h2 className="truncate text-lg font-semibold" title={title}>
          {title}
        </h2>
        {body}
      </div>
    </div>
  )
}

/** 一个分节：分组（标题 + 其中的项与子分组）或未分组的项（没有标题） */
function Section({
  section,
  onActivate
}: {
  section: OverviewSection
  onActivate: (entry: WorkspaceEntry & { uri: string }, newTab: boolean) => void
}): JSX.Element {
  const headingId = useId()
  const { group, items, children, depth } = section
  return (
    <section
      aria-labelledby={group ? headingId : undefined}
      className={depth > 1 ? 'border-l pl-4' : undefined}
    >
      {group ? (
        <h3
          id={headingId}
          className="mb-2 flex min-w-0 items-center gap-2 text-sm font-medium text-muted-foreground"
        >
          <LayersIcon aria-hidden className="size-4 shrink-0" />
          <span className="truncate">{group.label}</span>
        </h3>
      ) : null}
      {items.length > 0 ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-1">
          {items.map((entry) => (
            <li key={entry.id} className="min-w-0">
              <EntryItem entry={entry} onActivate={onActivate} />
            </li>
          ))}
        </ul>
      ) : null}
      {children.length > 0 ? (
        <div className="mt-4 flex flex-col gap-4">
          {children.map((child) => (
            <Section key={child.group?.id ?? ''} section={child} onActivate={onActivate} />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function EntryItem({
  entry,
  onActivate
}: {
  entry: WorkspaceEntry & { uri: string }
  onActivate: (entry: WorkspaceEntry & { uri: string }, newTab: boolean) => void
}): JSX.Element {
  const { t } = useTranslation()
  // 显示路径：本地为 Windows 路径，远程为 `<连接名>:<路径>`
  const path = displayPath(entry.uri, useConnectionNames())
  return (
    // 单击只获得焦点（选中）；双击 / Enter 在当前标签打开（Enter 的默认 click 被阻止，避免与单击语义混淆）；
    // 中键 / Ctrl+单击 / Ctrl+Enter 在新标签打开
    <button
      type="button"
      data-entry-uri={entry.uri}
      title={path}
      onClick={(e) => {
        if (e.detail === 1 && (e.ctrlKey || e.metaKey)) onActivate(entry, true)
      }}
      onDoubleClick={(e) => {
        if (!e.ctrlKey && !e.metaKey) onActivate(entry, false)
      }}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault()
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return
        e.preventDefault()
        onActivate(entry, true)
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || e.altKey || e.shiftKey) return
        e.preventDefault()
        onActivate(entry, e.ctrlKey || e.metaKey)
      }}
      className="flex w-full min-w-0 cursor-default items-center gap-3 rounded-md px-3 py-2 text-left outline-none select-none hover:bg-accent/50 focus-visible:outline-1 focus-visible:outline-ring focus:bg-accent focus:text-accent-foreground"
    >
      {entry.kind === 'folder' && !isLocalUri(entry.uri) ? (
        // 远程条目以服务器图标区别于本地（与资源树一致）
        <ServerIcon
          role="img"
          aria-label={t('explorer:remoteFolder')}
          className="size-5 shrink-0 text-muted-foreground"
        />
      ) : entry.kind === 'folder' ? (
        <FolderRootIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      ) : (
        <FileIcon
          // 标签可能是别名，类型按真实路径的文件名判断
          name={path.split(/[\\/]/).pop() ?? path}
          kind="file"
          className="size-5 shrink-0 text-muted-foreground"
        />
      )}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px]">{entry.label}</span>
        <span className="truncate text-xs text-muted-foreground">{path}</span>
      </span>
    </button>
  )
}
