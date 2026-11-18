import type { JSX } from 'react'
import { LanguagesIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Language, Settings } from '@pch/shared'
import { Button } from '@pch/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@pch/ui/components/dropdown-menu'
import { useSetting, useUpdateSettings } from '@renderer/data/settings'
import { LANGUAGE_NAMES } from '../languages'

type LanguageSetting = Settings['general.language']

export function LanguageMenu(): JSX.Element {
  const { t } = useTranslation()
  const setting = useSetting('general.language') ?? 'system'
  const update = useUpdateSettings()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="app-no-drag"
            aria-label={t('language')}
          />
        }
      >
        <LanguagesIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('language')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={setting}
            onValueChange={(value) =>
              update.mutate({ 'general.language': value as LanguageSetting })
            }
          >
            <DropdownMenuRadioItem value="system">{t('followSystem')}</DropdownMenuRadioItem>
            {(Object.keys(LANGUAGE_NAMES) as Language[]).map((lang) => (
              <DropdownMenuRadioItem key={lang} value={lang} lang={lang}>
                {LANGUAGE_NAMES[lang]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
