import { useState, type JSX } from 'react'
import { ChevronDownIcon, PencilIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AppError, DEFAULT_WORKSPACE_ID, type Workspace } from '@pch/shared'
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
import {
  useActiveWorkspace,
  useWorkspaceActions,
  useWorkspaces,
  workspaceDisplayName
} from '@renderer/data/workspace'
import { useUiStore } from '@renderer/stores/ui-store'
import {
  DeleteWorkspaceDialog,
  NewWorkspaceDialog,
  RenameWorkspaceDialog
} from './workspace-dialogs'

/**
 * 标题栏的工作区切换器：按钮显示当前工作区名称，菜单列出所有工作区（当前项打勾）
 * 并提供新建 / 重命名 / 恢复默认名称 / 删除。新建对话框的开关在 ui-store 中，欢迎页也能打开它。
 */
export function WorkspaceSwitcher(): JSX.Element {
  const { t } = useTranslation()
  const { data: workspaces } = useWorkspaces()
  const { data: active } = useActiveWorkspace()
  const { update, activate } = useWorkspaceActions()
  const newOpen = useUiStore((s) => s.newWorkspaceOpen)
  const setNewOpen = useUiStore((s) => s.setNewWorkspaceOpen)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  // 重命名 / 删除的目标在打开对话框时锁定：对话框打开期间当前工作区可能变化（主进程事件），
  // 若跟随实时的 active，提交时会作用到另一个工作区。名称取列表中的最新值；目标被删除后沿用
  // 打开时的快照，对话框在关闭动画期间保持挂载（焦点照常回到切换器）
  const [locked, setLocked] = useState<Workspace | null>(null)
  const target = locked ? (workspaces?.find((w) => w.id === locked.id) ?? locked) : null
  const openFor = (open: (v: boolean) => void): void => {
    if (!active) return
    setLocked(active)
    open(true)
  }

  const defaultName = t('common:defaultWorkspace')
  const activeName = active ? workspaceDisplayName(active, defaultName) : ''
  const isDefault = active?.id === DEFAULT_WORKSPACE_ID

  const fail = (e: unknown): void => {
    toast.error(t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`))
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="app-no-drag max-w-56 font-normal text-muted-foreground"
              aria-label={t('workspace:switcherLabel')}
            />
          }
        >
          <span className="truncate">{activeName}</span>
          <ChevronDownIcon data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('workspace:listLabel')}</DropdownMenuLabel>
            {/* 工作区多时列表可滚动 */}
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
        </DropdownMenuContent>
      </DropdownMenu>

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
    </>
  )
}
