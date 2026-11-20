import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  // 主进程：dependencies 默认外置（由 electron-builder 打入安装包），workspace 包（devDependencies）被打包
  main: {},
  // preload 运行在 sandbox 中，只能 require('electron')：必须把依赖全部打包进来
  preload: {
    build: { externalizeDeps: false }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()],
    // 开发模式下 Markdown 查看脚本（src/web-assets/markdown，生产为单独的 vite 构建：vite.markdown.config.ts）
    // 由本 dev server 经 /@fs 提供（pch-asset 代理，台账 S9）。把它列为依赖扫描的入口：否则首次打开 Markdown 时
    // 才发现 unified / mermaid 等新依赖，dev server 重新预构建并重新加载整个应用窗口（实测）
    optimizeDeps: {
      entries: ['index.html', '../web-assets/markdown/main.ts']
    }
  }
})
