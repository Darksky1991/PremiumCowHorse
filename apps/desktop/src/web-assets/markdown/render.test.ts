/// <reference types="node" />
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeMarkdown, renderMarkdown } from './render'

/** text-engine 的编码样本（packages/text-engine/fixtures） */
const FIXTURES = path.resolve(__dirname, '../../../../../packages/text-engine/fixtures')
const sample = (name: string): { bytes: Uint8Array; text: string } => ({
  bytes: new Uint8Array(readFileSync(path.join(FIXTURES, 'samples', name))),
  text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(
    readFileSync(path.join(FIXTURES, 'expected', name))
  )
})

describe('renderMarkdown', () => {
  it('GFM 表格 → <table>', () => {
    const html = renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |\n')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>a</th>')
    expect(html).toContain('<td>2</td>')
  })

  it('任务列表 → checkbox', () => {
    const html = renderMarkdown('- [x] a\n- [ ] b\n')
    expect(html).toMatch(/<input type="checkbox" checked disabled>\s*a/)
    expect(html).toMatch(/<input type="checkbox" disabled>\s*b/)
  })

  it('脚注 → 脚注区与回跳链接（页内锚点）', () => {
    const html = renderMarkdown('本文[^1]\n\n[^1]: 注釈\n')
    expect(html).toContain('<sup><a href="#user-content-fn-1" id="user-content-fnref-1"')
    expect(html).toContain('<section data-footnotes class="footnotes">')
    expect(html).toContain('<li id="user-content-fn-1">')
    expect(html).toMatch(/<a href="#user-content-fnref-1" data-footnote-backref/)
  })

  it('日文标题有 id，可被 #見出し 一类的页内链接引用', () => {
    const html = renderMarkdown('## 見出し\n\n[戻る](#見出し)\n')
    expect(html).toContain('<h2 id="見出し">見出し</h2>')
    expect(html).toContain('<a href="#%E8%A6%8B%E5%87%BA%E3%81%97">戻る</a>')
  })

  it('原始 HTML 原样保留', () => {
    const html = renderMarkdown('<div class="x">raw</div>\n\ntext <span class="y">inline</span>\n')
    expect(html).toContain('<div class="x">raw</div>')
    expect(html).toContain('<span class="y">inline</span>')
  })

  it('<script> 作为原始 HTML 透传（不转义为文本；不执行由外壳的 CSP 保证）', () => {
    const html = renderMarkdown("<script>document.title='x'</script>\n")
    expect(html).toContain("<script>document.title='x'</script>")
    expect(html).not.toContain('&#x3C;script')
  })

  it('mermaid 代码块保留为 pre > code.language-mermaid（由 renderMermaidBlocks 处理）', () => {
    const html = renderMarkdown('```mermaid\ngraph TD\n  A-->B\n```\n')
    expect(html).toContain('<pre><code class="language-mermaid">graph TD\n  A-->B\n</code></pre>')
  })
})

describe('decodeMarkdown', () => {
  it('UTF-8：跳过 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('# 見出し\n')])
    expect(decodeMarkdown(bytes)).toBe('# 見出し\n')
  })

  it('Shift_JIS 样本解码正确', () => {
    const { bytes, text } = sample('ja-sjis-paragraph.txt')
    expect(decodeMarkdown(bytes)).toBe(text)
  })

  it('空文件 → 空字符串', () => {
    expect(decodeMarkdown(new Uint8Array(0))).toBe('')
  })
})
