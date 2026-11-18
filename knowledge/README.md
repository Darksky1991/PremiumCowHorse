# knowledge：开发中的 tips、错误与知识

目的：同样的问题只踩一次。开始相关工作前先在这里搜索关键字（报错原文、包名、工具名）。

## 文件

| 文件                                               | 范围                                                   |
| -------------------------------------------------- | ------------------------------------------------------ |
| [build-and-packaging.md](./build-and-packaging.md) | 构建、打包、分发、公司终端策略                         |
| [electron.md](./electron.md)                       | Electron 主进程 / preload / 窗口                       |
| [libraries.md](./libraries.md)                     | 第三方库的 API 陷阱（zod、Kysely、shadcn、Base UI 等） |
| [testing.md](./testing.md)                         | 单元测试、e2e、视觉确认                                |
| [windows-and-tooling.md](./windows-and-tooling.md) | Windows 环境、命令行工具、AI 工具环境                  |

## 记录格式

每条一个三级标题，标题写「现象或关键字」，便于搜索：

```markdown
### <现象 / 报错原文 / 关键字>

- 日期：YYYY-MM-DD
- 症状：看到了什么（报错原文尽量原样保留）
- 原因：根本原因（已核实的才写；推测要标明）
- 解决：怎么解决的（命令、配置、代码位置）
- 预防：以后怎样避免（检查项、约定）
```

只记录「非显而易见」的内容：文档里查得到、一眼能看出的不记。结论被推翻时直接修改原条目，不要追加矛盾的新条目。
