/** 集中管理 query key，主进程事件到缓存失效的桥接也依赖这里 */
export const queryKeys = {
  appInfo: ['app', 'info'] as const,
  settings: ['settings'] as const
}
