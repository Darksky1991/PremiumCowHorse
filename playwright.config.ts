import { defineConfig } from '@playwright/test'

/** Electron 端到端测试：需要先 pnpm build（测试加载的是 out/ 中的生产构建，经 app:// 协议） */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  outputDir: 'test-results'
})
