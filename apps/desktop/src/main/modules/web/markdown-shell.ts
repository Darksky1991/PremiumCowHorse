// Markdown 的外壳页（设计 5.4）：pch-web 协议处理器对 `?pch-view=markdown` 返回它。
// 文档的 URL 仍是 .md 文件本身的位置（相对路径的图片与链接按它解析）；内容由应用自带的查看脚本
// （src/web-assets/markdown，经 pch-asset:// 提供）取 `?pch-raw=1` 后在页面中渲染。

/** 查看脚本与样式（生产：out/web-assets/markdown 中的产物，经 pch-asset 协议） */
export const MARKDOWN_ASSET_BASE = 'pch-asset://viewer/'

/** `?pch-raw=1` 返回的原始字节上限：与 Markdown 插件的 maxSize 相同（超过时插件不参与匹配） */
export const MARKDOWN_MAX_BYTES = 5 * 1024 * 1024

/**
 * 外壳的 CSP 响应头（设计 5.4 的值）：只执行应用自带的查看脚本（pch-asset:），Markdown 中的 `<script>`、
 * `onerror=` 等内联脚本一律不执行。style-src 的 'unsafe-inline' 是 mermaid 所需（生成的 SVG 内含 `<style>`，
 * 节点带 style 属性）；connect-src 落到 default-src 的 'self'（查看脚本 fetch `?pch-raw=1`）。
 * mermaid 12 渲染不需要 eval（未加 'unsafe-eval'，e2e 中图正常生成）
 */
export const MARKDOWN_CSP = [
  "default-src 'self' https: data:",
  'script-src pch-asset:',
  "style-src 'self' 'unsafe-inline' https: pch-asset:",
  "img-src 'self' https: data: blob:",
  "object-src 'none'"
].join('; ')

const escapeAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/**
 * 外壳 HTML。assets 省略时为生产的产物地址；开发模式只传 script（`pch-asset://viewer/@fs/<main.ts 的绝对路径>`，
 * 协议处理器代理到 renderer dev server），样式由脚本中的 CSS import 经 dev server 注入，不输出 link。
 * color-scheme 让脚本与样式加载前的底色也跟随浅色 / 深色
 */
export function markdownShell(
  assets: { script: string; style?: string } = {
    script: `${MARKDOWN_ASSET_BASE}markdown.js`,
    style: `${MARKDOWN_ASSET_BASE}markdown.css`
  }
): string {
  const style =
    assets.style === undefined ? '' : `<link rel="stylesheet" href="${escapeAttr(assets.style)}">\n`
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light dark">
${style}</head>
<body>
<article id="content" class="markdown-body"></article>
<script type="module" src="${escapeAttr(assets.script)}"></script>
</body>
</html>
`
}
