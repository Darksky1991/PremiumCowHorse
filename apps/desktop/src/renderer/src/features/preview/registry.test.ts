import { describe, expect, it } from 'vitest'
import {
  FALLBACK_PLUGIN_ID,
  type AnyPreviewPlugin,
  type PreviewPluginManifest,
  type ResourceInfo
} from '@pch/plugin-sdk'
import { pickPlugin, scoreResource } from './registry'

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
