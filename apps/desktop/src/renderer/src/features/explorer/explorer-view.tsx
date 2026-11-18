import type { JSX, KeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FolderPlusIcon, FolderTreeIcon, RefreshCwIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
import { useEntries, useEntryActions } from '@renderer/data/entries'
import { useActiveWorkspace } from '@renderer/data/workspace'
import { call } from '@renderer/lib/ipc'
import { queryKeys } from '@renderer/lib/query-keys'
import { ExplorerTree } from './explorer-tree'

/** 侧栏「资源管理器」视图：标题行（刷新）+ 空状态或资源树 */
export function ExplorerView(): JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: workspace } = useActiveWorkspace()
  const workspaceId = workspace?.id
  const { data: entries } = useEntries(workspaceId)

  /** 刷新：条目列表与所有正在显示的目录列表重新获取（未显示的只标记为过期） */
  const refresh = (): void => {
    if (workspaceId === undefined) return
    void queryClient.invalidateQueries({ queryKey: queryKeys.entries(workspaceId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.directoryRoot })
  }

  /** 重试：清除该目录的错误状态并重新获取（期间显示加载中） */
  const retry = (uri: string): void => {
    void queryClient.resetQueries({ queryKey: queryKeys.directory(uri) })
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

/** 工作区没有条目：引导用系统对话框添加文件夹 */
function ExplorerEmpty({ workspaceId }: { workspaceId: string }): JSX.Element {
  const { t } = useTranslation()
  const { add } = useEntryActions()

  const addFolder = async (): Promise<void> => {
    try {
      const paths = await call('system.selectPaths', { kind: 'folder', multiple: true })
      for (const path of paths) {
        await add.mutateAsync({ kind: 'folder', workspaceId, parentId: null, path })
      }
    } catch (e) {
      toast.error(t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`))
    }
  }

  return (
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
      </EmptyContent>
    </Empty>
  )
}
