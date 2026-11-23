import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type JSX,
  type KeyboardEvent
} from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from 'cn'
import { DEFAULT_WORKSPACE_ID, type Workspace, type WorkspaceColor } from '@pch/shared'
import { Button } from '@pch/ui/components/button'
import { Input } from '@pch/ui/components/input'
import { Spinner } from '@pch/ui/components/spinner'
import { Textarea } from '@pch/ui/components/textarea'
import { duration, ease, motion } from '@pch/ui/lib/motion'
import { isImeKey } from '@renderer/lib/key-context'
import { ColorSwatches } from '../color-swatches'
import { MAX_DESCRIPTION_LENGTH, MAX_NAME_LENGTH, descriptionValue } from '../workspace-flows'
import { CardFace } from './picker-card'
import type { PickerEdit, WorkspacePatch } from './use-picker-edit'
import { act, type PickerAction } from './use-picker-state'

/**
 * 卡片内的表单区域标记：圆环不对其中的鼠标按下 / 点击做处理（不夺焦点、不受保护期影响），
 * 面板的按键处理也不接管其中的按键（输入框中的 ←→、数字、Enter 不转动圆环，设计稿 1.5 第 6 条）
 */
export const PICKER_FORM_ATTR = 'data-picker-form'

export interface PickerEditCardProps {
  workspace: Workspace
  /** 显示名（删除确认的标题） */
  name: string
  flipped: boolean
  detail: boolean
  reduced: boolean
  edit: PickerEdit
  dispatch: (action: PickerAction) => void
  /** 字段中 Enter / Esc 之后：焦点回到筛选框 */
  onLeave: () => void
}

/**
 * 编辑模式的正面卡片（设计稿 1.4，原型 renderCard 的编辑分支）：正面是表单（名称、说明、颜色，即时保存），
 * 背面是删除确认（「削除…」后翻过来，默认焦点在「キャンセル」）。减少动效时不翻转，只换可见的一面。
 * - 名称 / 说明：失焦或名称框 Enter 时保存；Esc 撤销该字段并把焦点还给筛选框（不关闭面板）。
 *   非默认工作区名称清空时还原为原名；默认工作区可清空（= 显示本地化默认名），另有「既定の名前に戻す」。
 * - 卡片在保存前离开正面（转动、关闭面板）时也保存（卸载时提交未保存的输入）。
 */
export function PickerEditCard({
  workspace,
  name,
  flipped,
  detail,
  reduced,
  edit,
  dispatch,
  onLeave
}: PickerEditCardProps): JSX.Element {
  const { t } = useTranslation(['workspace', 'common'])
  const ids = useId()
  const isDefault = workspace.id === DEFAULT_WORKSPACE_ID
  const deleting = edit.deleting === workspace.id
  const nameRef = useRef<HTMLInputElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const backRef = useRef<HTMLDivElement>(null)
  const save = (patch: WorkspacePatch): Promise<void> => edit.save(workspace.id, patch)

  const nameField = useDraftField(workspace.name, (text) => {
    const v = text.trim()
    if (v === workspace.name || (v === '' && !isDefault)) return 'skip'
    return save({ name: v })
  })
  const descField = useDraftField(workspace.description ?? '', (text) => {
    const v = descriptionValue(text)
    if (v === workspace.description) return 'skip'
    return save({ description: v })
  })

  // 颜色：点击即保存；列表重取前先显示新值
  const [pendingColor, setPendingColor] = useState<WorkspaceColor | null | undefined>(undefined)
  const [savedColor, setSavedColor] = useState(workspace.color)
  if (savedColor !== workspace.color) {
    setSavedColor(workspace.color)
    setPendingColor(undefined)
  }
  const color = pendingColor === undefined ? workspace.color : pendingColor
  const pickColor = (next: WorkspaceColor | null): void => {
    if (next === color) return
    setPendingColor(next)
    save({ color: next }).catch(() => setPendingColor(undefined))
  }

  // 聚焦请求（Enter / 新建后）：卡片到正面、表单挂载后执行
  const request = edit.focusRequest?.id === workspace.id ? edit.focusRequest : null
  const { clearFocusRequest } = edit
  useEffect(() => {
    if (request === null) return
    nameRef.current?.focus()
    if (request.select) nameRef.current?.select()
    clearFocusRequest()
  }, [request, clearFocusRequest])

  // 翻到背面：焦点到「キャンセル」；翻回时焦点原在背面（或已因 inert 落到 body）则回到「削除…」（下一帧，等 inert 解除）
  const wasFlipped = useRef(flipped)
  useEffect(() => {
    const was = wasFlipped.current
    wasFlipped.current = flipped
    if (!flipped && !was) return
    const id = requestAnimationFrame(() => {
      if (flipped) {
        cancelRef.current?.focus()
        return
      }
      const active = document.activeElement
      if (active === document.body || backRef.current?.contains(active) === true) {
        deleteRef.current?.focus()
      }
    })
    return () => cancelAnimationFrame(id)
  }, [flipped])

  const fieldKeys =
    (field: DraftField, submitOnEnter: boolean) =>
    (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
      if (isImeKey(e.nativeEvent)) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        field.revert()
        onLeave()
      } else if (e.key === 'Enter' && submitOnEnter) {
        e.preventDefault()
        e.stopPropagation()
        field.flush()
        onLeave()
      }
    }
  // 表单的其他控件（颜色、按钮）上 Esc：焦点回到筛选框；背面 Esc：翻回
  const faceKeys = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Escape' || isImeKey(e.nativeEvent)) return
    e.preventDefault()
    e.stopPropagation()
    // 删除进行中不翻回
    if (deleting) return
    if (flipped) dispatch(act.cancelDelete())
    else onLeave()
  }

  // 焦点在表单里时卡片离开正面（点侧面卡片、滚轮转动）：焦点回到筛选框，不落到 body
  // （layout effect 的清理在节点移除之前执行，此时还能判断焦点是否在表单内）
  const rootRef = useRef<HTMLDivElement>(null)
  const leaveRef = useRef(onLeave)
  useLayoutEffect(() => {
    leaveRef.current = onLeave
  })
  useLayoutEffect(() => {
    const root = rootRef.current
    return () => {
      if (root?.contains(document.activeElement) === true) leaveRef.current()
    }
  }, [])

  const turn = reduced ? { duration: 0 } : { duration: duration.slow, ease: ease.standard }
  return (
    <div
      ref={rootRef}
      {...{ [PICKER_FORM_ATTR]: '' }}
      className="absolute inset-0 [transform-style:preserve-3d]"
    >
      <motion.div
        className="absolute inset-0 [transform-style:preserve-3d]"
        initial={false}
        animate={{ rotateY: flipped && !reduced ? 180 : 0 }}
        transition={turn}
      >
        <CardFace
          front
          color={color}
          inert={flipped}
          onKeyDown={faceKeys}
          className={cn('[backface-visibility:hidden]', reduced && flipped && 'hidden')}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pt-2.5 pb-3 text-[11px] text-muted-foreground">
            <div className="flex flex-col gap-[3px]">
              <label htmlFor={`${ids}-name`}>{t('fieldName')}</label>
              <Input
                id={`${ids}-name`}
                ref={nameRef}
                className="h-7"
                value={nameField.value}
                placeholder={isDefault ? t('common:defaultWorkspace') : undefined}
                maxLength={MAX_NAME_LENGTH}
                autoComplete="off"
                spellCheck={false}
                onChange={nameField.onChange}
                onBlur={nameField.flush}
                onKeyDown={fieldKeys(nameField, true)}
              />
              {isDefault && workspace.name !== '' ? (
                <button
                  type="button"
                  onClick={() => void save({ name: '' }).catch(() => undefined)}
                  className="cursor-default self-start text-primary underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('restoreName')}
                </button>
              ) : null}
            </div>
            <div className="flex flex-col gap-[3px]">
              <label htmlFor={`${ids}-desc`}>{t('fieldDescription')}</label>
              <Textarea
                id={`${ids}-desc`}
                rows={detail ? 4 : 2}
                className={cn('resize-none', detail ? 'max-h-28 min-h-20' : 'max-h-20 min-h-14')}
                value={descField.value}
                placeholder={t('descriptionPlaceholder')}
                maxLength={MAX_DESCRIPTION_LENGTH}
                spellCheck={false}
                onChange={descField.onChange}
                onBlur={descField.flush}
                onKeyDown={fieldKeys(descField, false)}
              />
            </div>
            <div className="flex flex-col gap-[3px]">
              <span id={`${ids}-color`}>{t('fieldColor')}</span>
              <ColorSwatches value={color} onChange={pickColor} labelledBy={`${ids}-color`} />
            </div>
            <div className="mt-auto flex items-center gap-1.5">
              <span>{t('autoSaved')}</span>
              {isDefault ? null : (
                <Button
                  ref={deleteRef}
                  variant="destructive"
                  size="xs"
                  className="ml-auto"
                  onClick={() => dispatch(act.askDelete(workspace.id))}
                >
                  <Trash2Icon />
                  {t('deleteMenu')}
                </Button>
              )}
            </div>
          </div>
        </CardFace>
        {isDefault ? null : (
          <CardFace
            ref={backRef}
            front
            color={color}
            band={false}
            role="group"
            aria-labelledby={`${ids}-del`}
            inert={!flipped}
            onKeyDown={faceKeys}
            className={cn(
              '[backface-visibility:hidden]',
              // 减少动效：不显示的一面用 display:none（不用 visibility：shadcn Button 的 transition-all
              // 会把继承来的 visibility 变化也过渡 150ms，刚显示出来的「キャンセル」在这期间 focus() 无效）
              reduced ? !flipped && 'hidden' : '[transform:rotateY(180deg)]'
            )}
          >
            <div className="flex min-h-0 flex-1 flex-col gap-2.5 px-4 pt-[18px] pb-3.5">
              <h3 id={`${ids}-del`} className="text-sm leading-[1.4] font-semibold">
                {t('deleteTitle', { name })}
              </h3>
              <p className="text-xs leading-[1.55] text-muted-foreground">
                {t('deleteDescription')}
              </p>
              <div className="mt-auto flex justify-end gap-2">
                <Button
                  ref={cancelRef}
                  variant="outline"
                  size="sm"
                  disabled={deleting}
                  onClick={() => dispatch(act.cancelDelete())}
                >
                  {t('cancel')}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleting}
                  onClick={() => edit.remove(workspace.id)}
                >
                  {deleting ? <Spinner data-icon="inline-start" /> : null}
                  {t('delete')}
                </Button>
              </div>
            </div>
          </CardFace>
        )}
      </motion.div>
    </div>
  )
}

/** 编辑模式末尾的「+」卡片：Enter / 点击（正面、保护期后）新建 */
export function PickerNewCard({ front }: { front: boolean }): JSX.Element {
  const { t } = useTranslation('workspace')
  return (
    <div
      className={cn(
        'absolute inset-0 flex flex-col items-center justify-center gap-2.5 rounded-xl border-[1.5px] border-dashed bg-card text-muted-foreground',
        front
          ? 'border-[color-mix(in_oklch,var(--primary)_70%,var(--border))] shadow-[0_0_0_1px_color-mix(in_oklch,var(--primary)_70%,transparent),0_18px_36px_-14px_oklch(0_0_0/0.4)]'
          : 'hover:border-[color-mix(in_oklch,var(--foreground)_30%,var(--border))]'
      )}
    >
      <PlusIcon aria-hidden className="size-7" />
      <span>{t('newCard')}</span>
      {front ? <span className="text-[11.5px]">{t('newCardHint')}</span> : null}
    </div>
  )
}

interface DraftField {
  value: string
  onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  /** 提交输入中的值（失焦 / Enter / 卸载） */
  flush: () => void
  /** 撤销输入中的值（Esc） */
  revert: () => void
}

/**
 * 即时保存的文本字段：输入中显示草稿；提交后在列表重取（saved 变化）之前显示提交的值，不闪回旧值。
 * commit 返回 'skip'（没有变化 / 不允许，如非默认工作区清空名称）时直接显示 saved（= 还原）；
 * 保存失败（Promise 拒绝）时也还原。卸载时提交未保存的草稿
 */
function useDraftField(
  saved: string,
  commit: (text: string) => Promise<void> | 'skip'
): DraftField {
  const [draft, setDraftState] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [prevSaved, setPrevSaved] = useState(saved)
  if (saved !== prevSaved) {
    setPrevSaved(saved)
    setPending(null)
  }
  const draftRef = useRef<string | null>(null)
  const setDraft = (v: string | null): void => {
    draftRef.current = v
    setDraftState(v)
  }
  const flush = (): void => {
    const text = draftRef.current
    if (text === null) return
    setDraft(null)
    const result = commit(text)
    if (result === 'skip') return
    setPending(text)
    result.catch(() => setPending(null))
  }
  // 卸载时提交：用最新的 flush（commit 闭包里的 workspace 是最新的）
  const flushRef = useRef(flush)
  useLayoutEffect(() => {
    flushRef.current = flush
  })
  useEffect(() => () => flushRef.current(), [])
  return {
    value: draft ?? pending ?? saved,
    onChange: (e) => setDraft(e.target.value),
    flush,
    revert: () => setDraft(null)
  }
}
