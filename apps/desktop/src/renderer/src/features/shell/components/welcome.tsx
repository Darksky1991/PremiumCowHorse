import type { JSX } from 'react'
import { FolderOpenIcon, PlusIcon, ServerIcon, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@pch/ui/components/button'
import { Kbd, KbdGroup } from '@pch/ui/components/kbd'
import { Separator } from '@pch/ui/components/separator'
import { useActiveWorkspace, workspaceDisplayName } from '@renderer/data/workspace'
import { useUiStore } from '@renderer/stores/ui-store'
import { notifyComingSoon } from '../coming-soon'

/**
 * 没有打开任何标签时的内容区。工作区名称是这一屏唯一的视觉重点；
 * 内容靠左上排布，符合工具软件的阅读起点，而不是营销页式的居中。
 */
export function Welcome(): JSX.Element {
  const { t, i18n } = useTranslation(['welcome', 'common'])
  const { data: active } = useActiveWorkspace()
  const setNewWorkspaceOpen = useUiStore((s) => s.setNewWorkspaceOpen)
  const soon = (): void => notifyComingSoon(i18n)

  const actions: { icon: LucideIcon; label: string; onClick: () => void }[] = [
    { icon: PlusIcon, label: t('newWorkspace'), onClick: () => setNewWorkspaceOpen(true) },
    { icon: FolderOpenIcon, label: t('openFolder'), onClick: soon },
    { icon: ServerIcon, label: t('connectRemote'), onClick: soon }
  ]
  const shortcuts: { keys: string[]; label: string }[] = [
    { keys: ['Ctrl', 'K'], label: t('shortcutCommand') },
    { keys: ['Ctrl', 'B'], label: t('shortcutSidebar') },
    { keys: ['Ctrl', ','], label: t('shortcutSettings') }
  ]

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="flex max-w-3xl flex-col gap-10 px-14 pt-16 pb-10">
        <header className="flex flex-col gap-3">
          <h1 className="text-5xl font-semibold tracking-tight">
            {active ? workspaceDisplayName(active, t('common:defaultWorkspace')) : null}
          </h1>
          <p className="max-w-prose text-muted-foreground">{t('subtitle')}</p>
        </header>

        <Separator />

        <div className="grid gap-10 sm:grid-cols-2">
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">{t('startTitle')}</h2>
            <ul className="-ml-2.5 flex flex-col">
              {actions.map(({ icon: Icon, label, onClick }) => (
                <li key={label}>
                  <Button variant="ghost" className="w-full justify-start" onClick={onClick}>
                    <Icon data-icon="inline-start" />
                    {label}
                  </Button>
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">{t('shortcutsTitle')}</h2>
            <dl className="flex flex-col">
              {shortcuts.map(({ keys, label }) => (
                <div key={label} className="flex h-9 items-center justify-between gap-4 text-sm">
                  <dt>{label}</dt>
                  <dd>
                    <KbdGroup>
                      {keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </KbdGroup>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  )
}
