# 构建、打包、分发

### `AssignProcessToJobObject: (6)` / 打包卡住：公司 TVM 封锁旧版 7-Zip

- 日期：2026-11-18
- 症状：`electron-builder` 打包时进程中止，输出 `AssignProcessToJobObject: (6) ...`；单独运行缓存中的 `7za.exe` 会卡住不返回；屏幕上出现公司的「阻止」弹窗。
- 原因：electron-builder 自带的 7-Zip 为 24.09（缓存于 `%LOCALAPPDATA%\electron-builder\Cache\7zip@1.0.0`），被公司漏洞管理（Defender TVM 的 Warn/Block 机制）判定为漏洞版本并封锁。报错来自 Node（libuv）启动子进程失败时的致命错误，不是项目配置问题。
- 解决：安装 7-Zip 25.01 以上版本（本机用 `winget install 7zip.7zip` 安装了 26.06），设置 electron-builder 官方环境变量：
  `[Environment]::SetEnvironmentVariable('ELECTRON_BUILDER_7ZIP_PATH', 'C:\Program Files\7-Zip\7z.exe', 'User')`。
  新开的终端才会读到用户级环境变量；当前终端需 `$env:ELECTRON_BUILDER_7ZIP_PATH = ...`。
- 预防：不要尝试绕过封锁。引入任何会下载可执行程序的构建工具前，先确认其版本是否有已知漏洞。

### electron-builder 默认 NSIS 是 3.0.4.1（含 CVE-2023-37378）

- 日期：2026-11-18
- 症状：无（预防性）。
- 原因：`electron-builder.yml` 的 `toolsets.nsis` 默认 `"0.0.0"`，即旧版 NSIS 3.0.4.1。
- 解决：若使用 `nsis` 或 `portable` 目标（二者内部都用 NSIS），设置 `toolsets: { nsis: '1.2.1' }`（NSIS 3.12）。可选值见 `app-builder-lib/out/toolsets/windows.js` 的 `nsisChecksums`。
- 预防：当前分发形式为 zip，不使用 NSIS；恢复安装程序时记得加上此配置。

### portable 单文件 exe 每次启动 24–31 秒

- 日期：2026-11-18
- 症状：electron-builder `portable` 目标生成的单文件 exe，每次启动都要等半分钟；强制结束后 `%TEMP%` 下残留解压目录。
- 原因：portable 每次启动都把约 300MB 的程序解压到 `%TEMP%`，公司杀毒软件对新解压的文件逐一扫描。
- 解决：改用 `zip` 目标（文件夹版，解压一次后启动约 1.4 秒）。
- 预防：分发形式变更时实测启动时间（以 `main.log` 出现的时间为准）。

### 安装包 / 产物文件名里出现 `@pch\` 目录

- 日期：2026-11-18
- 症状：产物路径变成 `release\0.1.0\@pch\desktop-0.1.0-setup.exe`。
- 原因：`artifactName` 用了 `${name}`，而包名是带 scope 的 `@pch/desktop`。
- 解决：用 `${productName}`。
- 预防：artifactName 中不要用 `${name}`。

### pnpm 12 拒绝执行依赖的安装脚本（Ignored build scripts）

- 日期：2026-11-18
- 症状：`pnpm add` 失败：`Ignored build scripts: electron-winstaller@... Run "pnpm approve-builds"`。
- 原因：pnpm 11 起默认不执行未批准依赖的 install 脚本；`.npmrc` 中的旧设置（如 `node-linker`）也不再生效。
- 解决：在 `pnpm-workspace.yaml` 的 `allowBuilds:` 中显式声明（electron、esbuild 为 true；不需要的设为 false）。
- 预防：新增带 postinstall 的依赖时同步更新 `allowBuilds`。

### electron-vite 构建产物未压缩（渲染端约 1.7MB）

- 日期：2026-11-18
- 症状：`out/renderer/assets/*.js` 体积大、未压缩。
- 原因：electron-vite 对 main / preload / renderer 默认 `minify: false`（本地加载、便于排查）。
- 解决：保持官方默认，不处理。
- 预防：不要据此判断 tree-shaking 失效；先 `grep` 产物确认实际打入的模块。

### 更换数据库访问层后开发环境启动失败：`table "settings" already exists`

- 日期：2026-11-18
- 症状：`pnpm dev` 启动时迁移失败。
- 原因：开发数据目录 `%APPDATA%\PremiumCowHorse-dev` 中残留旧迁移框架（Drizzle）建的表，新迁移框架（Kysely）不认识旧的迁移记录。
- 解决：删除开发库 `%APPDATA%\PremiumCowHorse-dev\data\pch.db*`（应用未发布、无真实数据时）。
- 预防：发布后不得更换迁移框架而不提供衔接迁移；开发期更换时清理开发数据目录。

### 打包后的原生模块（koffi）：确认两个进程都能加载，回退不能是静默的

- 日期：2026-11-19
- 症状：`pnpm dist` 时 electron-builder 输出 `platform-specific optional dependencies not bundled … @koromix/koffi-linux-x64 …` 与 `missing optional dependencies … koffi-openbsd-*`，看起来像 koffi 没打进去。另外主进程的 `vfs/location.ts` 加载 koffi 失败时原本静默回退（映射的网络盘按本地处理），打包后无法从日志确认主进程中 koffi 是否可用。
- 原因：警告列出的是其他平台的二进制包，本机平台的 `@koromix/koffi-win32-x64` 已打入，且 electron-builder 自动把 `.node` 放到 `resources/app.asar.unpacked/node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node`（`asarUnpack` 只配置了 `resources/**`，不需要为 koffi 另加）。
- 解决：主进程启动时按 `driveTypeStatus()` 记一条日志（`[vfs] drive type detection: native (koffi)`，失败时为警告并附原因）；扫描进程在就绪时记 `[scanner] index …, native enumeration: true`（失败时 `[enumerator] native enumeration unavailable …`）。打包实测：解压 zip 后以 `--user-data-dir=<临时目录>` 运行，main.log 中两条都为 native，资源树显示 `.dotfile`（按属性判断隐藏，回退模式会把它当作隐藏）。
- 预防：任何原生模块的回退路径都要在日志中留下记录；打包后在 main.log 里确认每个加载它的进程都成功。
