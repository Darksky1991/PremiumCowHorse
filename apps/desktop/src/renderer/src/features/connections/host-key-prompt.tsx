import { useEffect, useState, type JSX } from 'react'
import { ShieldQuestionIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { HostKeyInfo, HostKeyPrompt } from '@pch/shared'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle
} from '@pch/ui/components/alert-dialog'
import {
  answerHostKey,
  pendingHostKeyPrompts,
  subscribeHostKeyPrompts
} from '@renderer/data/connections'
import { notify } from '@renderer/stores/messages-store'
import { hostPort } from './connection-form'
import { errorText } from './error-text'
import { enqueuePrompt, startHostKeyPromptSync } from './prompt-queue'

/**
 * 首次连接时的主机密钥确认（设计 5.3）：主进程发来 connection.hostKeyPrompt，在这里显示连接名、主机、
 * 算法与 SHA256 指纹，「信任并连接」/「取消」经 connection.answerHostKey 回答（Esc 等关闭视同取消）。
 * 挂载时先查询尚未回答的询问（窗口重新加载后不丢失），多个询问依次显示。主窗口挂载一次
 */
export function HostKeyPrompts(): JSX.Element {
  const { t } = useTranslation()
  const [queue, setQueue] = useState<readonly HostKeyPrompt[]>([])
  // 关闭动画期间内容保持为最后显示的询问（渲染中记录上一次的值：React 文档「保存前一次渲染的信息」）
  const [last, setLast] = useState<HostKeyPrompt | null>(null)

  useEffect(
    () =>
      startHostKeyPromptSync({
        subscribe: subscribeHostKeyPrompts,
        fetchPending: pendingHostKeyPrompts,
        add: (p) => setQueue((q) => enqueuePrompt(q, p))
      }),
    []
  )

  const current = queue[0]
  if (current !== undefined && current !== last) setLast(current)
  const shown = current ?? last

  const answer = (accept: boolean): void => {
    if (!current) return
    const { promptId } = current
    setQueue((q) => q.filter((p) => p.promptId !== promptId))
    answerHostKey(promptId, accept).catch((e: unknown) => notify('error', errorText(t, e)))
  }

  return (
    <AlertDialog
      open={current !== undefined}
      onOpenChange={(open) => {
        if (!open) answer(false)
      }}
    >
      {shown === null ? null : (
        <AlertDialogContent key={shown.promptId}>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <ShieldQuestionIcon />
            </AlertDialogMedia>
            <AlertDialogTitle>{t('connections:promptTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('connections:promptDescription', {
                name: shown.name,
                address: hostPort(shown.host, shown.port)
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <HostKeyDetails hostKey={shown.key} />
          {queue.length > 1 ? (
            <p className="text-xs text-muted-foreground">
              {t('connections:promptMore', { count: queue.length - 1 })}
            </p>
          ) : null}
          <AlertDialogFooter>
            {/* 「取消」关闭对话框 → onOpenChange(false) → 拒绝 */}
            <AlertDialogCancel>{t('connections:cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => answer(true)}>
              {t('connections:promptAccept')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  )
}

/** 算法与指纹（指纹用等宽字体，可整体换行） */
export function HostKeyDetails({ hostKey }: { hostKey: HostKeyInfo }): JSX.Element {
  const { t } = useTranslation()
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      <dt className="text-muted-foreground">{t('connections:algorithm')}</dt>
      <dd className="font-mono">{hostKey.algorithm}</dd>
      <dt className="text-muted-foreground">{t('connections:fingerprint')}</dt>
      <dd className="font-mono break-all">{hostKey.fingerprint}</dd>
    </dl>
  )
}
