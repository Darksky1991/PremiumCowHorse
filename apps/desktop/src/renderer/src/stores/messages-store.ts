import { toast } from 'sonner'
import { create, type StoreApi, type UseBoundStore } from 'zustand'

export type MessageLevel = 'info' | 'success' | 'warning' | 'error'

export interface AppMessage {
  id: string
  level: MessageLevel
  text: string
  at: number
}

/** 收纳上限（设计 5.9），超出丢最旧 */
export const TRAY_LIMIT = 50

/** sonner 的最小子集；测试注入假实现 */
export interface ToastApi {
  show: (
    level: MessageLevel,
    text: string,
    options: { id: string; onDismiss: () => void; onAutoClose: () => void }
  ) => void
  dismiss: (id: string) => void
}

export interface MessagesState {
  /** 当前显示中的 toast id（Task 7：toast 出现时浏览器视图换成截图） */
  visible: string[]
  /** 收纳中的未确认消息，新的在前 */
  tray: AppMessage[]
  notify: (level: MessageLevel, text: string) => void
  /** 收起全部显示中的 toast 并收纳（不视为用户确认） */
  stashVisible: () => void
  /** 把收纳的消息重新作为 toast 显示 */
  restoreTray: () => void
}

/**
 * 应用消息（设计 5.9）：全应用 toast 的唯一入口。
 * - 用户拖拽 / 关闭（onDismiss）：确认，不收纳；
 * - 自动消失（onAutoClose）：error / warning 收纳，其他丢弃；
 * - stashVisible 收起的 toast 直接进入 tray，之后 sonner 触发的 onDismiss 因 id 已不在 visible 而被忽略。
 *
 * 放在 stores/ 而非 lib/：分层规则不允许 lib 依赖 stores，而 notify 需要读写本 store。
 */
export function createMessagesStore(api: ToastApi): UseBoundStore<StoreApi<MessagesState>> {
  /** 显示中 toast 的内容（非响应式） */
  const shown = new Map<string, AppMessage>()
  let seq = 0

  return create<MessagesState>((set, get) => {
    const stash = (messages: AppMessage[]): void => {
      const tray = get().tray
      const fresh = messages.filter((m) => !tray.some((x) => x.id === m.id))
      if (fresh.length === 0) return
      // 新的在前
      const next = [...fresh.reverse(), ...tray].slice(0, TRAY_LIMIT)
      set({ tray: next })
    }
    const show = (level: MessageLevel, text: string): void => {
      const id = `msg-${++seq}`
      const message: AppMessage = { id, level, text, at: Date.now() }
      shown.set(id, message)
      set({ visible: [...get().visible, id] })
      const finish = (): AppMessage | undefined => {
        const m = shown.get(id)
        if (!m) return undefined
        shown.delete(id)
        set({ visible: get().visible.filter((v) => v !== id) })
        return m
      }
      api.show(level, text, {
        id,
        onDismiss: () => {
          finish()
        },
        onAutoClose: () => {
          const m = finish()
          if (m && (m.level === 'error' || m.level === 'warning')) stash([m])
        }
      })
    }
    return {
      visible: [],
      tray: [],
      notify: show,
      stashVisible: () => {
        const ids = get().visible
        if (ids.length === 0) return
        const messages = ids.map((id) => shown.get(id)).filter((m): m is AppMessage => !!m)
        shown.clear()
        set({ visible: [] })
        stash(messages)
        for (const id of ids) api.dismiss(id)
      },
      restoreTray: () => {
        const tray = get().tray
        if (tray.length === 0) return
        set({ tray: [] })
        // 旧的先显示，保持时间顺序
        for (const m of [...tray].reverse()) show(m.level, m.text)
      }
    }
  })
}

const sonnerApi: ToastApi = {
  show: (level, text, options) => {
    toast[level](text, options)
  },
  dismiss: (id) => {
    toast.dismiss(id)
  }
}

export const useMessagesStore = createMessagesStore(sonnerApi)

/** 全应用 toast 的唯一入口 */
export function notify(level: MessageLevel, text: string): void {
  useMessagesStore.getState().notify(level, text)
}
