import type { JSX } from 'react'
import { BellIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useMessagesStore } from '@renderer/stores/messages-store'

/** 状态栏的未确认消息入口：有收纳的消息时显示件数，点击重新显示 */
export function MessageTrayButton(): JSX.Element | null {
  const { t } = useTranslation()
  const count = useMessagesStore((s) => s.tray.length)
  const restore = useMessagesStore((s) => s.restoreTray)
  if (count === 0) return null
  return (
    <button
      type="button"
      className="flex items-center gap-1 rounded px-1 hover:bg-accent hover:text-accent-foreground"
      title={t('messagesRestore')}
      onClick={restore}
    >
      <BellIcon className="size-3.5" aria-hidden />
      {t('messages', { count })}
    </button>
  )
}
