#!/bin/bash
# csh 场景（以 root 执行，可重复执行）：登录用户与目标用户的 shell 都是 /bin/csh（现场实例：sudo 1.8.19p2、
# 登录用户 / 目标用户均为 /bin/csh）。apt 系装 BSD csh（csh 包），dnf / zypper 系装 tcsh（/bin/csh 为其链接）。
# 用户：pchcsh / Pch-pass1（登录）、app3（目标，无密码登录）。sudoers 为精确规则，与 pch-scenario 的文件互不影响。
set -e
if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq csh >/dev/null
elif command -v dnf >/dev/null; then
  dnf install -y -q tcsh >/dev/null
elif command -v zypper >/dev/null; then
  zypper -n -q in tcsh >/dev/null
fi
[ -x /bin/csh ] || { echo "/bin/csh not found"; exit 1; }
echo "/bin/csh -> $(readlink -f /bin/csh)"

mkcsh() { id "$1" >/dev/null 2>&1 || useradd -m -s /bin/csh "$1"; usermod -s /bin/csh "$1" >/dev/null 2>&1 || true; }
mkcsh pchcsh
echo 'pchcsh:Pch-pass1' | chpasswd
mkcsh app3
echo "hello from app3" > /home/app3/app3.txt
chown app3:app3 /home/app3/app3.txt && chmod 700 /home/app3

SU=$(command -v su)
T=$(mktemp /etc/pch-csh.XXXXXX)
trap 'rm -f "$T"' EXIT
printf 'pchcsh ALL=(root) %s - app3, %s - app1, %s -\n' "$SU" "$SU" "$SU" > "$T"
visudo -cf "$T" >/dev/null
chmod 440 "$T" && mv -f "$T" /etc/sudoers.d/pch-csh
echo "sudoers: $(cat /etc/sudoers.d/pch-csh)"
