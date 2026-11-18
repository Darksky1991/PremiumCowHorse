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

### （AI 工具环境）Bash heredoc 写文件时反斜杠丢失

- 日期：2026-11-18
- 症状：用 `cat > file <<EOF` 写含 Windows 路径的测试代码，源码中的 `'C:\\x'`（转义后的一个反斜杠）变成了 `'C:\x'`，测试期望值被悄悄改变（M1-2 Task 4）。
- 原因：定界符不加引号时，heredoc 内容会做参数展开与反斜杠处理（`\\` → `\`、`\$` → `$`）。
- 解决：含反斜杠、`$`、反引号的文件用 Write / Edit 工具写；必须用 heredoc 时给定界符加引号（`<<'EOF'`）。内容里本身含有 `'EOF'` 这类引号串时，加引号的 heredoc 也会在 Bash 工具中解析失败（见上一条），直接写成脚本文件再执行。
- 预防：写完后 `grep` 一次关键的转义序列。

### Python 文本模式在 Windows 上写出 CRLF，prettier 报满屏 `Delete ␍`

- 日期：2026-11-18
- 症状：用 Python 脚本批量修改文件后，`prettier --check` 报大量 `Delete ␍`。
- 原因：Windows 下 `open(..., 'w')` 默认把 `\n` 写成 `\r\n`；仓库按 LF 管理。
- 解决：`io.open(path, 'w', encoding='utf8', newline='\n')`，或用 Write / Edit 工具。
- 预防：批量修改脚本统一指定 `newline='\n'`。
