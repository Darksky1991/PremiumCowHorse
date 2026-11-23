import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FileIcon } from './file-icon'

/** 渲染后 svg 的 class 列表 */
function classes(props: Parameters<typeof FileIcon>[0]): string[] {
  const html = renderToStaticMarkup(createElement(FileIcon, props))
  return (/class="([^"]*)"/.exec(html)?.[1] ?? '').split(/\s+/)
}

describe('FileIcon 的颜色', () => {
  it('失效链接用 text-destructive，并取代调用方传入的文字颜色（不取决于 CSS 顺序）', () => {
    const list = classes({
      name: 'dead.lnk',
      kind: 'symlink',
      target: null,
      className: 'size-4 shrink-0 text-muted-foreground'
    })
    expect(list).toContain('text-destructive')
    expect(list).not.toContain('text-muted-foreground')
    expect(list).toContain('size-4')
  })

  it('其余图标原样使用调用方的 className', () => {
    const list = classes({ name: 'a.txt', kind: 'file', className: 'size-4 text-muted-foreground' })
    expect(list).toContain('text-muted-foreground')
    expect(list).not.toContain('text-destructive')
  })

  it('按类别着色（text-fi-*）', () => {
    expect(classes({ name: 'a.docx', kind: 'file' })).toContain('text-fi-word')
    expect(classes({ name: 'a.xlsx', kind: 'file' })).toContain('text-fi-excel')
    expect(classes({ name: 'a.pdf', kind: 'file' })).toContain('text-fi-pdf')
    expect(classes({ name: 'a.txt', kind: 'file' })).toContain('text-fi-neutral')
  })

  it('monochrome 时不带类别颜色，随调用方的前景色', () => {
    const list = classes({ name: 'a.docx', kind: 'file', monochrome: true, className: 'size-4' })
    expect(list.some((c) => c.startsWith('text-fi-'))).toBe(false)
    expect(list).toContain('size-4')
  })

  it('文件夹带填充，monochrome 时不带', () => {
    const list = classes({ name: 'x', kind: 'directory' })
    expect(list).toContain('text-fi-folder')
    expect(list).toContain('fill-fi-folder-fill')
    const mono = classes({ name: 'x', kind: 'directory', monochrome: true })
    expect(mono.some((c) => c.includes('fi-'))).toBe(false)
  })

  it('失效链接 monochrome 时仍为 text-destructive', () => {
    const list = classes({ name: 'x', kind: 'symlink', target: null, monochrome: true })
    expect(list).toContain('text-destructive')
  })
})
