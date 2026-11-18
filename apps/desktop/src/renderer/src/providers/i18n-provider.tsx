import { useEffect, useState, type JSX, type ReactNode } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { resolveLanguage } from '@pch/shared'
import { createI18n } from '@pch/i18n'
import { useSetting } from '@renderer/data/settings'
import { getBootstrap } from '@renderer/lib/ipc'

/**
 * 与主进程共用同一个 i18next 工厂和语言资源。
 * 首帧使用主进程传来的语言（bootstrap），之后跟随设置变化。
 */
export function I18nProvider({ children }: { children: ReactNode }): JSX.Element {
  const [i18n] = useState(() =>
    createI18n(getBootstrap()?.language ?? 'en', (instance) => instance.use(initReactI18next))
  )
  const setting = useSetting('general.language')

  useEffect(() => {
    if (!setting) return
    const language = resolveLanguage(setting, navigator.language)
    if (i18n.language !== language) void i18n.changeLanguage(language)
    document.documentElement.lang = language
  }, [i18n, setting])

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
}
