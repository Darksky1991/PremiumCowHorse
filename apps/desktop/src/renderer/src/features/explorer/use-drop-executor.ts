import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AppError } from '@pch/shared'
import { useEntryActions } from '@renderer/data/entries'
import { fsEntryKind, type DropAction } from './drag-drop'
import type { TreeNode } from './tree-model'

/**
 * 执行落点对应的条目操作：只调用 entry.add / entry.move，不触碰磁盘文件。
 * 树与空状态共用；失败用 toast 提示（逐项提示，不中断其余项）。
 */
export function useDropExecutor(
  workspaceId: string
): (action: DropAction, nodes: readonly TreeNode[]) => Promise<void> {
  const { t } = useTranslation()
  const entryActions = useEntryActions()

  const reportError = (e: unknown): void => {
    toast.error(t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`))
  }

  return async (action, nodes) => {
    if (action.type === 'move') {
      try {
        await entryActions.move.mutateAsync({
          id: action.entryId,
          parentId: action.parentId,
          index: action.index
        })
      } catch (e) {
        reportError(e)
      }
      return
    }
    for (const item of action.items) {
      try {
        if ('uri' in item) {
          // 真实子项：类型由节点决定（stat 跟随链接，link-directory 按 folder 添加）
          const node = nodes.find((n) => n.source === 'fs' && n.uri === item.uri)
          await entryActions.add.mutateAsync({
            kind: node ? fsEntryKind(node.kind) : 'folder',
            workspaceId,
            parentId: action.parentId,
            uri: item.uri
          })
        } else {
          // 系统文件的类型未知：先按 folder，类型不符时按 file 重试
          const base = { workspaceId, parentId: action.parentId, path: item.path }
          try {
            await entryActions.add.mutateAsync({ kind: 'folder', ...base })
          } catch (e) {
            if (!(e instanceof AppError && e.code === 'ENTRY_KIND_MISMATCH')) throw e
            await entryActions.add.mutateAsync({ kind: 'file', ...base })
          }
        }
      } catch (e) {
        reportError(e)
      }
    }
  }
}
