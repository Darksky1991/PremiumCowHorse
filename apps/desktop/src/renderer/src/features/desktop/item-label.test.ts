import { describe, expect, it } from 'vitest'
import type { DesktopItem } from '@pch/shared'
import { itemLabel, tabLabel, type LabelText } from './item-label'

const text: LabelText = {
  specialLocation: '特殊位置',
  tabCount: (n) => `（${n} 个标签）`
}

describe('itemLabel', () => {
  it('Explorer 单标签：标题为路径，无附加说明', () => {
    const item: DesktopItem = { kind: 'explorer', tabs: ['C:\\work\\案件A'], bounds: null }
    expect(itemLabel(item, text)).toEqual({ title: 'C:\\work\\案件A', badge: '', detail: '' })
  })

  it('Explorer 多标签：第一个标签 + 单独的标签数附注（不随标题省略），详情列出其余标签', () => {
    const item: DesktopItem = {
      kind: 'explorer',
      tabs: ['C:\\a', '\\\\nas\\share\\b', 'D:\\c'],
      bounds: null
    }
    expect(itemLabel(item, text)).toEqual({
      title: 'C:\\a',
      badge: '（3 个标签）',
      detail: '\\\\nas\\share\\b | D:\\c'
    })
  })

  it('Explorer 的 ::{CLSID} 显示为本地化的特殊位置', () => {
    const item: DesktopItem = {
      kind: 'explorer',
      tabs: ['::{20D04FE0-3AEA-1069-A2D8-08002B30309D}', 'D:\\x'],
      bounds: null
    }
    expect(itemLabel(item, text)).toEqual({
      title: '特殊位置',
      badge: '（2 个标签）',
      detail: 'D:\\x'
    })
  })

  it('Office：文件名 + 完整路径', () => {
    const item: DesktopItem = {
      kind: 'office',
      app: 'excel',
      path: '\\\\nas\\share\\一覧.xlsx',
      readOnly: false,
      exe: 'EXCEL.EXE'
    }
    expect(itemLabel(item, text)).toEqual({
      title: '一覧.xlsx',
      badge: '',
      detail: '\\\\nas\\share\\一覧.xlsx'
    })
  })

  it('VS Code：最后一段 + 完整路径（含远程 URI）', () => {
    const local: DesktopItem = {
      kind: 'vscode',
      target: 'C:\\src\\tool',
      exe: 'Code.exe',
      bounds: null
    }
    expect(itemLabel(local, text)).toEqual({ title: 'tool', badge: '', detail: 'C:\\src\\tool' })
    const remote: DesktopItem = {
      kind: 'vscode',
      target: 'vscode-remote://ssh-remote+host/home/u/proj/',
      exe: 'Code.exe',
      bounds: null
    }
    expect(itemLabel(remote, text).title).toBe('proj')
  })

  it('Eclipse：工作区最后一段 + 完整路径；只剩盘符时用盘符', () => {
    const item: DesktopItem = {
      kind: 'eclipse',
      workspace: 'C:\\ws\\main\\',
      exe: 'eclipse.exe',
      bounds: null
    }
    expect(itemLabel(item, text)).toEqual({ title: 'main', badge: '', detail: 'C:\\ws\\main\\' })
    const root: DesktopItem = {
      kind: 'eclipse',
      workspace: 'C:\\',
      exe: 'eclipse.exe',
      bounds: null
    }
    expect(itemLabel(root, text).title).toBe('C:')
  })
})

describe('tabLabel', () => {
  it('路径：最后一段 + 完整路径（UNC 同样）', () => {
    expect(tabLabel('C:/work/案件A', text)).toEqual({ title: '案件A', detail: 'C:/work/案件A' })
    expect(tabLabel('//nas/share/', text)).toEqual({ title: 'share', detail: '//nas/share/' })
  })
  it('::{CLSID}：特殊位置，没有详情', () => {
    expect(tabLabel('::{20D04FE0-3AEA-1069-A2D8-08002B30309D}', text)).toEqual({
      title: '特殊位置',
      detail: ''
    })
  })
})
