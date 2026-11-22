#!/bin/bash
# 试验环境配置（以 root 执行）：装 sshd / sudo，建试验用户，准备 sudoers 场景切换脚本
set -e
. /etc/os-release
echo "== $PRETTY_NAME"
if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq openssh-server sudo passwd >/dev/null
elif command -v dnf >/dev/null; then
  dnf install -y -q openssh-server sudo passwd util-linux >/dev/null
elif command -v zypper >/dev/null; then
  zypper -n -q in openssh-server sudo shadow >/dev/null
fi
ssh-keygen -A >/dev/null
mkdir -p /run/sshd /var/run/sshd

mkuser() { id "$1" >/dev/null 2>&1 || useradd -m -s /bin/bash "$1"; echo "$1:$2" | chpasswd; }
mkuser pchuser 'Pch-pass1'
mkuser app1 'App1-pass1'
mkuser app2 'App2-pass1'
echo 'root:Root-pass1' | chpasswd

# app1 专属目录：只有 app1 能读
mkdir -p /opt/app1/log/sub
echo "hello from app1 $(date)" > /opt/app1/log/app.log
chown -R app1:app1 /opt/app1 && chmod -R 750 /opt/app1
# root 专属
mkdir -p /root/secret && echo root-only > /root/secret/r.txt && chmod 700 /root/secret

# sshd 配置（单独文件，主配置 Include 时生效；否则直接用 -o 参数启动）
cat > /etc/ssh/pch-spike.conf <<'EOF'
PasswordAuthentication yes
KbdInteractiveAuthentication yes
UsePAM yes
EOF

# sftp-server 位置
echo "sftp-server candidates:"
for p in /usr/libexec/openssh/sftp-server /usr/lib/openssh/sftp-server /usr/lib/ssh/sftp-server /usr/libexec/ssh/sftp-server /usr/lib64/ssh/sftp-server /usr/libexec/sftp-server; do
  [ -x "$p" ] && echo "  $p"
done
echo "sshd Subsystem:"; grep -ri '^\s*Subsystem' /etc/ssh/sshd_config /etc/ssh/sshd_config.d /usr/etc/ssh 2>/dev/null || true
echo "default sudoers Defaults:"; grep -E '^\s*Defaults' /etc/sudoers /usr/etc/sudoers 2>/dev/null | grep -Ei 'targetpw|requiretty|use_pty|rootpw' || echo "  (none of targetpw/requiretty/use_pty)"
echo "su path: $(command -v su)  sudo: $(sudo -V | head -1)"
echo "openssh: $(ssh -V 2>&1)"
cp "$(dirname "$0")/scenario.sh" /usr/local/sbin/pch-scenario && chmod 755 /usr/local/sbin/pch-scenario
pch-scenario all
