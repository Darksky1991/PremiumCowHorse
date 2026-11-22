#!/bin/bash
# 切换 sudoers 场景：pch-scenario <all|exact|requiretty|targetpw|exact-requiretty> [noisy|quiet]
set -e
SU=$(command -v su)
F=/etc/sudoers.d/pch-spike
# 失败次数的计数（实机测试）：传统 sudo 把「N incorrect password attempt」写入此文件；sudo-rs 不支持 logfile
LOG='Defaults:pchuser logfile=/var/log/pch-sudo.log'
case "$1" in
  all)        R="pchuser ALL=(ALL) ALL" ;;
  exact)      R="pchuser ALL=(root) $SU - app1, $SU - root, $SU -" ;;
  requiretty) R=$'Defaults:pchuser requiretty\npchuser ALL=(ALL) ALL' ;;
  targetpw)   R=$'Defaults:pchuser targetpw\npchuser ALL=(ALL) ALL' ;;
  exact-requiretty) R=$'Defaults:pchuser requiretty\n'"pchuser ALL=(root) $SU - app1, $SU - root, $SU -" ;;
  *) echo "unknown scenario"; exit 2 ;;
esac
# 先写临时文件并校验，通过后才替换：sudoers.d 中留下语法错误的文件会让 sudo 整体不可用。
# 临时文件名含「.」，sudo 的 includedir 不读取；放在 /etc 下以便 mv 是同一文件系统内的改名
T=$(mktemp /etc/pch-spike.XXXXXX)
trap 'rm -f "$T"' EXIT
printf '%s\n%s\n' "$LOG" "$R" > "$T"
if ! visudo -cf "$T" >/dev/null 2>&1; then
  printf '%s\n' "$R" > "$T"
  if ! visudo -cf "$T" >/dev/null 2>&1; then
    # 例如 sudo-rs 不支持 requiretty / targetpw：保留原来的场景
    visudo -cf "$T" || true
    echo "scenario $1 is not supported by this sudo ($(sudo -V | head -1)); unchanged"
    exit 3
  fi
  echo "note: this sudo does not support logfile ($(sudo -V | head -1)); count failures with journalctl"
fi
chmod 440 "$T" && mv -f "$T" "$F"
# app1 的登录脚本：noisy 时向 stdout 输出欢迎信息（污染 SFTP 的典型情况）
if [ "$2" = noisy ]; then
  echo 'echo "Welcome app1 - profile output"' > /home/app1/.bash_profile
else
  printf '[ -f ~/.bashrc ] && . ~/.bashrc\n' > /home/app1/.bash_profile
fi
chown app1:app1 /home/app1/.bash_profile
echo "scenario=$1 profile=${2:-quiet}: $(tr '\n' ';' < $F)"
