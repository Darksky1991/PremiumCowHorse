import { createContext, useContext } from 'react'

export type ResolvedTheme = 'light' | 'dark'

export const ThemeContext = createContext<ResolvedTheme>('light')

/** 当前实际生效的明暗主题（「跟随系统」已解析） */
export const useResolvedTheme = (): ResolvedTheme => useContext(ThemeContext)
