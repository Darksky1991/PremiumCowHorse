# Electron

### sandbox preload 里 `Buffer` 不可用（解码失败被静默吞掉）

- 日期：2026-11-18
- 症状：`window.pch.bootstrap` 为 `null`，首帧主题闪烁（先浅色再过渡到深色）；没有任何报错。
- 原因：preload 运行在 sandbox 中，不能使用 `Buffer` 等 Node API；解码函数里的 try/catch 把异常吞掉返回了 null。
- 解决：bootstrap 参数改用 `encodeURIComponent(JSON.stringify(...))` 编解码（`packages/shared/src/ipc/bootstrap.ts`）。e2e 中断言 bootstrap 非空。
- 预防：preload 及其依赖（`@pch/shared/preload` 入口）只使用浏览器也有的 API；对「失败时静默回退」的逻辑要有测试覆盖回退不被触发。

### `titleBarOverlay` 的系统按钮遮挡标题栏边框

- 日期：2026-11-18
- 症状：Windows 下标题栏右上角的系统按钮区域盖住了自绘标题栏底部的分隔线。
- 原因：Window Controls Overlay 由系统绘制在网页之上，按钮区域高度覆盖到了边框。
- 解决：去掉 `titleBarOverlay`（只保留 `titleBarStyle: 'hidden'`），由渲染端自绘窗口按钮，经 `window.*` IPC 控制窗口（`modules/window/`、`features/shell/components/window-controls.tsx`）。
- 预防：取舍是失去 Windows 11 悬停最大化按钮时的贴靠布局面板。双击标题栏最大化仍由系统处理（已验证）；验证这类系统行为要用系统级鼠标事件（Playwright 的鼠标事件不经过系统标题栏逻辑），方法见 testing.md。

### `pnpm dev` 启动后什么也没发生（main.log 没有 starting 行）

- 日期：2026-11-18
- 症状：electron-vite 输出 `Port 5173 is in use, trying another one...` 与 `starting electron app...`，但没有窗口，`main.log` 没有新的 `[app] starting` 行。
- 原因（推测，未能复现确认）：已有一个使用同一 userData（`PremiumCowHorse-dev`）的实例在运行；应用的单实例锁让新实例直接退出（并聚焦已有窗口）。当时占用 5173 端口的进程即为该实例的 dev server。
- 解决：关闭已有实例后重试。已在单实例锁失败时向控制台输出 `[app] another instance is already running`。
- 预防：启动前检查 `Get-Process electron` 与 5173 端口；e2e / 截屏脚本使用独立的 `PCH_USER_DATA_DIR`，不受影响。

### 主进程的超时 / 取消不能依赖 provider 响应 AbortSignal

- 日期：2026-11-18
- 症状：（预防性）`fs.promises.readdir` 不接受 signal；网络共享无响应时 readdir 可能一直挂起，超时形同虚设。
- 解决：`VfsService` 让调用与中止信号赛跑（`Promise.race`），中止即以 `FS_CANCELLED` / `FS_TIMEOUT` 结束；同时给操作的 promise 挂一个空 `catch`，避免它在中止后迟到失败时产生 unhandled rejection。
- 预防：所有可能访问网络路径的操作都经过 `VfsService`，不要在模块里直接调用 `fs`。

### tsup / esbuild 打包 Electron 主进程的两个坑（历史，tsup 已移除）

- 日期：2026-11-18
- 症状：①「Electron failed to install correctly」；②`Cannot find module 'sqlite'`。
- 原因：①`noExternal: [/.*/]` 优先于 `external: ['electron']`，把 npm 的 `electron` 启动器包打进了主进程；②tsup 默认去掉 `node:` 前缀，而 `node:sqlite` 只能带前缀引用。
- 解决：现已改用 electron-vite（默认正确处理二者）。
- 预防：自行配置打包器时检查产物中的 `require("electron")` 与 `require("node:...")`。
