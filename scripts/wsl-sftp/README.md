# WSL 上的 SFTP / sudo 试验环境

M4（SFTP 只读，设计见 `devDoc/2026-11-22-37-m4-sftp-design.md`）的先行试验、实施中的真实环境测试与手动验证共用。只用于本机开发，不随应用分发。

## 实例

用 `wsl --install -d <名称> --no-launch` 安装（不经 Microsoft Store）。所有 WSL2 实例共用同一个网络，sshd 各用一个端口：

| 实例                       | 代表                    | sshd 端口 |
| -------------------------- | ----------------------- | --------- |
| `Ubuntu`（26.04，sudo-rs） | Ubuntu                  | 2201      |
| `Debian`（13）             | Debian                  | 2202      |
| `AlmaLinux-9`              | RHEL 9                  | 2203      |
| `openSUSE-Leap-16.1`       | SUSE（默认 `targetpw`） | 2204      |

## 配置（每个实例一次，以 root 执行）

```powershell
wsl -d Debian -u root -- bash /mnt/c/<仓库路径>/scripts/wsl-sftp/setup.sh
```

`setup.sh`：安装 openssh-server / sudo，建试验用户（`pchuser` / `Pch-pass1`、`app1` / `App1-pass1`、`app2`，root 密码 `Root-pass1`），建只有 app1 能读的 `/opt/app1/log` 与只有 root 能读的 `/root/secret`，安装场景切换命令 `pch-scenario`，并输出 sftp-server 位置、sudoers 默认设置与版本。这些是本机试验用的固定密码，不要在其他环境使用。

## csh 场景

```powershell
wsl -d Debian -u root -- bash /mnt/c/<仓库路径>/scripts/wsl-sftp/setup-csh.sh
wsl -d AlmaLinux-9 -u root -- bash /mnt/c/<仓库路径>/scripts/wsl-sftp/setup-csh.sh
```

`setup-csh.sh`（可重复执行）：安装 csh（apt 系为 BSD csh 的 `csh` 包，dnf / zypper 系为 `tcsh`），建登录用户 `pchcsh` / `Pch-pass1` 与目标用户 `app3`（shell 均为 `/bin/csh`），sudoers 文件 `/etc/sudoers.d/pch-csh` 为精确规则 `su - app3`、`su - app1`、`su -`（与 `pch-scenario` 的文件互不影响）。`wsl.test.ts` 只在 Debian 与 AlmaLinux-9 上运行 csh 用例。

## sudoers 场景

```powershell
wsl -d Debian -u root -- pch-scenario <all|exact|requiretty|targetpw|exact-requiretty> [noisy|quiet]
```

- `all`：`pchuser ALL=(ALL) ALL`
- `exact`：只允许 `su - app1`、`su - root`、`su -`（现场常见的精确规则）
- `requiretty` / `exact-requiretty`：加 `Defaults:pchuser requiretty`（sudo-rs 不支持此项）
- `targetpw`：sudo 问目标用户（root）的密码
- `noisy`：app1 的 `.bash_profile` 向标准输出打印欢迎信息（检验协议不被污染）

每个场景都加 `Defaults:pchuser logfile=/var/log/pch-sudo.log`：传统 sudo 在其中记录每次执行（`COMMAND=…`）与密码错误（`1 incorrect password attempt`），实机测试据此数失败次数。sudo-rs 不支持 `logfile`（也不支持 `requiretty` / `targetpw`）：脚本先写临时文件经 `visudo -cf` 校验，`logfile` 不被接受时去掉它并提示，场景本身不被接受时保持原场景不变并以退出码 3 结束（不在 `sudoers.d` 留下语法错误的文件）。

失败次数的另一个来源是 journald（4 个实例都以 systemd 启动）：PAM 对每次密码错误记一行 `pam_unix(sudo:auth): authentication failure` / `pam_unix(sshd:auth): authentication failure`，sudo-rs 也适用。`pam_faillock` 在这 4 个实例的默认 PAM 配置中都没有启用（`faillock --user pchuser` 始终为空）。

修改 `scenario.sh` 后要重新安装到各实例：`wsl -d <实例> -u root -e install -m 755 /mnt/c/<仓库路径>/scripts/wsl-sftp/scenario.sh /usr/local/sbin/pch-scenario`（或重新执行 `setup.sh`）。

## 实机测试

`apps/desktop/src/main/modules/connection/wsl.test.ts` 经真实的 `ConnectionPool`（`connectSsh` / sudo 切换 / SFTP 桥接）连接 4 个实例，默认跳过：

```bash
PCH_WSL_SFTP=1 pnpm vitest run apps/desktop/src/main/modules/connection/wsl.test.ts
```

前提：4 个实例的 sshd 在 2201–2204 监听（见下节），已执行过 `setup.sh` 且安装了最新的 `pch-scenario`。测试会切换 sudoers 场景、清空 `/var/log/pch-sudo.log`、在 `/opt/app1/log` 下临时放一个 1MB 的文件，结束时恢复为 `pch-scenario all quiet` 并删除该文件。约 2.5 分钟。

内容（每个实例）：`all quiet` 下登录用户 / app1 / root 列目录与「测试连接」；`exact noisy` 下精确规则与登录脚本输出、未授权的 app2 被拒绝（openSUSE 默认 `ALL ALL=(ALL) ALL`，不测）；`requiretty` / `exact-requiretty` 下改用终端方式并经切换后的通道读回 1MB 全字节文件比较哈希（sudo-rs 不支持，不测）；错误的 sudo 密码与登录密码各只记 1 次失败、之后不再提交；Debian / AlmaLinux-9 另有 csh 用例（登录 / 目标用户为 csh：非终端 / 终端方式切换、测试连接、家目录前后不多出文件）。

## 启动 sshd

```powershell
powershell -File scripts/wsl-sftp/start-sshd.ps1
```

在 Git Bash 中直接调用 `wsl.exe` 时需加 `MSYS_NO_PATHCONV=1`，否则 `/usr/sbin/sshd` 等参数会被改写为 Windows 路径（`knowledge/windows-and-tooling.md`）。

## reference/

先行试验用过的脚本（用完即弃的质量，只作为实施时的参考，不在项目中运行；依赖 `ssh2`，需在临时目录 `npm install ssh2` 后运行）：

- `sudo-sftp-spike.mjs`：普通 SFTP、经 `sudo su - <目标>` 切换后在命令通道上走 SFTP（非终端 / 终端两种方式、进程表判定认证成功）
- `keepalive-drop.mjs`：保活检测静默断线
