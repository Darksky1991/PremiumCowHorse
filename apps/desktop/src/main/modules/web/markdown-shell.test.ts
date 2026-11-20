import { describe, expect, it } from 'vitest'
import { MARKDOWN_CSP, markdownShell } from './markdown-shell'

describe('markdownShell', () => {
  it('外壳页：charset、样式、内容容器与查看脚本', () => {
    const html = markdownShell()
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('<link rel="stylesheet" href="pch-asset://viewer/markdown.css">')
    expect(html).toContain('<article id="content"')
    expect(html).toContain('<script type="module" src="pch-asset://viewer/markdown.js"></script>')
  })

  it('开发模式：脚本地址可替换，没有样式表时不输出 link（样式由脚本经 dev server 注入）', () => {
    const html = markdownShell({ script: 'pch-asset://viewer/@fs/C:/x/main.ts' })
    expect(html).toContain('<script type="module" src="pch-asset://viewer/@fs/C:/x/main.ts">')
    expect(html).not.toContain('<link rel="stylesheet"')
  })
})

describe('MARKDOWN_CSP', () => {
  it('只允许应用自带的查看脚本', () => {
    expect(MARKDOWN_CSP).toContain('script-src pch-asset:')
    expect(MARKDOWN_CSP).not.toMatch(/script-src[^;]*'unsafe-inline'/)
    expect(MARKDOWN_CSP).toContain("object-src 'none'")
  })
})
