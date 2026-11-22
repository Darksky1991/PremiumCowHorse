import { describe, expect, it } from 'vitest'
import { builtinPlugins } from './index'

describe('builtin plugin manifests', () => {
  it('office / html / markdown / text 只匹配本机资源（file:）；folder 与 fallback 不限（设计 M4 5.8）', () => {
    const schemes = Object.fromEntries(
      builtinPlugins.map((p) => [p.manifest.id, p.manifest.match.schemes])
    )
    expect(schemes).toEqual({
      'pch.preview.folder': undefined,
      'pch.preview.html': ['file'],
      'pch.preview.markdown': ['file'],
      'pch.preview.office': ['file'],
      'pch.preview.text': ['file'],
      'pch.preview.fallback': undefined
    })
  })
})
