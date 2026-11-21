// Markdown 查看脚本的单独 vite 构建（台账 S9 方案 B）：与应用渲染端完全分开，产物只含查看脚本、样式与分块，
// pch-asset 协议以 out/web-assets/markdown 为根提供（白名单扩展名）。在 electron-vite build 之后执行
// （electron-vite 只清空它自己的输出目录）。开发模式不需要预先构建：pch-asset 代理到 renderer dev server
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const root = resolve(__dirname, 'src/web-assets/markdown')

export default defineConfig({
  root,
  base: './',
  // 不复制 public 目录、不读 .env：查看脚本没有这些输入
  publicDir: false,
  envDir: false,
  build: {
    outDir: resolve(__dirname, 'out/web-assets/markdown'),
    emptyOutDir: true,
    // 与 electron-vite 6 的 renderer 默认 target 相同（它的表最高到 Electron 44 → chrome152，更高版本沿用）
    target: 'chrome152',
    // 外壳以 <link> 引用 markdown.css：查看脚本 import 的 CSS 抽为单独文件（不在 JS 中注入）
    cssCodeSplit: true,
    modulePreload: { polyfill: false },
    reportCompressedSize: false,
    // mermaid 分块本就很大（只在页面含 mermaid 代码块时加载），不需要大小警告
    chunkSizeWarningLimit: 4096,
    rolldownOptions: {
      input: { markdown: resolve(root, 'main.ts') },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (asset) =>
          asset.names.some((n) => n.endsWith('.css'))
            ? '[name][extname]'
            : 'assets/[name]-[hash][extname]'
      }
    }
  }
})
