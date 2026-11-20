import type { JSX } from 'react'
import { EyeIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@pch/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@pch/ui/components/dropdown-menu'
import { useSetting, useUpdateSettings } from '@renderer/data/settings'
import { useTabsStore } from '@renderer/stores/tabs-store'
import { useViewerStore } from '@renderer/stores/viewer-store'

/**
 * 查看器下拉（设计 devDoc/2026-11-20-22 5.1 节）：列出当前标签资源可用的查看器（单选，选中即切换，
 * 记入标签历史）；候选少于 2 个时禁用。分隔线下「.ext は常にこれで開く」写入 / 删除设置
 * preview.associations 的该扩展名（勾选 = 当前查看器成为该扩展名的默认）。
 * 候选由预览容器写入 viewer-store（名称已翻译）。
 */
export function ViewerMenu({ tabId }: { tabId: string | null }): JSX.Element {
  const { t } = useTranslation()
  const viewers = useViewerStore((s) => (tabId === null ? undefined : s.byTab[tabId]))
  const setViewer = useTabsStore((s) => s.setViewer)
  const associations = useSetting('preview.associations')
  const update = useUpdateSettings()
  const candidates = viewers?.candidates ?? []
  const current = candidates.find((c) => c.current)
  const ext = viewers?.ext ?? null

  const toggleAssociation = (checked: boolean): void => {
    if (ext === null || current === undefined) return
    const next = { ...associations }
    if (checked) next[ext] = current.id
    else delete next[ext]
    update.mutate({ 'preview.associations': next })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('addressBar:viewer')}
            title={t('addressBar:viewer')}
            disabled={tabId === null || candidates.length < 2}
          />
        }
      >
        <EyeIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('addressBar:viewer')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={current?.id ?? ''}
            onValueChange={(id) => {
              if (tabId !== null) setViewer(tabId, id)
            }}
          >
            {candidates.map((c) => (
              <DropdownMenuRadioItem key={c.id} value={c.id} closeOnClick>
                <span className="truncate">{c.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {ext === null || current === undefined ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={associations?.[ext] === current.id}
              onCheckedChange={toggleAssociation}
            >
              {t('addressBar:alwaysOpenWith', { ext })}
            </DropdownMenuCheckboxItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
