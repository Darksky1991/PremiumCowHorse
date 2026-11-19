import { describe, expect, it } from 'vitest'
import type { FileEntry } from '@pch/plugin-sdk'
import { breadcrumb, extensionOf, parentOf, sortEntries, visibleEntries } from './model'

const D = 'file:///C:/d'
const entry = (name: string, over: Partial<FileEntry> = {}): FileEntry => ({
  uri: `${D}/${encodeURIComponent(name)}`,
  name,
  kind: 'file',
  size: 0,
  mtime: 0,
  hidden: false,
  ...over
})
const dir = (name: string, over: Partial<FileEntry> = {}): FileEntry =>
  entry(name, { kind: 'directory', ...over })
const names = (list: readonly FileEntry[]): string[] => list.map((e) => e.name)

describe('sortEntries', () => {
  const list = [
    entry('file10.txt', { size: 30, mtime: 1 }),
    dir('b', { mtime: 5 }),
    entry('file2.txt', { size: 10, mtime: 3 }),
    entry('a.log', { size: 20, mtime: 2 }),
    dir('a10', { mtime: 1 }),
    dir('a9', { mtime: 9 }),
    entry('link', { kind: 'symlink', target: 'directory', mtime: 4 }),
    entry('broken', { kind: 'symlink', target: null, size: 5 })
  ]

  it('sorts by name naturally (numbers by value) with folders and folder links first', () => {
    expect(names(sortEntries(list, 'name', 'asc'))).toEqual([
      'a9',
      'a10',
      'b',
      'link',
      'a.log',
      'broken',
      'file2.txt',
      'file10.txt'
    ])
  })

  it('reverses each group in descending order but keeps folders first', () => {
    expect(names(sortEntries(list, 'name', 'desc'))).toEqual([
      'link',
      'b',
      'a10',
      'a9',
      'file10.txt',
      'file2.txt',
      'broken',
      'a.log'
    ])
  })

  it('sorts by size and by modified time; ties fall back to the name', () => {
    expect(names(sortEntries(list, 'size', 'asc'))).toEqual([
      // 目录的大小都是 0：按名称
      'a9',
      'a10',
      'b',
      'link',
      'broken',
      'file2.txt',
      'a.log',
      'file10.txt'
    ])
    expect(names(sortEntries(list, 'mtime', 'desc'))).toEqual([
      'a9',
      'b',
      'link',
      'a10',
      'file2.txt',
      'a.log',
      'file10.txt',
      'broken'
    ])
  })

  it('sorts files by extension for the type column', () => {
    expect(names(sortEntries(list, 'type', 'asc'))).toEqual([
      'a9',
      'a10',
      'b',
      'link',
      // 没有扩展名在前，再按扩展名（log < txt），同扩展名按名称
      'broken',
      'a.log',
      'file2.txt',
      'file10.txt'
    ])
  })

  it('does not change the input array', () => {
    const copy = [...list]
    sortEntries(list, 'size', 'desc')
    expect(list).toEqual(copy)
  })
})

describe('extensionOf', () => {
  it('returns the lower-cased text after the last dot; dot files and names without a dot have none', () => {
    expect(extensionOf('Report.XLSX')).toBe('xlsx')
    expect(extensionOf('a.tar.gz')).toBe('gz')
    expect(extensionOf('.gitignore')).toBe('')
    expect(extensionOf('README')).toBe('')
    expect(extensionOf('end.')).toBe('')
  })
})

describe('visibleEntries', () => {
  it('hides hidden entries unless asked to show them', () => {
    const list = [entry('a'), entry('h', { hidden: true })]
    expect(names(visibleEntries(list, false))).toEqual(['a'])
    expect(visibleEntries(list, true)).toBe(list)
  })
})

describe('breadcrumb', () => {
  const ROOT = 'file:///C:/work/%E6%A1%88%E4%BB%B6'

  it('starts at the entry root, decoding names', () => {
    expect(breadcrumb(`${ROOT}/%E8%A8%AD%E8%A8%88%E6%9B%B8/v1`, ROOT)).toEqual([
      { label: '案件', uri: ROOT },
      { label: '設計書', uri: `${ROOT}/%E8%A8%AD%E8%A8%88%E6%9B%B8` },
      { label: 'v1', uri: `${ROOT}/%E8%A8%AD%E8%A8%88%E6%9B%B8/v1` }
    ])
    expect(breadcrumb(ROOT, ROOT)).toEqual([{ label: '案件', uri: ROOT }])
  })

  it('goes up to the drive without an entry root', () => {
    expect(breadcrumb(`${ROOT}/a`, null)).toEqual([
      { label: 'C:', uri: 'file:///C:/' },
      { label: 'work', uri: 'file:///C:/work' },
      { label: '案件', uri: ROOT },
      { label: 'a', uri: `${ROOT}/a` }
    ])
    expect(breadcrumb('file:///C:/', null)).toEqual([{ label: 'C:', uri: 'file:///C:/' }])
    expect(breadcrumb('file:///C:/a/', null)).toEqual([
      { label: 'C:', uri: 'file:///C:/' },
      { label: 'a', uri: 'file:///C:/a' }
    ])
  })

  it('accepts the drive root as the entry root', () => {
    expect(breadcrumb('file:///D:/a', 'file:///D:/')).toEqual([
      { label: 'D:', uri: 'file:///D:/' },
      { label: 'a', uri: 'file:///D:/a' }
    ])
  })

  it('starts UNC paths at the share', () => {
    expect(breadcrumb('file://srv/share/a/b', null)).toEqual([
      { label: '\\\\srv\\share', uri: 'file://srv/share' },
      { label: 'a', uri: 'file://srv/share/a' },
      { label: 'b', uri: 'file://srv/share/a/b' }
    ])
    expect(breadcrumb('file://srv/share/a/b', 'file://srv/share/a')).toEqual([
      { label: 'a', uri: 'file://srv/share/a' },
      { label: 'b', uri: 'file://srv/share/a/b' }
    ])
  })

  it('ignores a root that is not an ancestor and keeps other URIs whole', () => {
    expect(breadcrumb('file:///C:/a', 'file:///C:/ab')).toEqual([
      { label: 'C:', uri: 'file:///C:/' },
      { label: 'a', uri: 'file:///C:/a' }
    ])
    expect(breadcrumb('sftp://h/x', null)).toEqual([{ label: 'sftp://h/x', uri: 'sftp://h/x' }])
  })

  it('keeps a segment that cannot be decoded as is', () => {
    expect(breadcrumb('file:///C:/%E6', null).at(-1)).toEqual({
      label: '%E6',
      uri: 'file:///C:/%E6'
    })
  })
})

describe('parentOf', () => {
  it('returns the parent directory regardless of the entry root, null at the drive or share', () => {
    expect(parentOf('file:///C:/a/b')).toBe('file:///C:/a')
    expect(parentOf('file:///C:/a')).toBe('file:///C:/')
    expect(parentOf('file:///C:/')).toBeNull()
    expect(parentOf('file://srv/share/a')).toBe('file://srv/share')
    expect(parentOf('file://srv/share')).toBeNull()
    expect(parentOf('sftp://h/x')).toBeNull()
  })
})
