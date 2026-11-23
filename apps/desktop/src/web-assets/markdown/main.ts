// Markdown 查看脚本（设计 5.4）：在浏览器视图的外壳页（pch-web://<范围>/<路径>.md?pch-view=markdown）中运行。
// 同源 fetch `?pch-raw=1` 取原始字节 → 编码判断与解码 → unified 管线 → 插入页面 → mermaid 图。
// 不得 import 应用渲染端代码（eslint 元素 web-asset：只能依赖 @pch/text-engine 与外部包）
import './markdown.css'
import { renderMermaidBlocks } from './mermaid'
import { decodeMarkdown, renderMarkdown } from './render'

/** 浅色 / 深色：视图的 prefers-color-scheme 跟随应用的主题（nativeTheme.themeSource，台账 S2），切换时不重新加载；配色主题见 markdown.css */
const darkQuery = matchMedia('(prefers-color-scheme: dark)')
const themeOf = (): 'light' | 'dark' => (darkQuery.matches ? 'dark' : 'light')

/** 页面标题（状态行显示）：第一个 h1，没有时为文件名 */
function titleOf(content: HTMLElement): string {
  const h1 = content.querySelector('h1')?.textContent?.trim()
  if (h1) return h1
  const name = location.pathname.slice(location.pathname.lastIndexOf('/') + 1)
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

/** 地址带片段时（例如 `README.md#見出し`），内容插入后再滚动到该标题 */
function scrollToHash(): void {
  if (location.hash.length <= 1) return
  let id = location.hash.slice(1)
  try {
    id = decodeURIComponent(id)
  } catch {
    // 保持原样
  }
  document.getElementById(id)?.scrollIntoView()
}

async function main(): Promise<void> {
  const content = document.getElementById('content')!
  const res = await fetch(`${location.pathname}?pch-raw=1`)
  if (!res.ok) {
    // 文件在加载外壳之后被删除 / 变大等：只显示状态码（页面内不放界面文案）
    content.textContent = `${res.status} ${res.statusText}`
    return
  }
  const html = renderMarkdown(decodeMarkdown(new Uint8Array(await res.arrayBuffer())))
  content.innerHTML = html
  document.title = titleOf(content)
  scrollToHash()
  if (!content.querySelector('pre > code.language-mermaid')) return
  await renderMermaidBlocks(content, themeOf())

  // 主题切换（明暗：prefers-color-scheme；配色主题：主进程改写 <html data-theme>）：mermaid 的颜色写在 SVG 里，
  // 按新主题重新渲染（保持滚动位置；连续切换时只保留最后一次）
  let latest = 0
  const rerender = (): void => {
    const mine = ++latest
    const y = window.scrollY
    const fresh = document.createElement('article')
    fresh.id = content.id
    fresh.className = content.className
    fresh.innerHTML = html
    void renderMermaidBlocks(fresh, themeOf()).then(() => {
      if (mine !== latest) return
      document.getElementById(content.id)!.replaceWith(fresh)
      window.scrollTo(0, y)
    })
  }
  darkQuery.addEventListener('change', rerender)
  new MutationObserver(rerender).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  })
}

void main()
