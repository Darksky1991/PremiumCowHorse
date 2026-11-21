import { describe, expect, it } from 'vitest'
import {
  FALLBACK_PLUGIN_ID,
  TEXT_PLUGIN_ID,
  type AnyPreviewPlugin,
  type PreviewPluginManifest,
  type ResourceInfo
} from '@pch/plugin-sdk'
import {
  associationFor,
  candidatesFor,
  needsSniff,
  pickPlugin,
  pluginById,
  resolvePlugin,
  scoreResource
} from './registry'

const file = (name: string, extra: Partial<ResourceInfo> = {}): ResourceInfo => ({
  uri: `file:///C:/x/${encodeURIComponent(name)}`,
  name,
  kind: 'file',
  size: 100,
  mtime: 0,
  mime: null,
  ...extra
})
const dir: ResourceInfo = { ...file('設計書'), kind: 'directory', size: 0 }

const manifest = (
  match: PreviewPluginManifest['match'],
  extra: Partial<PreviewPluginManifest> = {}
): PreviewPluginManifest => ({ id: 'p', name: 'name', version: '1.0.0', match, ...extra })

const plugin = (id: string, m: PreviewPluginManifest): AnyPreviewPlugin => ({
  manifest: { ...m, id },
  load: () => Promise.reject(new Error('not loaded in tests'))
})

describe('scoreResource', () => {
  it('scores an extension hit 3, case-insensitively, plus priority', () => {
    expect(scoreResource(manifest({ extensions: ['png'] }), file('a.PNG'))).toBe(3)
    expect(scoreResource(manifest({ extensions: ['png'] }, { priority: 5 }), file('a.png'))).toBe(8)
  })

  it('matches multi-part extensions by suffix', () => {
    expect(scoreResource(manifest({ extensions: ['tar.gz'] }), file('a.tar.gz'))).toBe(3)
    expect(scoreResource(manifest({ extensions: ['gz'] }), file('a.tar.gz'))).toBe(3)
    // 名称恰好等于扩展名（没有点）不算命中
    expect(scoreResource(manifest({ extensions: ['png'] }), file('png'))).toBeNull()
  })

  it('scores an exact MIME 2 and a wildcard MIME 1', () => {
    expect(
      scoreResource(manifest({ mimeTypes: ['image/png'] }), file('a', { mime: 'image/png' }))
    ).toBe(2)
    expect(
      scoreResource(manifest({ mimeTypes: ['image/*'] }), file('a', { mime: 'image/png' }))
    ).toBe(1)
    expect(
      scoreResource(
        manifest({ extensions: ['png'], mimeTypes: ['image/*', 'image/png'] }),
        file('a.png', { mime: 'image/png' })
      )
    ).toBe(5)
  })

  it('requires a hit when extensions or MIME types are declared', () => {
    expect(scoreResource(manifest({ extensions: ['png'] }), file('a.txt'))).toBeNull()
    expect(scoreResource(manifest({ mimeTypes: ['image/*'] }), file('a.png'))).toBeNull()
    expect(
      scoreResource(manifest({ mimeTypes: ['image/*'] }), file('a', { mime: 'text/plain' }))
    ).toBeNull()
  })

  it('matches by kind alone with score 0 plus priority', () => {
    expect(scoreResource(manifest({ kinds: ['directory'] }), dir)).toBe(0)
    expect(scoreResource(manifest({ kinds: ['directory'] }, { priority: 2 }), dir)).toBe(2)
    expect(scoreResource(manifest({ kinds: ['directory'] }), file('a.txt'))).toBeNull()
  })

  it('excludes by scheme, maxSize and when', () => {
    expect(scoreResource(manifest({ schemes: ['sftp'] }), file('a.txt'))).toBeNull()
    expect(scoreResource(manifest({ schemes: ['file'] }), file('a.txt'))).toBe(0)
    expect(scoreResource(manifest({ maxSize: 99 }), file('a.txt'))).toBeNull()
    expect(scoreResource(manifest({ maxSize: 100 }), file('a.txt'))).toBe(0)
    expect(scoreResource(manifest({}, { when: () => false }), file('a.txt'))).toBeNull()
    expect(scoreResource(manifest({}, { when: (r) => r.name === 'a.txt' }), file('a.txt'))).toBe(0)
  })
})

describe('pickPlugin', () => {
  const fallback = plugin(FALLBACK_PLUGIN_ID, manifest({}))
  const folder = plugin('pch.preview.folder', manifest({ kinds: ['directory'] }))
  const text = plugin('text', manifest({ kinds: ['file'], extensions: ['txt', 'log'] }))
  const log = plugin('log', manifest({ kinds: ['file'], extensions: ['log'] }, { priority: 1 }))

  it('picks the highest score; ties go to the first registered', () => {
    expect(pickPlugin([fallback, folder, text, log], file('a.log'))).toBe(log)
    expect(pickPlugin([fallback, folder, text, log], file('a.txt'))).toBe(text)
    const text2 = plugin('text2', manifest({ extensions: ['txt'] }))
    expect(pickPlugin([fallback, text, text2], file('a.txt'))).toBe(text)
    expect(pickPlugin([fallback, folder, text], dir)).toBe(folder)
  })

  it('falls back when nothing matches; the fallback never competes', () => {
    expect(pickPlugin([folder, text, fallback], file('a.bin'))).toBe(fallback)
    // fallback 的 manifest 匹配一切，但不参与计分：0 分的 folder 仍然胜出
    expect(pickPlugin([fallback, folder], dir)).toBe(folder)
  })

  it('throws when the fallback plugin is missing', () => {
    expect(() => pickPlugin([text], file('a.bin'))).toThrow(FALLBACK_PLUGIN_ID)
  })
})

describe('textLike plugins (sniffed text files)', () => {
  const fallback = plugin(FALLBACK_PLUGIN_ID, manifest({}))
  const folder = plugin('pch.preview.folder', manifest({ kinds: ['directory'] }))
  const text = plugin(
    'pch.preview.text',
    manifest({ kinds: ['file'], extensions: ['txt', 'log'], textLike: true })
  )
  const image = plugin('image', manifest({ kinds: ['file'], extensions: ['png'] }))
  const all = [folder, text, image, fallback]

  it('do not take an unknown file that was not sniffed, or was sniffed as binary', () => {
    expect(pickPlugin(all, file('app.out'))).toBe(fallback)
    expect(pickPlugin(all, file('app.out', { textLike: false }))).toBe(fallback)
  })

  it('take an unknown file sniffed as text', () => {
    expect(pickPlugin(all, file('app.out', { textLike: true }))).toBe(text)
    expect(scoreResource(text.manifest, file('app.out', { textLike: true }))).toBe(0)
  })

  it('an extension match wins over textLike', () => {
    expect(pickPlugin(all, file('a.png', { textLike: true }))).toBe(image)
    expect(pickPlugin(all, file('a.log'))).toBe(text)
  })

  it('still honour kinds, schemes, maxSize and when', () => {
    const small = plugin('small', manifest({ textLike: true, maxSize: 10 }))
    expect(pickPlugin([small, fallback], file('a.out', { textLike: true }))).toBe(fallback)
    const sftp = plugin('sftp', manifest({ textLike: true, schemes: ['sftp'] }))
    expect(pickPlugin([sftp, fallback], file('a.out', { textLike: true }))).toBe(fallback)
  })

  it('a plugin declaring only textLike (no extensions / MIME) takes nothing but sniffed text', () => {
    const only = plugin('only', manifest({ kinds: ['file'], textLike: true }))
    const list = [only, fallback]
    expect(scoreResource(only.manifest, file('a.out'))).toBeNull()
    expect(scoreResource(only.manifest, file('a.out', { textLike: false }))).toBeNull()
    expect(scoreResource(only.manifest, file('a.out', { textLike: true }))).toBe(0)
    expect(pickPlugin(list, file('a.bin', { textLike: false }))).toBe(fallback)
    expect(needsSniff(list, file('a.out'))).toBe(true)
  })

  it('needsSniff: only an unmatched, non-empty file with a textLike plugin registered', () => {
    expect(needsSniff(all, file('app.out'))).toBe(true)
    expect(needsSniff(all, file('a.log'))).toBe(false)
    expect(needsSniff(all, file('a.png'))).toBe(false)
    expect(needsSniff(all, dir)).toBe(false)
    expect(needsSniff(all, file('empty.out', { size: 0 }))).toBe(false)
    expect(needsSniff([folder, image, fallback], file('app.out'))).toBe(false)
    // 已经判断过
    expect(needsSniff(all, file('app.out', { textLike: false }))).toBe(false)
  })

  it('pluginById finds a registered plugin, or null', () => {
    expect(pluginById(all, 'pch.preview.text')).toBe(text)
    expect(pluginById([folder, fallback], 'pch.preview.text')).toBeNull()
  })
})

describe('viewer selection', () => {
  const HTML_ID = 'pch.preview.html'
  const OFFICE_ID = 'pch.preview.office'
  const fallback = plugin(FALLBACK_PLUGIN_ID, manifest({}))
  const folder = plugin('pch.preview.folder', manifest({ kinds: ['directory'] }))
  const text = plugin(
    TEXT_PLUGIN_ID,
    manifest({ kinds: ['file'], extensions: ['txt', 'log'], textLike: true })
  )
  const html = plugin(HTML_ID, manifest({ kinds: ['file'], extensions: ['html'] }, { priority: 1 }))
  const office = plugin(OFFICE_ID, manifest({ kinds: ['file'], extensions: ['xlsx', 'docx'] }))
  const ids = (list: readonly AnyPreviewPlugin[]): string[] => list.map((p) => p.manifest.id)

  describe('candidatesFor', () => {
    it('html file: the matching plugin, then text (always for files), then fallback', () => {
      const all = [folder, html, text, fallback]
      expect(ids(candidatesFor(all, file('a.html')))).toEqual([
        HTML_ID,
        TEXT_PLUGIN_ID,
        FALLBACK_PLUGIN_ID
      ])
    })

    it('xlsx file: text is offered even though it does not match by extension', () => {
      const all = [folder, office, text, fallback]
      expect(ids(candidatesFor(all, file('a.xlsx')))).toEqual([
        OFFICE_ID,
        TEXT_PLUGIN_ID,
        FALLBACK_PLUGIN_ID
      ])
    })

    it('directory: folder, then fallback (no text)', () => {
      const all = [folder, html, text, fallback]
      expect(ids(candidatesFor(all, dir))).toEqual(['pch.preview.folder', FALLBACK_PLUGIN_ID])
    })

    it('has no duplicates and orders matches by score', () => {
      const all = [folder, text, html, fallback]
      expect(ids(candidatesFor(all, file('a.txt')))).toEqual([TEXT_PLUGIN_ID, FALLBACK_PLUGIN_ID])
      expect(ids(candidatesFor(all, file('a.out', { textLike: true })))).toEqual([
        TEXT_PLUGIN_ID,
        FALLBACK_PLUGIN_ID
      ])
      const low = plugin('low', manifest({ kinds: ['file'], extensions: ['html'] }))
      expect(ids(candidatesFor([low, html, text, fallback], file('a.html')))).toEqual([
        HTML_ID,
        'low',
        TEXT_PLUGIN_ID,
        FALLBACK_PLUGIN_ID
      ])
    })

    it('omits text when the text plugin is not registered', () => {
      expect(ids(candidatesFor([html, fallback], file('a.html')))).toEqual([
        HTML_ID,
        FALLBACK_PLUGIN_ID
      ])
    })
  })

  describe('associationFor', () => {
    it('picks the longest matching extension', () => {
      expect(associationFor('a.tar.gz', { gz: 'x', 'tar.gz': 'y' })).toBe('y')
      expect(associationFor('a.gz', { gz: 'x', 'tar.gz': 'y' })).toBe('x')
    })
    it('is null without an extension or a match', () => {
      expect(associationFor('README', {})).toBeNull()
      expect(associationFor('README', { md: 'x' })).toBeNull()
      expect(associationFor('a.txt', {})).toBeNull()
    })
    it('is case-insensitive on both sides', () => {
      expect(associationFor('A.HTML', { html: 'x' })).toBe('x')
      expect(associationFor('a.html', { HTML: 'x' })).toBe('x')
    })
  })

  describe('resolvePlugin', () => {
    const all = [folder, html, office, text, fallback]
    const none = {}
    it('uses the viewer when it is a candidate', () => {
      expect(
        resolvePlugin(all, file('a.html'), {
          viewer: TEXT_PLUGIN_ID,
          associations: { html: OFFICE_ID }
        })
      ).toBe(text)
      expect(
        resolvePlugin(all, file('a.txt'), { viewer: FALLBACK_PLUGIN_ID, associations: none })
      ).toBe(fallback)
    })
    it('ignores a viewer that is not a candidate and looks at associations', () => {
      expect(
        resolvePlugin(all, file('a.html'), {
          viewer: OFFICE_ID,
          associations: { html: TEXT_PLUGIN_ID }
        })
      ).toBe(text)
      expect(resolvePlugin(all, file('a.html'), { viewer: 'gone', associations: none })).toBe(html)
    })
    it('ignores an association pointing to a non-candidate plugin', () => {
      expect(
        resolvePlugin(all, file('a.html'), { viewer: null, associations: { html: OFFICE_ID } })
      ).toBe(html)
      expect(
        resolvePlugin(all, file('a.html'), { viewer: null, associations: { html: 'gone' } })
      ).toBe(html)
    })
    it('uses a valid association, else normal selection', () => {
      expect(
        resolvePlugin(all, file('a.html'), { viewer: null, associations: { html: TEXT_PLUGIN_ID } })
      ).toBe(text)
      expect(resolvePlugin(all, file('a.xlsx'), { viewer: null, associations: none })).toBe(office)
      expect(resolvePlugin(all, file('a.bin'), { viewer: null, associations: none })).toBe(fallback)
    })
  })
})
