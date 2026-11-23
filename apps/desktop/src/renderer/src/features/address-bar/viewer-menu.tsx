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
import { useQueryClient } from '@tanstack/react-query'
import type { Settings } from '@pch/shared'
import { useSetting, useUpdateSettings } from '@renderer/data/settings'
import { queryKeys } from '@renderer/lib/query-keys'
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
  const queryClient = useQueryClient()
  const candidates = viewers?.candidates ?? []
  const current = candidates.find((c) => c.current)
  const ext = viewers?.ext ?? null

  const toggleAssociation = (checked: boolean): void => {
    if (ext === null || current === undefined) return
    // 读缓存中的最新值而不是渲染时快照：连续两次勾选（第一次的保存回写前）不会互相覆盖
    const latest = queryClient.getQueryData<Settings>(queryKeys.settings)?.['preview.associations']
    // 缓存未加载时不写：否则会以空对象清掉其他扩展名的关联
    if (latest === undefined) return
    const next = { ...latest }
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
            size="sm"
            className="max-w-40"
            aria-label={t('addressBar:viewer')}
            title={t('addressBar:viewer')}
            disabled={tabId === null || candidates.length < 2}
          />
        }
      >
        <EyeIcon />
        {current === undefined ? null : <span className="truncate">{current.name}</span>}
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
              closeOnClick
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
