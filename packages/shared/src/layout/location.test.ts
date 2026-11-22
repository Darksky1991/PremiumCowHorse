import { describe, expect, it } from 'vitest'
import {
  desktopIdOfUri,
  desktopLocation,
  desktopUri,
  isWorkspacesUri,
  WORKSPACES_URI,
  workspaceIdOfUri,
  workspaceLocation,
  workspacesLocation,
  workspaceUri
} from './location'

describe('工作区总览的位置', () => {
  it('URI 为 pch-workspace:<id>，可以取回 id', () => {
    expect(workspaceUri('w1')).toBe('pch-workspace:w1')
    expect(workspaceIdOfUri('pch-workspace:w1')).toBe('w1')
    expect(workspaceLocation('w1', '保守')).toEqual({
      uri: 'pch-workspace:w1',
      kind: 'workspace',
      title: '保守'
    })
  })

  it('不是总览 URI（文件 URI、id 为空、工作区一览）时为 null', () => {
    expect(workspaceIdOfUri('file:///C:/a')).toBeNull()
    expect(workspaceIdOfUri('pch-workspace:')).toBeNull()
    expect(workspaceIdOfUri(WORKSPACES_URI)).toBeNull()
  })
})

describe('工作区一览的位置', () => {
  it('URI 固定为 pch-workspaces:（只有一页，不带 id）', () => {
    expect(WORKSPACES_URI).toBe('pch-workspaces:')
    expect(workspacesLocation('ワークスペース一覧')).toEqual({
      uri: 'pch-workspaces:',
      kind: 'workspaces',
      title: 'ワークスペース一覧'
    })
  })

  it('isWorkspacesUri 只认一览的 URI（工作区总览、文件 URI 不是）', () => {
    expect(isWorkspacesUri('pch-workspaces:')).toBe(true)
    expect(isWorkspacesUri('pch-workspace:w1')).toBe(false)
    expect(isWorkspacesUri('file:///C:/a')).toBe(false)
  })
})

describe('桌面记录的位置', () => {
  it('URI 为 pch-desktop:<id|current>，可以取回 id', () => {
    expect(desktopIdOfUri(desktopUri(12))).toBe(12)
    expect(desktopIdOfUri('pch-desktop:current')).toBe('current')
    expect(desktopIdOfUri(desktopUri('current'))).toBe('current')
  })
  it('不是桌面记录 URI 时为 null', () => {
    expect(desktopIdOfUri('pch-desktop:abc')).toBeNull()
    expect(desktopIdOfUri('pch-workspace:1')).toBeNull()
  })
  it('位置的 kind 为 desktop', () => {
    expect(desktopLocation(3, '标题')).toEqual({
      uri: 'pch-desktop:3',
      kind: 'desktop',
      title: '标题'
    })
  })
})
