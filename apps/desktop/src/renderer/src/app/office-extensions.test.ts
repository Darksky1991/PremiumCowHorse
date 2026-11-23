import { describe, expect, it } from 'vitest'
import { builtinPlugins } from '@pch/plugin-builtin'
import { OFFICE_EXTENSIONS } from '@pch/shared'

describe('Office 扩展名', () => {
  it('插件 manifest 的清单与主进程 launcher 的白名单（shared）一致', () => {
    const plugin = builtinPlugins.find((p) => p.manifest.id === 'pch.preview.office')
    expect([...(plugin?.manifest.match.extensions ?? [])].sort()).toEqual(
      [...OFFICE_EXTENSIONS].sort()
    )
  })
})
