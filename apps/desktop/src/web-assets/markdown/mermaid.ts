// ```mermaid 代码块 → 图（设计 5.4）。mermaid 体积大，只在页面含 mermaid 代码块时才动态加载（单独的分块）
const SELECTOR = 'pre > code.language-mermaid'

/** 每次渲染用新的元素 id（主题切换时重新渲染，不与上一次的临时元素冲突） */
let seq = 0

/**
 * 把 root 中的 mermaid 代码块逐个替换为 SVG：securityLevel 'strict'（图中的 HTML 经 DOMPurify 清理，
 * 不绑定点击回调），主题按浅色 / 深色。单个图失败 → 原位置显示错误信息与源码，不影响其他图
 */
export async function renderMermaidBlocks(
  root: HTMLElement,
  theme: 'light' | 'dark'
): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(SELECTOR))
  if (blocks.length === 0) return
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: theme === 'dark' ? 'dark' : 'default',
    // 失败时不在 body 中画错误图，抛出错误并清理临时元素（错误由下面在原位置显示）
    suppressErrorRendering: true
  })
  for (const code of blocks) {
    const pre = code.parentElement!
    const source = code.textContent ?? ''
    const figure = document.createElement('div')
    try {
      const { svg, bindFunctions } = await mermaid.render(`pch-mermaid-${++seq}`, source)
      figure.className = 'mermaid-diagram'
      figure.innerHTML = svg
      bindFunctions?.(figure)
    } catch (e) {
      figure.className = 'mermaid-error'
      const message = document.createElement('p')
      message.className = 'mermaid-error-message'
      message.textContent = e instanceof Error ? e.message : String(e)
      const sourceBlock = document.createElement('pre')
      sourceBlock.textContent = source
      figure.append(message, sourceBlock)
    }
    pre.replaceWith(figure)
  }
}
