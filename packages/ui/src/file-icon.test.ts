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
})
