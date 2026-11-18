# 资源树：断开、缓存状态与右键菜单（Task 8）

- 日期：2026-11-19
- 计划：[03 刷新与缓存引擎 + 文件名搜索：实施计划](./2026-11-19-03-refresh-cache-plan.md) 的 Task 8；设计见 [01 目录刷新与缓存引擎：设计](./2026-11-19-01-refresh-cache-design.md) 4.7、4.9、4.10 第 2 条
- 分支：`feat/m1-workspace`

## 做了什么

- 断开：`lib/file-uri.ts` 新增 `shareKeyOfUri`（与主进程 shareKey 同规则）、`isShareOffline`（不区分大小写）、`normalizeFileUri`、`isUncUri`；`tree-model.ts` 的 `buildVisibleNodes` 接收 `offlineShares`，给断开共享上的根条目打 `offline`、其下真实子项打 `dimmed`，显示缓存内容的目录带 `checkedAt`；`tree-row.tsx` 行尾显示 `Unplug` 图标（`aria-label`「已断开」）、浅色文字、`title` 追加「最后更新」。
- 右键菜单：删除「用系统应用打开」（`system.openPath` 的契约、handler、渲染端调用一并删除）；folder 条目增加「刷新级别」子菜单（跟随全局（当前值）/ 全部 / 积极 / 默认 / 消极，单选）与「建立索引」（勾选）；真实子目录增加「建立索引」。
- 数据：`data/entries.ts` 新增 `useIndexTargets`、`setRefreshLevel`、`setIndexTarget`；`query-keys.ts` 新增 `indexTargets`，`workspace.changed` 时与条目一并失效（`query-client.ts`）。
- 文案：ja / zh-CN / en 三语（`explorer` 命名空间；删除 `openWithApp`）。
- doc 8.2 节修正（Task 6 审查遗留）：「重试」改为 `vfs.refresh([uri])` + 查询失效、隐藏文件按 `hidden` 字段、删除「随扫描进程接入后生效」的旧说法；菜单表同步。

## 决定与限制

- 「跟随全局」显示的全局值按渲染端能识别的位置类型：UNC 为网络，盘符为本地；映射网络盘按本地显示（扫描进程按真实位置生效）。
- 「建立索引」不提供给指向目录的链接（`link-directory`）。
- e2e 经主进程 `webContents.send('pch:event', …)` 注入 `vfs.reachability`；「缓存内容的最后更新时间」没有 e2e（见 `knowledge/testing.md`），只有单元测试。
- 系统级截图在本次会话失败（`CopyFromScreen` 句柄无效，见 `knowledge/testing.md`），截图改用 `page.screenshot`。
