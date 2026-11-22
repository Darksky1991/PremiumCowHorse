#!/bin/bash
# 切换 sudoers 场景：pch-scenario <all|exact|requiretty|targetpw|exact-requiretty> [noisy|quiet]
set -e
SU=$(command -v su)
F=/etc/sudoers.d/pch-spike
case "$1" in
  all)        R="pchuser ALL=(ALL) ALL" ;;
  exact)      R="pchuser ALL=(root) $SU - app1, $SU - root, $SU -" ;;
  requiretty) R=$'Defaults:pchuser requiretty\npchuser ALL=(ALL) ALL' ;;
  targetpw)   R=$'Defaults:pchuser targetpw\npchuser ALL=(ALL) ALL' ;;
  exact-requiretty) R=$'Defaults:pchuser requiretty\n'"pchuser ALL=(root) $SU - app1, $SU - root, $SU -" ;;
  *) echo "unknown scenario"; exit 2 ;;
esac
printf '%s\n' "$R" > $F && chmod 440 $F && visudo -cf $F >/dev/null
# app1 的登录脚本：noisy 时向 stdout 输出欢迎信息（污染 SFTP 的典型情况）
if [ "$2" = noisy ]; then
  echo 'echo "Welcome app1 - profile output"' > /home/app1/.bash_profile
else
  printf '[ -f ~/.bashrc ] && . ~/.bashrc\n' > /home/app1/.bash_profile
fi
chown app1:app1 /home/app1/.bash_profile
echo "scenario=$1 profile=${2:-quiet}: $(tr '\n' ';' < $F)"
