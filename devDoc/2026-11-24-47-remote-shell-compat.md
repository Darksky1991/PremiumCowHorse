# 登录 shell 为 csh 时身份切换失败：调查与修复

日期：2026-11-24　｜　相关：`doc/` 7.6 节（v1.29）、`knowledge/libraries.md`「OpenSSH exec：命令由登录用户的 shell 解释」

## 1. 现象

公司环境的远程服务器上，切换用户总是失败，界面显示「切换用户失败（超时或通道被关闭）」（`CONN_SUDO_FAILED`）。

## 2. 调查

- `CONN_SUDO_FAILED` 是 10 余种失败共用的错误码。具体原因写在 `detail` 中（reason、stage、脱敏后的服务器输出），但界面（`errorText` 只按错误码翻译）与日志（`identity open failed (<code>)`）都不显示 detail，无法从应用侧定位（见第 5 节）。
- 需求方在服务器上手动确认：
  - `sudo -V`：`Sudo version 1.8.19p2`；登录用户 `$SHELL` 为 `/bin/csh`，目标用户 `mebiap` 的 shell 也是 `/bin/csh`。
  - 在 bash 中执行 `LC_ALL=C sudo -k -S -p 'PCHSUDOPROMPT' true`，提示就是 `PCHSUDOPROMPT`，所以不是 PAM 替换提示的问题。
  - `ssh 用户@主机 'for p in a b; do echo $p; done; echo PS:ok'` → `for: Command not found`，证实了原因。
  - 家目录下没有 `1` / `2` 之类的残留文件；`echo 'echo ok' | sudo su - mebiap` 输出 `ok`，目标用户的登录脚本不吞输入。
- 原因：sshd 以登录用户的 shell 执行 exec 请求（`csh -c '<命令>'`），而探测、sudo、轮询命令都是 sh 语法。探测第一步就失败，报 `CONN_SUDO_FAILED: probe incomplete`。
- WSL 复现：新增 `scripts/wsl-sftp/setup-csh.sh`（Debian 装 BSD csh，AlmaLinux 9 装 tcsh；登录用户 `pchcsh`、目标用户 `app3`，shell 均为 `/bin/csh`，sudoers 为精确规则）。修复前两者均为 `CONN_SUDO_FAILED: probe incomplete`。

## 3. 修复

需求方要求兼容各种 shell，不做只针对 csh 的实现。因此不按 shell 分支，所有 shell 都执行同一条命令行：

- `ssh-session.ts` 新增 `viaPosixShell`：`exec()` 发出的命令一律包成 `unset savehist; exec /bin/sh -c '<命令>'`。单引号按 `'\''` 转义；命令含换行或 `!` 时直接拒绝，因为 csh 的单引号内不能有换行，`!` 可能触发历史替换。
- `sudo-switch.ts` 的 `startCommand`（写给目标用户登录 shell 的启动命令）前加 `unset savehist;`。
- 这一行在 sh / bash / ksh / zsh / csh / tcsh 中都是合法语句。`unset savehist` 只在 tcsh 中有作用，其他 shell 里只是删除一个不存在的变量。

`exec` 与 `unset savehist` 的取舍来自 AlmaLinux 9（tcsh，`/etc/csh.cshrc` 中有 `set savehist = (1024 merge)`）的实测。下表记录每种做法会不会写出 `~/.history`：

| 做法                                                  | 写 `~/.history` |
| ----------------------------------------------------- | --------------- |
| `csh -c '外部命令'`（正常结束）                       | 否              |
| `csh -c 'exec …'`                                     | 是              |
| 终端方式下由本端提前关闭通道（csh 父进程收到 SIGHUP） | 是              |
| 目标用户登录 shell（`su -`）结束或 exec               | 是              |
| `unset savehist; exec …`                              | 否              |

最初的修复用的是 `exec /bin/sh -c`，实测发现它会在 tcsh 下写出 `.history`。改成不带 exec 后，终端方式关闭通道时仍会写。最终两者一起用：`exec` 让 sh 取代登录 shell、不留父进程，`unset savehist` 防止 exec 时写历史。`$$` 在内层 sh 中求值，exec 也不改变 PID，所以 sudo 的 PID 判定不受影响。

## 4. 验证（已执行）

- 单元测试：`src/main/modules/connection/` 全部通过（237 passed）。`ssh-session.test.ts` 新增 `viaPosixShell` 的包装、转义与拒绝；`sudo-switch.test.ts` 更新了 `startCommand` 的期望值。
- `pnpm typecheck`、`pnpm lint`、`prettier --check` 通过。
- WSL 实机测试 `PCH_WSL_SFTP=1 pnpm vitest run …/wsl.test.ts`：21 passed、1 skipped（原有的跳过）。
  - 原有 4 个发行版的 bash 用例全部通过：sudo / sudo-rs、精确规则、requiretty 下改用终端方式、1MB 哈希往返、错误密码只记 1 次、无残留轮询。
  - 新增「csh：Debian / AlmaLinux-9」用例全部通过：app3 / app1 / root 切换，「测试连接」全部步骤成功，非终端 / 终端方式都能读回文件，无残留轮询，登录用户与目标用户的家目录前后文件列表一致。

未验证：

- 公司的实际服务器（请需求方用新构建确认）。
- ksh / zsh 作为登录 shell：按语法推断没有问题，但未实测。
- fish 等语法不同的 shell。

## 5. 遗留（未处理）

- `CONN_SUDO_FAILED` 等错误的 detail 不显示在界面上，也不写入日志，现场排查只能靠手动执行命令。建议另行处理：把 detail（已脱敏）写入 `main.log`，并在「测试连接」的结果中显示。
