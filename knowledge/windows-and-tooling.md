# Windows 环境与工具

### Git Bash 中 `rm -f` 静默删除失败

- 日期：2026-11-18
- 症状：`rm -f` 没有报错，但文件仍在。
- 原因：文件被其他进程占用（例如另一个进程打开着 SQLite 数据库），`-f` 抑制了错误输出。
- 解决：确认没有进程占用后，用 PowerShell `Remove-Item` 删除并再次 `Get-ChildItem` 确认。
- 预防：删除后总是确认结果。

### 停止 `pnpm dev` 后残留 electron 进程

- 日期：2026-11-18
- 症状：强制停止开发服务器后，`Get-Process electron` 仍有 `--type=utility --utility-sub-type=network.mojom.NetworkService` 进程。
- 原因：父进程被强制结束，子进程成为孤儿进程。
- 解决：用 `Get-CimInstance Win32_Process -Filter "Name='electron.exe'"` 查看命令行，确认属于本项目后结束。
- 预防：自动化脚本结束后检查残留进程。

### Python 输出中文报 `UnicodeEncodeError: 'cp932'`

- 日期：2026-11-18
- 症状：在终端中 `print` 中文字符报错。
- 原因：系统代码页为日文（cp932）。
- 解决：`PYTHONIOENCODING=utf-8 python ...`；读写文件时显式 `encoding='utf8'`。
- 预防：—

### （AI 工具环境）长 heredoc 在 Bash 工具中解析失败

- 日期：2026-11-18
- 症状：`unexpected EOF while looking for matching '"'`，命令未执行或只执行了一部分。
- 解决：用 Write 工具把脚本写到临时目录再执行；或拆成多个短命令。
- 预防：多文件、多行的批量修改不要放在一个 heredoc 里。

### 用户级环境变量在当前终端不生效

- 日期：2026-11-18
- 症状：`[Environment]::SetEnvironmentVariable(..., 'User')` 后，当前终端里读不到。
- 原因：用户级环境变量只对之后新启动的进程生效。
- 解决：当前终端另行 `$env:NAME = ...`，或重开终端。
- 预防：—
