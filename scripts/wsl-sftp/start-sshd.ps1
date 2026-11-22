# 在各 WSL 实例中以前台方式启动 sshd（每个实例一个端口；关闭窗口即停止）
# 用法：powershell -File scripts/wsl-sftp/start-sshd.ps1
# 所有 WSL2 实例共用同一个网络，因此端口必须各不相同
$ports = [ordered]@{ 'Ubuntu' = 2201; 'Debian' = 2202; 'AlmaLinux-9' = 2203; 'openSUSE-Leap-16.1' = 2204 }
foreach ($d in $ports.Keys) {
  $p = $ports[$d]
  # /run 在实例重启后被清空，sshd 需要 /run/sshd
  $cmd = "mkdir -p /run/sshd && exec /usr/sbin/sshd -D -e -p $p -o PasswordAuthentication=yes -o KbdInteractiveAuthentication=yes -o PermitRootLogin=yes"
  Start-Process -FilePath wsl.exe -ArgumentList @('-d', $d, '-u', 'root', '--', 'bash', '-c', "`"$cmd`"")
  Write-Output "$d -> 127.0.0.1:$p"
}
