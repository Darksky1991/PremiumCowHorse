import type { ComponentProps, JSX } from 'react'
import { CopyIcon, MinusIcon, SquareIcon, XIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from 'cn'
import { useWindowState } from '@renderer/data/window'
import { call } from '@renderer/lib/ipc'

/**
 * 自绘的窗口按钮（Windows / Linux）。不使用系统原生按钮或 Window Controls Overlay：
 * 外观与主题一致，也不会遮挡标题栏的边框。尺寸与交互参照 Windows 11 的标题栏按钮。
 */
export function WindowControls(): JSX.Element {
  const { t } = useTranslation()
  const { maximized } = useWindowState()

  return (
    <div className="app-no-drag flex h-full self-stretch">
      <CaptionButton label={t('minimize')} onClick={() => void call('window.minimize', undefined)}>
        <MinusIcon />
      </CaptionButton>
      <CaptionButton
        label={maximized ? t('restore') : t('maximize')}
        onClick={() => void call('window.toggleMaximize', undefined)}
      >
        {/* 「还原」用两个叠放的方框表示，与系统惯例一致 */}
        {maximized ? (
          <CopyIcon className="size-3.5 -scale-x-100" />
        ) : (
          <SquareIcon className="size-3" />
        )}
      </CaptionButton>
      <CaptionButton
        label={t('close')}
        onClick={() => void call('window.close', undefined)}
        className="hover:bg-destructive hover:text-white active:bg-destructive/80"
      >
        <XIcon />
      </CaptionButton>
    </div>
  )
}

function CaptionButton({
  label,
  className,
  ...props
}: ComponentProps<'button'> & { label: string }): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // 窗口按钮不参与 Tab 键顺序（与系统标题栏一致），用快捷键或鼠标操作
      tabIndex={-1}
      className={cn(
        'flex h-full w-12 items-center justify-center text-sidebar-foreground transition-colors hover:bg-foreground/10 active:bg-foreground/15 [&_svg]:size-4 [&_svg]:stroke-[1.5]',
        className
      )}
      {...props}
    />
  )
}
