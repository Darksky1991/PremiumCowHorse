import { describe, expect, it } from 'vitest'
import type { LayoutLocationKind, OpenSource } from '@pch/shared'
import { shouldRecordRecent } from './recent-policy'

const SOURCES: (OpenSource | undefined)[] = [
  'tree-select',
  'tree-open',
  'palette',
  'overview',
  'address',
  'plugin',
  'history',
  undefined
]
// D1：tree-open / palette / overview 记文件与目录；plugin 只记文件；其余不记
const FILE: Record<string, boolean> = {
  'tree-select': false,
  'tree-open': true,
  palette: true,
  overview: true,
  address: false,
  plugin: true,
  history: false,
  undefined: false
}
const DIRECTORY: Record<string, boolean> = { ...FILE, plugin: false }

describe('shouldRecordRecent', () => {
  for (const source of SOURCES) {
    it(`file / directory from ${String(source)}`, () => {
      expect(shouldRecordRecent('file', source)).toBe(FILE[String(source)])
      expect(shouldRecordRecent('directory', source)).toBe(DIRECTORY[String(source)])
    })
  }

  it('never records internal locations', () => {
    const kinds: LayoutLocationKind[] = ['workspace', 'workspaces', 'desktop', 'settings', 'about']
    for (const kind of kinds)
      for (const source of SOURCES) expect(shouldRecordRecent(kind, source)).toBe(false)
  })
})
