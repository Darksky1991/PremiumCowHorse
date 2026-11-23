import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type RefObject
} from 'react'
import { useTranslation } from 'react-i18next'
import { AppError, type Workspace, type WorkspaceSummary } from '@pch/shared'
import { Dialog, DialogContent, DialogTitle } from '@pch/ui/components/dialog'
import { useReducedMotionConfig } from '@pch/ui/lib/motion'
import { useSetting, useUpdateSettings } from '@renderer/data/settings'
import {
  useActiveWorkspace,
  useWorkspaceActions,
  useWorkspaceSummaries,
  useWorkspaces,
  workspaceDisplayName
} from '@renderer/data/workspace'
import { beginFocusReturn, type FocusReturn } from '@renderer/lib/focus-return'
import { isImeKey } from '@renderer/lib/key-context'
import { notify } from '@renderer/stores/messages-store'
import { useUiStore } from '@renderer/stores/ui-store'
import { useFilterInput } from '../use-filter-input'
import { useOpenWorkspaceList } from '../use-open-workspace-list'
import { lastUsedText } from '../workspace-time'
import { ListView } from './list-view'
import { PickerFooter, PickerHeader } from './picker-chrome'
import { RingView } from './ring-view'
import {
  act,
  cardDomId,
  keyToAction,
  rowDomId,
  usePickerState,
  type PickerAction,
  type PickerItem,
  type PickerRow
} from './use-picker-state'

/** 切换前正面卡片按压反馈的时长（设计稿 1.4；减少动效时为 0） */
const PRESS_MS = 140

/**
 * 工作区选择器（圆环式，`workspace.pickerStyle === 'carousel'`）：Base UI Dialog（role=dialog，网页视图随之冻结），
 * 固定在标题栏下方居中。标题栏按钮、地址框按钮与 Alt+W 都经 ui-store 的 pickerOpen 打开它。
 * - 打开时当前工作区在正面、焦点在筛选框；Esc 两级（有筛选词先清空，再按关闭）。
 * - 焦点：没有执行动作而关闭时（Esc / 点外部 / 再按 Alt+W）还回打开前的位置（网页视图也能还，lib/focus-return）；
 *   切换了工作区或打开了一览则不还。
 */
export function WorkspacePicker(): JSX.Element {
  const { t } = useTranslation('workspace')
  const pickerOpen = useUiStore((s) => s.pickerOpen)
  const setPickerOpen = useUiStore((s) => s.setPickerOpen)
  const style = useSetting('workspace.pickerStyle') ?? 'carousel'
  const open = pickerOpen !== null && style === 'carousel'
  const filterRef = useRef<HTMLInputElement>(null)
  const acted = useRef(false)

  // 焦点回到原处：订阅 store（早于 Dialog 抢走焦点）记住打开前的焦点。菜单式由 Base UI Menu 自己还焦点
  const styleRef = useRef(style)
  useLayoutEffect(() => {
    styleRef.current = style
  })
  useEffect(() => {
    let back: FocusReturn | null = null
    return useUiStore.subscribe((state, prev) => {
      if ((state.pickerOpen === null) === (prev.pickerOpen === null)) return
      if (state.pickerOpen !== null) {
        acted.current = false
        back = styleRef.current === 'carousel' ? beginFocusReturn() : null
      } else {
        if (!acted.current) back?.restore()
        back = null
      }
    })
  }, [])

  // 面板只在打开期间（含关闭动画）挂载：每次打开重新初始化状态（当前工作区在正面），摘要也只在打开时取
  const [present, setPresent] = useState(false)

  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        // Esc 由面板自己处理（两级）；点外部等其余原因直接关闭
        if (next || details.reason === 'escape-key') return
        setPickerOpen(null)
      }}
      onOpenChangeComplete={setPresent}
    >
      {open || present ? (
        <PickerData
          title={t('pickerTitle')}
          filterRef={filterRef}
          finalFocus={() => !acted.current}
          close={(didAct) => {
            acted.current = didAct
            setPickerOpen(null)
          }}
        />
      ) : null}
    </Dialog>
  )
}

interface BodyProps {
  title: string
  filterRef: RefObject<HTMLInputElement | null>
  /** 关闭后是否由 Base UI 还焦点（执行了动作则不还） */
  finalFocus: () => boolean
  /** didAct：执行了动作（切换 / 打开一览），焦点不还原 */
  close: (didAct: boolean) => void
}

/** 数据到齐后才挂载面板：状态在挂载时以「当前工作区在正面」初始化 */
function PickerData(props: BodyProps): JSX.Element | null {
  const { data: workspaces } = useWorkspaces()
  const { data: active } = useActiveWorkspace()
  if (workspaces === undefined || active === undefined) return null
  return <PickerBody {...props} workspaces={workspaces} active={active} />
}

function PickerBody({
  title,
  filterRef,
  finalFocus,
  close,
  workspaces,
  active
}: BodyProps & { workspaces: Workspace[]; active: Workspace }): JSX.Element {
  const { t, i18n } = useTranslation(['workspace', 'common', 'errors'])
  const { data: summaries } = useWorkspaceSummaries()
  const { activate } = useWorkspaceActions()
  const updateSettings = useUpdateSettings()
  const openList = useOpenWorkspaceList()
  const reduced = useReducedMotionConfig() === true
  const savedView = useSetting('workspace.pickerView')
  const savedDetail = useSetting('workspace.pickerDetail')
  const [view, setView] = useState(savedView ?? 'ring')
  const [detail, setDetail] = useState(savedDetail ?? false)
  const [pressing, setPressing] = useState<string | null>(null)
  // 按压反馈的定时器：Esc 取消切换、卸载时清理
  const pressTimer = useRef<number | null>(null)
  const [now] = useState(() => Date.now())
  const listId = useId()

  const defaultName = t('common:defaultWorkspace')
  const visible = useMemo(() => workspaces.filter((w) => !w.archived), [workspaces])
  const items = useMemo<PickerItem[]>(
    () =>
      visible.map((w) => ({
        id: w.id,
        name: workspaceDisplayName(w, defaultName),
        description: w.description
      })),
    [visible, defaultName]
  )
  const [state, dispatch] = usePickerState(items, active.id)

  const rows = useMemo(() => {
    const byId = new Map<string, WorkspaceSummary>((summaries ?? []).map((s) => [s.id, s]))
    const map = new Map<string, PickerRow>()
    visible.forEach((w, i) => {
      const name = workspaceDisplayName(w, defaultName)
      const number = i < 9 ? i + 1 : null
      const time = lastUsedText(w.lastOpenedAt, now, i18n.language, (k) => t(`workspace:${k}`))
      const shown = w.id === active.id ? `${name}${t('workspace:currentSuffix')}` : name
      map.set(w.id, {
        workspace: w,
        name,
        summary: byId.get(w.id),
        number,
        label: `${number === null ? '' : `${number}. `}${t('workspace:optionLabel', { name: shown, time })}`
      })
    })
    return map
  }, [visible, summaries, defaultName, now, i18n.language, t, active.id])

  const fail = (e: unknown): void => {
    notify('error', t(`errors:${e instanceof AppError ? e.code : 'UNKNOWN'}`))
  }

  /**
   * 切换：选当前工作区 = 只关闭；否则正面卡片按压反馈 140ms 后关闭面板并切换，成功后 toast。
   * 按压期间按 Esc 取消切换（面板保持打开）；期间面板因其他原因关闭（点外部、Alt+W）或卸载则不切换
   */
  const choose = (id: string): void => {
    if (pressing !== null) return
    if (id === active.id) {
      close(false)
      return
    }
    const name = rows.get(id)?.name ?? ''
    setPressing(id)
    pressTimer.current = window.setTimeout(
      () => {
        pressTimer.current = null
        if (useUiStore.getState().pickerOpen === null) return
        close(true)
        activate.mutate(id, {
          onSuccess: () => notify('success', t('workspace:switched', { name })),
          onError: fail
        })
      },
      reduced ? 0 : PRESS_MS
    )
  }
  const cancelPress = (): void => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current)
    pressTimer.current = null
    setPressing(null)
  }
  useEffect(() => {
    const timer = pressTimer
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  // 筛选框：组字中只更新文字，确定后才筛选（use-filter-input）；筛选不产生副作用，直接派发
  const filter = useFilterInput((query) => {
    dispatch(act.setQuery(query, performance.now()))
  })

  const run = (action: PickerAction): void => {
    // 按压反馈期间：Esc 取消切换，其余按键 / 点击不处理
    if (pressing !== null) {
      if (action.type === 'escape') cancelPress()
      return
    }
    // Esc 第一级清空筛选：输入框随之清空（不再经 onQuery 重复派发）
    if (action.type === 'escape') filter.clear(false)
    const effect = dispatch(action)
    if (effect === undefined) return
    if (effect.kind === 'close') close(false)
    else choose(effect.id)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement
    const inFilter = target === filterRef.current
    // 头部 / 页脚的按钮与开关：Enter / Space 交给按钮本身
    if (
      !inFilter &&
      (e.key === 'Enter' || e.key === ' ') &&
      target.closest('button, [role="switch"]')
    ) {
      return
    }
    // Alt+W：再按一次关闭（模态打开时快捷键分发不处理它，见 use-workspace-commands.ts）
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyW' && !isImeKey(e.nativeEvent)) {
      e.preventDefault()
      cancelPress()
      close(false)
      return
    }
    const action = keyToAction(e.nativeEvent, performance.now(), { view, query: state.query })
    if (action !== null) {
      e.preventDefault()
      run(action)
      return
    }
    // 打字即筛选：焦点在别处时可打印字符转入筛选框（该字符随之输入）
    if (!inFilter && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      filterRef.current?.focus()
    }
  }

  const setViewAndRemember = (next: 'ring' | 'list'): void => {
    setView(next)
    updateSettings.mutate({ 'workspace.pickerView': next })
  }
  const setDetailAndRemember = (next: boolean): void => {
    setDetail(next)
    updateSettings.mutate({ 'workspace.pickerDetail': next })
  }

  const frontId = state.order[state.front]
  const activeDescendant =
    frontId === undefined ? undefined : view === 'ring' ? cardDomId(frontId) : rowDomId(frontId)
  const frontRow = frontId === undefined ? undefined : rows.get(frontId)
  const announcement =
    frontRow === undefined
      ? ''
      : t('workspace:announce', {
          index: state.front + 1,
          count: state.order.length,
          name: `${frontRow.name}${frontId === active.id ? t('workspace:currentSuffix') : ''}`
        })
  const filtering = state.query !== ''

  // 初始焦点在筛选框：Base UI 的 initialFocus 在键盘打开（Alt+W，打开前焦点在 body）时会先落到弹出层本身
  // 而放弃移入（已验证），这里在下一帧补一次
  useEffect(() => {
    const id = requestAnimationFrame(() => filterRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [filterRef])

  return (
    <DialogContent
      showCloseButton={false}
      initialFocus={filterRef}
      finalFocus={finalFocus}
      onKeyDown={onKeyDown}
      className="top-11 w-[min(880px,calc(100%-2rem))] max-w-none translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-none"
    >
      <DialogTitle className="sr-only">{title}</DialogTitle>
      <PickerHeader
        filterRef={filterRef}
        listId={listId}
        activeDescendant={activeDescendant}
        text={filter.text}
        onChange={filter.onChange}
        onCompositionEnd={filter.onCompositionEnd}
        filtering={filtering}
        shown={state.order.length}
        total={state.items.length}
        view={view}
        onView={setViewAndRemember}
        detail={detail}
        onDetail={setDetailAndRemember}
      />

      {view === 'ring' ? (
        <RingView
          listId={listId}
          state={state}
          rows={rows}
          currentId={active.id}
          detail={detail}
          pressing={pressing}
          reduced={reduced}
          now={now}
          dispatch={run}
        />
      ) : (
        <ListView
          listId={listId}
          state={state}
          rows={rows}
          currentId={active.id}
          detail={detail}
          now={now}
          dispatch={run}
        />
      )}

      <PickerFooter
        view={view}
        filtering={filtering}
        onOpenList={() => {
          close(true)
          openList()
        }}
      />
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </DialogContent>
  )
}
