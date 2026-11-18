import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // 渲染端数据层使用 @renderer 别名（与 electron-vite / tsconfig 一致）
    alias: { '@renderer': resolve(__dirname, 'apps/desktop/src/renderer/src') }
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/desktop/src/**/*.test.ts'],
    environment: 'node'
  }
})
