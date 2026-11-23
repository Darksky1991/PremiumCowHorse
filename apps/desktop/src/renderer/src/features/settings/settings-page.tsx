import { useMemo, useState, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { InfoIcon, SearchIcon } from 'lucide-react'
import type { SettingKey, SettingsPatch, TabState } from '@pch/shared'
import { cn } from 'cn'
import { Input } from '@pch/ui/components/input'
import { useSettings, useUpdateSettings } from '@renderer/data/settings'
import { AssociationsBlock, CacheBlock, PrivacyBlock } from './blocks'
import { SETTINGS_SECTIONS, itemId, type SectionId } from './sections'
import { SettingRow } from './setting-row'
import { useOpenAbout } from './use-open-builtin'

export interface SettingsPageProps {
  /** 显示设置页（kind 为 settings，uri 为 pch-settings:）的标签 */
  tab: TabState
}

/** 分区里不是「键」的块：与键一起参与搜索 */
const BLOCKS: Partial<Record<SectionId, readonly ('associations' | 'cache' | 'privacy')[]>> = {
  explorer: ['associations'],
  cache: ['cache'],
  privacy: ['privacy']
}

/**
 * 设置页（M5，设计 devDoc/2026-11-23-42 第 5.E 节）：左侧分区导航 + 右侧设置项 + 顶部搜索。
 * 搜索按当前语言的名称与说明筛选，有关键字时把所有分区的命中项依次列出
 */
// 标签本身目前不携带页面状态（单页、无参数），props 只为与其他内置页的 render 约定一致
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function SettingsPage(_props: SettingsPageProps): JSX.Element {
  const { t } = useTranslation('settings')
  const { data: settings } = useSettings()
  const update = useUpdateSettings()
  const openAbout = useOpenAbout()
  const [active, setActive] = useState<SectionId>('general')
  const [query, setQuery] = useState('')

  const commit = (key: SettingKey, value: unknown): void => {
    update.mutate({ [key]: value } as SettingsPatch)
  }

  const needle = query.trim().toLowerCase()
  const visible = useMemo(() => {
    const matches = (...texts: string[]): boolean =>
      texts.some((text) => text.toLowerCase().includes(needle))
    return SETTINGS_SECTIONS.map(({ id, keys }) => {
      const sectionHit = matches(t(`sections.${id}`))
      const blocks = (BLOCKS[id] ?? []).filter(
        (b) =>
          needle === '' ||
          sectionHit ||
          (b === 'associations' && matches(t('associations.title'), t('associations.desc'))) ||
          (b === 'cache' && matches(t('cache.usage'), t('cache.clear'))) ||
          (b === 'privacy' &&
            matches(t('privacy.recentTitle'), t('privacy.recentDesc'), t('privacy.clearRecent')))
      )
      const shown = keys.filter(
        (key) =>
          needle === '' ||
          sectionHit ||
          matches(t(`item.${itemId(key)}.name`), t(`item.${itemId(key)}.desc`))
      )
      return { id, keys: shown, blocks }
    }).filter((s) => s.keys.length > 0 || s.blocks.length > 0)
    // t 随语言变化而变化
  }, [needle, t])

  const shownSections = needle === '' ? visible.filter((s) => s.id === active) : visible

  return (
    <div className="flex h-full min-h-0">
      <nav
        aria-label={t('navLabel')}
        className="flex w-52 shrink-0 flex-col gap-0.5 border-r bg-sidebar p-2"
      >
        {SETTINGS_SECTIONS.map(({ id }) => (
          <button
            key={id}
            type="button"
            aria-current={needle === '' && active === id ? 'page' : undefined}
            onClick={() => {
              setQuery('')
              setActive(id)
            }}
            className={cn(
              'rounded-md px-3 py-1.5 text-left text-sm outline-none hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50',
              needle === '' && active === id && 'bg-accent text-accent-foreground'
            )}
          >
            {t(`sections.${id}`)}
          </button>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          onClick={openAbout}
          className="flex items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-muted-foreground outline-none hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <InfoIcon className="size-4" />
          {t('about')}
        </button>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b p-3">
          <div className="relative max-w-md">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label={t('searchLabel')}
              placeholder={t('searchPlaceholder')}
              value={query}
              className="pl-8"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-8 py-4">
          <div className="mx-auto flex max-w-3xl flex-col gap-6">
            {settings === undefined ? null : shownSections.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t('noResults')}</p>
            ) : (
              shownSections.map(({ id, keys, blocks }) => (
                <section key={id} aria-labelledby={`settings-section-${id}`}>
                  <h2 id={`settings-section-${id}`} className="mb-1 text-lg font-semibold">
                    {t(`sections.${id}`)}
                  </h2>
                  <div>
                    {blocks.includes('cache') ? <CacheBlock /> : null}
                    {keys.map((key) => (
                      <SettingRow
                        key={key}
                        settingKey={key}
                        value={settings[key]}
                        onCommit={commit}
                      />
                    ))}
                    {blocks.includes('associations') ? (
                      <AssociationsBlock
                        associations={settings['preview.associations']}
                        onChange={(next) => commit('preview.associations', next)}
                      />
                    ) : null}
                    {blocks.includes('privacy') ? <PrivacyBlock /> : null}
                  </div>
                </section>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
