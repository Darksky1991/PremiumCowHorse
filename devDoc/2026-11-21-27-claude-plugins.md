# superpowers / frontend-design 改为插件安装

- 日期：2026-11-21
- 里程碑：—（开发环境）
- 相关提交：（提交后补）

## 目标

插件已可安装。需求方删除了项目内复制的 superpowers（15 个 skill + hook）与 frontend-design，改用用户级插件；清理 `.claude/` 下残留的配置与说明。

## 做了什么

- 删除 `.claude/settings.json`：其中只登记了指向 `.claude/hooks/superpowers/session-start` 的 SessionStart hook，脚本删除后每次启动会报错；插件自带该 hook。
- 改写 `.claude/skills/THIRD_PARTY_NOTICES.md`：去掉 superpowers / frontend-design 的条目与「去命名空间」「hook 路径」两条本地修改，新增「改由插件提供的 skill」一节；顺带把仍写着 Next.js 静态导出的适用性备注改为 electron-vite（v1.2 已改）。
- `CLAUDE.md`：`systematic-debugging` 改为插件调用名 `superpowers:systematic-debugging`；环境约束中注明两者以用户级插件安装。

## 关键决策与理由

- `devDoc/` 中提到项目内 superpowers 的旧记录属于历史，不回改。
- `.prettierignore` 中的 `.superpowers` 保留：插件版 brainstorming 的可视化伴侣仍会在项目下写 `.superpowers/`。
- `.claude/settings.local.json`（gitignore，个人权限设置）不动。

## 验证

- `~/.claude/plugins/installed_plugins.json` 中有 `superpowers@claude-plugins-official` 7.0.2 与 `frontend-design@claude-plugins-official` 1.1.1（user scope），插件缓存内含 `hooks/session-start`。
- 当前会话的 skill 列表中 `superpowers:*`、`frontend-design:frontend-design` 可用。
- 全仓库（除 `devDoc/`）搜索 `superpowers` / `frontend-design` / `.claude/hooks`，只剩本次改写后的引用与 `.prettierignore`。
- 未验证：删除 `settings.json` 后新开会话的启动表现（需新会话确认无 hook 报错）。

## 遗留事项

无。
