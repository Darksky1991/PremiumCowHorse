import { describe, expect, it } from 'vitest'
import type { FileEntry } from '@pch/plugin-sdk'
import { extensionOf, sortEntries, visibleEntries } from './model'

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
