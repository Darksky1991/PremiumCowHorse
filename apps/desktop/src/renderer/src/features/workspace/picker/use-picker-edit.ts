import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppError, type WorkspaceUpdateInput } from '@pch/shared'
import { useWorkspaceActions } from '@renderer/data/workspace'
import { notify } from '@renderer/stores/messages-store'
import { nextWorkspaceName, removeWorkspace } from '../workspace-flows'
import {
  act,
  type PickerAction,
  type PickerEffect,
  type PickerItem,
  type PickerState
} from './use-picker-state'

/** 编辑表单保存的字段（名称 / 说明 / 颜色） */
export type WorkspacePatch = Omit<WorkspaceUpdateInput, 'id'>

/** 名称框的聚焦请求：Enter（不全选）或新建后（全选） */
export interface FocusRequest {
  id: string
  select: boolean
}

export interface PickerEdit {
  focusRequest: FocusRequest | null
  clearFocusRequest: () => void
  /** 正在删除的工作区（按钮禁用；卡片离开圆环时收缩淡出） */
  deleting: string | null
  /** 即时保存一个字段；失败时已提示，返回的 Promise 拒绝（表单据此还原显示） */
  save: (id: string, patch: WorkspacePatch) => Promise<void>
  /** 背面的「削除」：沿用现有删除流程（当前工作区先切到默认工作区） */
  remove: (id: string) => void
  /** 执行 reducer 的编辑类副作用（reorder / create / focusName） */
  handle: (effect: Extract<PickerEffect, { kind: 'reorder' | 'create' | 'focusName' }>) => void
}

/**
 * 选择器编辑模式的写操作（设计稿 1.4）：即时保存、「+」卡片新建（不切换，新卡片转到正面并全选名称）、
 * Alt+←/→ 排序、翻面确认后的删除。状态转换在 pickerReducer，这里只执行副作用。
 * showRing：列表视图中新建 / Enter 时先换到圆环（表单只在圆环的正面卡片上；不记入设置）
 */
export function usePickerEdit({
  state,
  dispatch,
  items,
  activeId,
  showRing,
  focusFilter
}: {
  state: PickerState
  dispatch: (action: PickerAction) => void
  items: readonly PickerItem[]
  activeId: string
  showRing: () => void
  focusFilter: () => void
}): PickerEdit {
  const { t } = useTranslation(['workspace', 'errors'])
  const { create, update, remove, activate, reorder } = useWorkspaceActions()
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const creating = useRef(false)
  // 新建的工作区：等它出现在圆环中（workspace.changed → 列表重取）再转到正面
  const arrival = useRef<string | null>(null)
  const [arrivalTick, setArrivalTick] = useState(0)

  useEffect(() => {
    const id = arrival.current
    if (id === null) return
    const i = state.order.indexOf(id)
    if (i < 0) return
    arrival.current = null
    if (i !== state.front) dispatch(act.focusIndex(i, performance.now()))
  }, [arrivalTick, state.order, state.front, dispatch])

  const fail = (e: unknown): void => {
    notify('error', t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`))
  }

  const save = async (id: string, patch: WorkspacePatch): Promise<void> => {
    try {
      await update.mutateAsync({ id, ...patch })
    } catch (e) {
      fail(e)
      throw e
    }
  }

  const createNew = async (): Promise<void> => {
    if (creating.current) return
    creating.current = true
    showRing()
    try {
      const name = nextWorkspaceName(
        items.map((w) => w.name),
        t('workspace:newWorkspaceName')
      )
      const created = await create.mutateAsync({ name })
      arrival.current = created.id
      setArrivalTick((n) => n + 1)
      setFocusRequest({ id: created.id, select: true })
    } catch (e) {
      fail(e)
    } finally {
      creating.current = false
    }
  }

  const removeOne = async (id: string): Promise<void> => {
    if (deleting !== null) return
    const name = items.find((w) => w.id === id)?.name ?? ''
    setDeleting(id)
    const done = await removeWorkspace(
      {
        activate: (target) => activate.mutateAsync(target),
        remove: (target) => remove.mutateAsync(target),
        onError: fail
      },
      id,
      activeId
    )
    // 成功时保持 deleting：卡片随列表重取离开圆环时据此收缩淡出
    if (!done) {
      setDeleting(null)
      return
    }
    notify('success', t('workspace:deleted', { name }))
    focusFilter()
  }

  return {
    focusRequest,
    clearFocusRequest: () => setFocusRequest(null),
    deleting,
    save,
    remove: (id) => void removeOne(id),
    handle: (effect) => {
      switch (effect.kind) {
        case 'reorder':
          // 失败时恢复为列表的实际顺序
          reorder.mutate(effect.ids, {
            onError: (e) => {
              fail(e)
              dispatch(act.sync(items, performance.now()))
            }
          })
          return
        case 'create':
          void createNew()
          return
        case 'focusName':
          showRing()
          setFocusRequest({ id: effect.id, select: false })
      }
    }
  }
}
