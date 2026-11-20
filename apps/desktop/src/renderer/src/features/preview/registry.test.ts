import { describe, expect, it } from 'vitest'
import {
  FALLBACK_PLUGIN_ID,
  TEXT_PLUGIN_ID,
  type AnyPreviewPlugin,
  type PreviewPluginManifest,
  type ResourceInfo
} from '@pch/plugin-sdk'
import {
  canViewAs,
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

describe('view-as overrides', () => {
  const fallback = plugin(FALLBACK_PLUGIN_ID, manifest({}))
  const folder = plugin('pch.preview.folder', manifest({ kinds: ['directory'] }))
  const text = plugin(TEXT_PLUGIN_ID, manifest({ kinds: ['file'], extensions: ['txt'] }))
  const all = [folder, text, fallback]

  it('resolvePlugin: info → fallback, text → the text plugin, null → normal selection', () => {
    expect(resolvePlugin(all, file('a.bin'), 'text')).toBe(text)
    expect(resolvePlugin(all, file('a.txt'), 'info')).toBe(fallback)
    expect(resolvePlugin(all, file('a.txt'), null)).toBe(text)
    // 文本插件未注册（Task 6 之前）：退回 fallback
    expect(resolvePlugin([folder, fallback], file('a.bin'), 'text')).toBe(fallback)
  })

  it('canViewAs: text only for files, when registered and not already shown', () => {
    expect(canViewAs(all, file('a.bin'), FALLBACK_PLUGIN_ID, 'text')).toBe(true)
    expect(canViewAs(all, file('a.txt'), TEXT_PLUGIN_ID, 'text')).toBe(false)
    expect(canViewAs(all, dir, FALLBACK_PLUGIN_ID, 'text')).toBe(false)
    expect(canViewAs([folder, fallback], file('a.bin'), FALLBACK_PLUGIN_ID, 'text')).toBe(false)
  })

  it('canViewAs: info unless the fallback is already shown', () => {
    expect(canViewAs(all, file('a.txt'), TEXT_PLUGIN_ID, 'info')).toBe(true)
    expect(canViewAs(all, dir, 'pch.preview.folder', 'info')).toBe(true)
    expect(canViewAs(all, file('a.bin'), FALLBACK_PLUGIN_ID, 'info')).toBe(false)
  })
})
