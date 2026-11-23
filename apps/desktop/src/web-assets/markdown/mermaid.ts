// ```mermaid 代码块 → 图（设计 5.4）。mermaid 体积大，只在页面含 mermaid 代码块时才动态加载（单独的分块）
const SELECTOR = 'pre > code.language-mermaid'

/** 每次渲染用新的元素 id（主题切换时重新渲染，不与上一次的临时元素冲突） */
let seq = 0

/**
 * 把页面 CSS 变量（markdown.css，可能是 oklch 等 mermaid 的颜色库解析不了的写法）换成 #rrggbb：
 * 画到 1x1 的 canvas 上再读像素（浏览器负责转换色彩空间）
 */
function resolveColors(names: readonly string[]): Record<string, string> {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
  const style = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const name of names) {
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = '#000'
    ctx.fillStyle = style.getPropertyValue(name).trim()
    ctx.fillRect(0, 0, 1, 1)
    const px = ctx.getImageData(0, 0, 1, 1).data
    out[name] = `#${Array.from(px.subarray(0, 3), (v) => v.toString(16).padStart(2, '0')).join('')}`
  }
  return out
}

/**
 * 把 root 中的 mermaid 代码块逐个替换为 SVG：securityLevel 'strict'（图中的 HTML 经 DOMPurify 清理，
 * 不绑定点击回调）。主题用 'base' + themeVariables，取自页面当前的 CSS 变量（随配色主题与明暗变化，base 的其余颜色由
 * primaryColor 等推导）；darkMode 告诉 mermaid 按深色推导。单个图失败 → 原位置显示错误信息与源码，不影响其他图
 */
export async function renderMermaidBlocks(
  root: HTMLElement,
  theme: 'light' | 'dark'
): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(SELECTOR))
  if (blocks.length === 0) return
  const { default: mermaid } = await import('mermaid')
  const c = resolveColors(['--bg', '--bg-subtle', '--fg', '--fg-muted', '--link', '--border'])
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: {
      darkMode: theme === 'dark',
      background: c['--bg'],
      primaryColor: c['--bg-subtle'],
      primaryTextColor: c['--fg'],
      primaryBorderColor: c['--link'],
      lineColor: c['--fg-muted'],
      textColor: c['--fg'],
      noteBkgColor: c['--bg-subtle'],
      noteTextColor: c['--fg'],
      noteBorderColor: c['--border']
    },
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
