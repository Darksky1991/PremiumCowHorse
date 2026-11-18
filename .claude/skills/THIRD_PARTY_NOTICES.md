# 项目级 Skills 来源说明

本目录下的 skill 均通过「源文件复制」方式安装（企业策略禁用了 marketplace / plugin 安装），
放置位置遵循 Claude Code 项目级 skill 规范：`.claude/skills/<skill-name>/SKILL.md`。
安装日期：2026-11-18。更新时请从下表的上游仓库重新复制，并重新应用「本地修改」一节中的改动。

| Skill | 上游仓库 / 路径 | 上游提交 | 许可证 |
|---|---|---|---|
| shadcn | github.com/shadcn-ui/ui · `skills/shadcn` | 968d8cb (2026-11-17) | MIT (Copyright (c) 2023 shadcn) |
| vercel-react-best-practices | github.com/vercel-labs/agent-skills · `skills/react-best-practices` | 1a2c79d (2026-10-27) | MIT（见 SKILL.md frontmatter） |
| vercel-composition-patterns | github.com/vercel-labs/agent-skills · `skills/composition-patterns` | 1a2c79d (2026-10-27) | MIT（见 SKILL.md frontmatter） |
| web-design-guidelines | github.com/vercel-labs/agent-skills · `skills/web-design-guidelines` | 1a2c79d (2026-10-27) | 上游仓库未声明 |
| frontend-design | github.com/anthropics/skills · `skills/frontend-design` | e4bb5d9 (2026-11-16) | Apache-2.0（见目录内 LICENSE.txt） |
| webapp-testing | github.com/anthropics/skills · `skills/webapp-testing` | e4bb5d9 (2026-11-16) | Apache-2.0（见目录内 LICENSE.txt） |
| superpowers 全部 15 个 skill ¹ | github.com/obra/superpowers · `skills/*`（v7.0.2） | 22f0b46 (2026-11-03) | MIT（见 `.claude/hooks/superpowers/LICENSE`） |

¹ brainstorming, diagnosing-superpowers, dispatching-parallel-agents, executing-plans,
finishing-a-development-branch, receiving-code-review, requesting-code-review,
subagent-driven-development, systematic-debugging, test-driven-development,
using-git-worktrees, using-superpowers, verification-before-completion,
writing-plans, writing-skills

## 本地修改（相对上游）

1. **目录改名**：`react-best-practices` → `vercel-react-best-practices`，
   `composition-patterns` → `vercel-composition-patterns`，与各自 SKILL.md 中的 `name` 一致。
2. **superpowers 引用去命名空间**：上游以插件形式安装，skill 间引用写作 `superpowers:<name>`；
   项目级安装没有插件命名空间，已在 skill 文件和 hook 脚本中把
   `superpowers:<已安装的 skill 名>` 统一替换为 `<skill 名>`（共 50 处）。
3. **SessionStart hook**：上游 `hooks/session-start`、`hooks/run-hook.cmd` 复制到
   `.claude/hooks/superpowers/`。`session-start` 中的 `PLUGIN_ROOT` 由 `"${SCRIPT_DIR}/.."`
   改为 `"${SCRIPT_DIR}/../.."`，指向 `.claude/`，以便读取 `.claude/skills/using-superpowers/SKILL.md`。
   需要在 `.claude/settings.json` 中注册该 hook 才会生效。

## 适用性备注

- `vercel-react-best-practices` 含 SSR / Server Components / Server Actions 相关规则，
  本项目使用 `output: 'export'` 静态导出（架构文档 2.1 节），这类规则不适用。
- `webapp-testing` 使用 Python 版 Playwright 驱动浏览器；本项目 E2E 测试为
  `@playwright/test` 的 Electron 模式，只适用于用浏览器单独调试 Next 渲染端的场景。
- `web-design-guidelines` 运行时会联网拉取最新规则。
