import { useState, type JSX } from 'react'
import { ChevronDownIcon, PencilIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AppError, DEFAULT_WORKSPACE_ID } from '@pch/shared'
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
            <DropdownMenuItem onClick={() => setRenameOpen(true)}>
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
            <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2Icon />
              {t('workspace:deleteItem')}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <NewWorkspaceDialog open={newOpen} onOpenChange={setNewOpen} />
      {active ? (
        <>
          <RenameWorkspaceDialog
            open={renameOpen}
            onOpenChange={setRenameOpen}
            target={active}
            displayName={activeName}
          />
          <DeleteWorkspaceDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            target={active}
            displayName={activeName}
          />
        </>
      ) : null}
    </>
  )
}
