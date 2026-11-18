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
    plugins: [react(), tailwindcss()]
  }
})
