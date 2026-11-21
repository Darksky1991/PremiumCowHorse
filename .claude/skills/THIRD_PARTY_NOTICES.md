# 项目级 Skills 来源说明

本目录下的 skill 均通过「源文件复制」方式安装，
放置位置遵循 Claude Code 项目级 skill 规范：`.claude/skills/<skill-name>/SKILL.md`。
安装日期：2026-11-18。更新时请从下表的上游仓库重新复制，并重新应用「本地修改」一节中的改动。

| Skill | 上游仓库 / 路径 | 上游提交 | 许可证 |
|---|---|---|---|
| shadcn | github.com/shadcn-ui/ui · `skills/shadcn` | 968d8cb (2026-11-17) | MIT (Copyright (c) 2023 shadcn) |
| vercel-react-best-practices | github.com/vercel-labs/agent-skills · `skills/react-best-practices` | 1a2c79d (2026-10-27) | MIT（见 SKILL.md frontmatter） |
| vercel-composition-patterns | github.com/vercel-labs/agent-skills · `skills/composition-patterns` | 1a2c79d (2026-10-27) | MIT（见 SKILL.md frontmatter） |
| web-design-guidelines | github.com/vercel-labs/agent-skills · `skills/web-design-guidelines` | 1a2c79d (2026-10-27) | 上游仓库未声明 |
| webapp-testing | github.com/anthropics/skills · `skills/webapp-testing` | e4bb5d9 (2026-11-16) | Apache-2.0（见目录内 LICENSE.txt） |

## 改由插件提供的 skill

2026-11-21 起插件可以安装，以下 skill 改为用户级插件（`claude-plugins-official` 市场），项目内的复制版与
SessionStart hook 已删除：

| 插件 | 原项目内副本 | 调用名 |
|---|---|---|
| superpowers（7.0.2） | 15 个 skill + `.claude/hooks/superpowers/` | `superpowers:<skill 名>`，如 `superpowers:systematic-debugging` |
| frontend-design（1.1.1） | `.claude/skills/frontend-design` | `frontend-design:frontend-design` |

superpowers 的 SessionStart hook 由插件自身注册，项目 `.claude/settings.json` 不再需要登记。

## 本地修改（相对上游）

1. **目录改名**：`react-best-practices` → `vercel-react-best-practices`，
   `composition-patterns` → `vercel-composition-patterns`，与各自 SKILL.md 中的 `name` 一致。

## 适用性备注

- `vercel-react-best-practices` 含 SSR / Server Components / Server Actions 相关规则，
  本项目渲染端为 electron-vite（Vite + React）单页应用（架构文档 2.1 节），这类规则不适用。
- `webapp-testing` 使用 Python 版 Playwright 驱动浏览器；本项目 E2E 测试为
  `@playwright/test` 的 Electron 模式，只适用于用浏览器单独调试渲染端的场景。
- `web-design-guidelines` 运行时会联网拉取最新规则。
