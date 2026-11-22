import { useRef, useState, type DragEvent, type JSX, type KeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronsDownUpIcon,
  FolderPlusIcon,
  FolderTreeIcon,
  LayersIcon,
  LocateFixedIcon,
  RefreshCwIcon,
  ServerIcon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { notify } from '@renderer/stores/messages-store'
import { AppError } from '@pch/shared'
import { Button } from '@pch/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@pch/ui/components/empty'
import { Kbd } from '@pch/ui/components/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@pch/ui/components/tooltip'
import { useEntries } from '@renderer/data/entries'
import { refreshDirectories, retryDirectory } from '@renderer/data/vfs'
import { useActiveWorkspace } from '@renderer/data/workspace'
import { call, getBridge } from '@renderer/lib/ipc'
import { queryKeys } from '@renderer/lib/query-keys'
import { useNavigationStore } from '@renderer/stores/navigation-store'
import { selectActiveTab, useTabsStore } from '@renderer/stores/tabs-store'
import { AddRemoteDialog } from './add-remote-dialog'
import { osDropEffect, resolveDrop } from './drag-drop'
import { useExplorerStore } from './explorer-store'
import { ExplorerTree } from './explorer-tree'
import { NewGroupDialog } from './new-group-dialog'
import { revealPath } from './reveal'
import { useDropExecutor } from './use-drop-executor'

/** 侧栏「资源管理器」视图：标题行（定位到当前项、全部折叠、刷新）+ 空状态或资源树 */
export function ExplorerView(): JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: workspace } = useActiveWorkspace()
  const workspaceId = workspace?.id
  const { data: entries } = useEntries(workspaceId)
  const activeUri = useTabsStore((s) => selectActiveTab(workspaceId)(s)?.uri ?? null)
  const collapseAll = useExplorerStore((s) => s.collapseAll)
  const hasTree = workspaceId !== undefined && entries !== undefined && entries.length > 0

  /**
   * 定位到当前项（设计 2.7）：把激活标签的位置在树中选中并滚动到（与搜索结果的定位相同：展开祖先、
   * 进入被收起的抽屉、聚焦树）。没有标签、工作区总览、条目之外的位置时按钮禁用
   */
  const locateUri =
    hasTree && activeUri !== null && revealPath(entries, activeUri) !== null ? activeUri : null
  const locate = (): void => {
    if (workspaceId === undefined || locateUri === null) return
    useNavigationStore.getState().requestReveal(workspaceId, locateUri, 'locate')
  }

  /**
   * 刷新（F5 / 按钮）：条目列表重新获取；扫描进程立即检查所有已展开的目录（P0），
   * 目录列表重新获取（显示中的重新列出，未显示的只标记为失效）
   */
  const refresh = (): void => {
    if (workspaceId === undefined) return
    void queryClient.invalidateQueries({ queryKey: queryKeys.entries(workspaceId) })
    void refreshDirectories(queryClient)
  }

  /** 重试：扫描进程立即检查该目录，再重新获取（期间保持错误行，结果出来后替换） */
  const retry = (uri: string): void => {
    void retryDirectory(queryClient, uri)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'F5' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    e.preventDefault()
    refresh()
  }

  return (
    <div className="flex h-full flex-col" onKeyDown={onKeyDown}>
      <div className="flex h-9 shrink-0 items-center gap-1 pr-2 pl-4">
        <h2 className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          {t('explorer:title')}
        </h2>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('explorer:locate')}
                disabled={locateUri === null}
                onClick={locate}
              />
            }
          >
            <LocateFixedIcon />
          </TooltipTrigger>
          <TooltipContent>{t('explorer:locate')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('explorer:collapseAll')}
                disabled={!hasTree}
                onClick={() => {
                  if (workspaceId !== undefined) collapseAll(workspaceId)
                }}
              />
            }
          >
            <ChevronsDownUpIcon />
          </TooltipTrigger>
          <TooltipContent>{t('explorer:collapseAll')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('explorer:refresh')}
                onClick={refresh}
              />
            }
          >
            <RefreshCwIcon />
          </TooltipTrigger>
          <TooltipContent>
            {t('explorer:refresh')} <Kbd>F5</Kbd>
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1">
        {workspaceId === undefined || entries === undefined ? null : entries.length === 0 ? (
          <ExplorerEmpty workspaceId={workspaceId} />
        ) : (
          <ExplorerTree
            // 切换工作区时重建（查询集合等局部 state 不跨工作区沿用）
            key={workspaceId}
            workspaceId={workspaceId}
            entries={entries}
            label={t('explorer:title')}
            onRetry={retry}
          />
        )}
      </div>
    </div>
  )
}

/** 工作区没有条目：引导用系统对话框添加文件夹、添加远程文件夹或新建分组 */
function ExplorerEmpty({ workspaceId }: { workspaceId: string }): JSX.Element {
  const { t } = useTranslation()
  // 添加与系统拖入共用拖放的执行器：逐项添加，某项失败只提示该项，不中断其余项（与树空白处菜单一致）
  const execute = useDropExecutor(workspaceId)

  const addFolder = async (): Promise<void> => {
    try {
      const paths = await call('system.selectPaths', { kind: 'folder', multiple: true })
      if (paths.length === 0) return
      await execute({ type: 'add', parentId: null, items: paths.map((path) => ({ path })) }, [])
    } catch (e) {
      notify('error', t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`))
    }
  }

  // 空状态也接受系统文件拖入（只有 os 来源）：与树的空白处相同，add 到根末尾，绝不产生文件操作
  const [over, setOver] = useState(false)
  const isFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer.types).includes('Files')
  const onDragOver = (e: DragEvent): void => {
    const effect = isFiles(e) ? osDropEffect(e.dataTransfer.effectAllowed) : null
    if (effect === null) return setOver(false)
    e.dataTransfer.dropEffect = effect
    e.preventDefault()
    setOver(true)
  }
  const onDrop = (e: DragEvent): void => {
    setOver(false)
    if (!isFiles(e)) return
    e.preventDefault()
    const bridge = getBridge()
    const paths = Array.from(e.dataTransfer.files)
      .map((file) => bridge?.getPathForFile(file) ?? '')
      .filter((p) => p !== '')
    const action = resolveDrop({ type: 'os', paths }, null, 'after', [])
    if (paths.length > 0 && action) void execute(action, [])
  }

  const [groupOpen, setGroupOpen] = useState(false)
  const [remoteOpen, setRemoteOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={rootRef}
      className={`h-full ${over ? 'bg-sidebar-accent outline outline-1 -outline-offset-1 outline-sidebar-ring' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={onDrop}
    >
      <Empty className="h-full border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderTreeIcon />
          </EmptyMedia>
          <EmptyTitle>{t('explorer:emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('explorer:emptyHint')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" onClick={() => void addFolder()}>
            <FolderPlusIcon data-icon="inline-start" />
            {t('explorer:addFolder')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRemoteOpen(true)}>
            <ServerIcon data-icon="inline-start" />
            {t('explorer:addRemoteFolder')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setGroupOpen(true)}>
            <LayersIcon data-icon="inline-start" />
            {t('explorer:newGroup')}
          </Button>
        </EmptyContent>
      </Empty>
      <AddRemoteDialog
        open={remoteOpen}
        onOpenChange={setRemoteOpen}
        workspaceId={workspaceId}
        finalFocus={rootRef}
      />
      <NewGroupDialog
        open={groupOpen}
        onOpenChange={setGroupOpen}
        workspaceId={workspaceId}
        parentId={null}
        finalFocus={rootRef}
      />
    </div>
  )
}
