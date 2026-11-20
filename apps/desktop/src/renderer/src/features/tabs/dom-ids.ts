/** 标签与标签面板的 DOM id（tab 的 aria-controls / 面板的 aria-labelledby 互相引用） */
export const tabDomId = (baseId: string, id: string): string => `${baseId}-tab-${id}`
export const panelDomId = (baseId: string): string => `${baseId}-panel`
