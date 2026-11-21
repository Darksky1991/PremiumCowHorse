import { describe, expect, it } from 'vitest'
import { FALLBACK_PLUGIN_ID } from '@pch/plugin-sdk'
import { openRequest, openTarget } from './open-target'
import type { NodeKind, TreeNode } from './tree-model'

const node = (kind: NodeKind, extra: Partial<TreeNode> = {}): TreeNode => ({
  id: `n-${kind}`,
  parentId: null,
  depth: 0,
  label: `label-${kind}`,
  kind,
  source: 'fs',
  entryId: 'e1',
  uri: `file:///C:/x/${kind}`,
  expandable: false,
  expanded: false,
  ...extra
})

describe('openTarget', () => {
  it.each<[NodeKind, 'file' | 'directory']>([
    ['folder', 'directory'],
    ['directory', 'directory'],
    ['link-directory', 'directory'],
    ['file', 'file'],
    ['link-file', 'file']
  ])('%s 打开为 %s，标题为节点显示名', (kind, expected) => {
    expect(openTarget(node(kind))).toEqual({
      uri: `file:///C:/x/${kind}`,
      kind: expected,
      title: `label-${kind}`
    })
  })

  it('分组、失效链接不可打开', () => {
    expect(openTarget(node('group', { uri: null }))).toBeNull()
    expect(openTarget(node('link-broken'))).toBeNull()
  })

  it('状态行（沿用父节点的 kind / uri）不可打开', () => {
    for (const status of ['loading', 'error', 'empty'] as const) {
      expect(openTarget(node('folder', { status, label: '' }))).toBeNull()
    }
  })

  it('没有 URI 的节点不可打开', () => {
    expect(openTarget(node('folder', { uri: null }))).toBeNull()
  })

  it('null（没有选中）不可打开', () => {
    expect(openTarget(null)).toBeNull()
  })
})

describe('openRequest（资源树的单击 / 双击 / Ctrl 打开什么）', () => {
  const fileNode = node('file')
  const fileUri = 'file:///C:/x/file'
  const fileTarget = { uri: fileUri, kind: 'file', title: 'label-file' }

  it.each<NodeKind>(['file', 'link-file'])(
    '%s：单击 / 键盘停留（select）在当前标签以「文件信息」打开',
    (kind) => {
      expect(openRequest(node(kind), 'select', 'file:///C:/x/other')).toEqual({
        target: openTarget(node(kind)),
        newTab: false,
        viewer: FALLBACK_PLUGIN_ID
      })
    }
  )

  it('文件：select 时当前标签已在显示该文件（无论哪个查看器）→ 什么都不做', () => {
    expect(openRequest(fileNode, 'select', fileUri)).toBeNull()
  })

  it('文件：没有标签时 select 也以「文件信息」打开（新建标签）', () => {
    expect(openRequest(fileNode, 'select', null)).toEqual({
      target: fileTarget,
      newTab: false,
      viewer: FALLBACK_PLUGIN_ID
    })
  })

  it('文件：双击 / Enter（activate）在当前标签以默认查看器打开；已在显示该文件时也是（换回默认）', () => {
    for (const active of [null, 'file:///C:/x/other', fileUri]) {
      expect(openRequest(fileNode, 'activate', active)).toEqual({
        target: fileTarget,
        newTab: false,
        viewer: null
      })
    }
  })

  it('文件：Ctrl+单击 / 中键 / Ctrl+Enter（newTab）在新标签以默认查看器打开', () => {
    expect(openRequest(fileNode, 'newTab', fileUri)).toEqual({ target: fileTarget, newTab: true })
  })

  it.each<NodeKind>(['folder', 'directory', 'link-directory'])(
    '%s：行为不变——select / activate 在当前标签、newTab 在新标签，不指定查看器',
    (kind) => {
      const target = openTarget(node(kind))
      const uri = `file:///C:/x/${kind}`
      expect(openRequest(node(kind), 'select', null)).toEqual({ target, newTab: false })
      expect(openRequest(node(kind), 'select', uri)).toEqual({ target, newTab: false })
      expect(openRequest(node(kind), 'activate', uri)).toEqual({ target, newTab: false })
      expect(openRequest(node(kind), 'newTab', uri)).toEqual({ target, newTab: true })
    }
  )

  it('不可打开的节点（分组、状态行、失效链接）：null', () => {
    for (const gesture of ['select', 'activate', 'newTab'] as const) {
      expect(openRequest(node('group', { uri: null }), gesture, null)).toBeNull()
      expect(openRequest(node('link-broken'), gesture, null)).toBeNull()
      expect(openRequest(node('file', { status: 'loading' }), gesture, null)).toBeNull()
    }
  })
})
