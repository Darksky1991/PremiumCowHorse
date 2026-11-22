import { DESKTOP_COLLECTORS, type DesktopItem } from '@pch/shared'
import type { Logger } from '../../infra/logger'
import type { runPowerShell } from '../../infra/powershell'
import type { Collector } from './collectors/types'
import type { RestoreDeps } from './restore'
import type { ListWindows } from './window-list'

/** e2e 假模式下替换的依赖 */
export interface FakeDesktop {
  listWindows: ListWindows
  collectors: Collector[]
  logonAt: () => Promise<number>
  restoreDeps: Omit<RestoreDeps, 'sleep' | 'logger'>
}

function parseItems(json: string | undefined, logger: Logger): DesktopItem[] {
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    if (Array.isArray(parsed)) return parsed as DesktopItem[]
  } catch {
    // 落到下面的 warn
  }
  logger.warn('[desktop:fake] PCH_E2E_DESKTOP_ITEMS is not a JSON array; using []')
  return []
}

/**
 * 仅 e2e（组合根只在未打包且 PCH_E2E_FAKE_DESKTOP=1 时使用，同 PCH_E2E_FAKE_LAUNCHER）：
 * 窗口列表为空；采集结果取 PCH_E2E_DESKTOP_ITEMS（JSON DesktopItem[]，全部归 office 类，其余类为空）；
 * 登录时刻取 PCH_E2E_LOGON_AT；恢复不启动任何程序，只记日志 `[desktop:fake] spawn <exe> <args JSON>`；
 * 存在性检查恒为 yes
 */
export function createFakeDesktop(env: NodeJS.ProcessEnv, logger: Logger): FakeDesktop {
  const items = parseItems(env.PCH_E2E_DESKTOP_ITEMS, logger)
  const fakeRun: typeof runPowerShell = async (_script, psEnv) => {
    logger.info(`[desktop:fake] powershell ${JSON.stringify(psEnv)}`)
    return ''
  }
  return {
    listWindows: () => [],
    collectors: DESKTOP_COLLECTORS.map((id) => ({
      id,
      collect: async () => (id === 'office' ? items : [])
    })),
    logonAt: async () => {
      const v = Number(env.PCH_E2E_LOGON_AT)
      if (!env.PCH_E2E_LOGON_AT || !Number.isFinite(v)) throw new Error('PCH_E2E_LOGON_AT not set')
      return v
    },
    restoreDeps: {
      spawnDetached: async (exe, args) => {
        logger.info(`[desktop:fake] spawn ${exe} ${JSON.stringify(args)}`)
      },
      runPowerShell: fakeRun,
      exists: async () => 'yes'
    }
  }
}
