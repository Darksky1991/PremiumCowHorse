// Markdown → HTML 与原始字节的解码（纯函数，不碰 DOM；vitest 在 Node 中测试）
import { detectEncoding, sampleRanges } from '@pch/text-engine'
import rehypeSlug from 'rehype-slug'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'

const processor = unified()
  .use(remarkParse)
  // 表格、删除线、任务列表、自动链接、脚注
  .use(remarkGfm)
  // 原始 HTML 作为 raw 节点保留，由 rehype-stringify 原样输出（不需要 rehype-raw：插入页面时由浏览器解析）。
  // 其中的脚本不执行：innerHTML 插入的 <script> 本就不执行，onerror= 等由外壳的 CSP 阻止
  .use(remarkRehype, { allowDangerousHtml: true })
  // 标题 id（GitHub 风格 slug，日文保留），`[見出し](#見出し)` 一类页内链接可用
  .use(rehypeSlug)
  .use(rehypeStringify, { allowDangerousHtml: true })
  .freeze()

/** Markdown 源文本 → HTML 片段 */
export function renderMarkdown(source: string): string {
  return String(processor.processSync(source))
}

/**
 * 原始字节 → 文本：与文本查看器相同的编码判断（@pch/text-engine：BOM → UTF-16 → UTF-8 → 日中英旧编码打分），
 * 取样范围同样按 sampleRanges；解码时跳过 BOM
 */
export function decodeMarkdown(bytes: Uint8Array): string {
  const samples = sampleRanges(bytes.length).map(({ offset, length }) =>
    bytes.subarray(offset, offset + length)
  )
  const { label, bomLength } = detectEncoding(samples)
  return new TextDecoder(label, { ignoreBOM: true }).decode(bytes.subarray(bomLength))
}
