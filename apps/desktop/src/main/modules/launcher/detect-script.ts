/**
 * 传给 powershell.exe -Command 的固定脚本。输入只经环境变量传入，脚本中不拼接任何路径 / 用户数据。
 * 全部为 ASCII（Windows PowerShell 5.1 对无 BOM 的 UTF-8 脚本有坑，见 knowledge）；输出强制 UTF-8。
 * 脚本中不出现双引号字符（避免 execFile 命令行转义的不确定性），需要时用 [char]34。
 */

const HEADER = `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
`

/**
 * 能力检测（doc 10.2）：PCH_EXTS = 逗号分隔的扩展名（不含点）。
 * 对每个扩展名：ProgId（UserChoice 优先，再 HKCR 默认值；不读 UserChoiceLatest，见台账 S4）
 * -> HKCR\<ProgId>\shell 的子键与默认 verb -> 默认 verb（缺省 open）命令行中的 exe
 * （优先取 App Paths 登记的完整路径）-> exe 的 FileDescription。输出 JSON 数组。
 */
export const DETECT_SCRIPT =
  HEADER +
  String.raw`function Get-Default($path) {
  try { return (Get-Item -LiteralPath $path).GetValue('') } catch { return $null }
}
$q = [char]34
$result = @()
foreach ($e in ($env:PCH_EXTS -split ',')) {
  if (-not $e) { continue }
  $ext = '.' + $e
  $progId = $null
  try {
    $progId = (Get-ItemProperty -LiteralPath ('Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\' + $ext + '\UserChoice') -Name ProgId).ProgId
  } catch {}
  if (-not $progId) { $progId = Get-Default ('Registry::HKEY_CLASSES_ROOT\' + $ext) }
  $verbs = @()
  $defaultVerb = $null
  $appName = $null
  $exe = $null
  if ($progId) {
    $shell = 'Registry::HKEY_CLASSES_ROOT\' + $progId + '\shell'
    if (Test-Path -LiteralPath $shell) {
      $verbs = @(Get-ChildItem -LiteralPath $shell | ForEach-Object { $_.PSChildName })
      $dv = Get-Default $shell
      if ($dv) { $defaultVerb = ($dv -split ',')[0] }
      $openVerb = if ($defaultVerb) { $defaultVerb } else { 'open' }
      $cmd = Get-Default ($shell + '\' + $openVerb + '\command')
      if ($cmd) {
        $cmd = [Environment]::ExpandEnvironmentVariables($cmd)
        if ($cmd -match ('^\s*' + $q + '([^' + $q + ']+)' + $q)) { $exe = $Matches[1] } elseif ($cmd -match '^\s*(\S+)') { $exe = $Matches[1] }
      }
    }
  }
  if ($exe) {
    $leaf = Split-Path -Leaf $exe
    foreach ($root in @('HKEY_LOCAL_MACHINE', 'HKEY_CURRENT_USER')) {
      $p = Get-Default ('Registry::' + $root + '\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\' + $leaf)
      if ($p) { $exe = $p.Trim($q); break }
    }
    if (Test-Path -LiteralPath $exe -PathType Leaf) {
      $appName = (Get-Item -LiteralPath $exe).VersionInfo.FileDescription
    } else { $exe = $null }
  }
  $result += [pscustomobject]@{ ext = $e; progId = $progId; defaultVerb = $defaultVerb; verbs = $verbs; appName = $appName; exe = $exe }
}
ConvertTo-Json -InputObject @($result) -Depth 4 -Compress
`

/**
 * 以 shell verb 启动：PCH_TARGET = 本地路径，PCH_VERB = verb。
 * 不用 Start-Process：5.1 没有 -LiteralPath，-FilePath 把 [] 当通配符（台账 S4）。
 */
export const LAUNCH_VERB_SCRIPT =
  HEADER +
  `$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $env:PCH_TARGET
$psi.Verb = $env:PCH_VERB
$psi.UseShellExecute = $true
[void][System.Diagnostics.Process]::Start($psi)
`

/**
 * 以命令行开关启动（UseShellExecute=$true：为 false 时子进程继承 Node 的 stdout 管道，execFile 要等 Office 退出才返回）：PCH_EXE = exe 路径，PCH_ARGS = 参数的 JSON 数组（含目标路径）。
 * .NET Framework 的 ProcessStartInfo 没有 ArgumentList，逐项组成 Arguments：开关（形如 /r）不加引号（Excel 把加了引号的 /r 当作文件名，实测），其余加引号（Windows 路径不含双引号）。
 */
export const LAUNCH_SWITCH_SCRIPT =
  HEADER +
  `$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $env:PCH_EXE
$list = @()
foreach ($x in (ConvertFrom-Json -InputObject $env:PCH_ARGS)) { $list += [string]$x }
$q = [char]34
$psi.Arguments = ($list | ForEach-Object { if ($_ -match '^/[A-Za-z]+$') { $_ } else { $q + $_ + $q } }) -join ' '
$psi.UseShellExecute = $true
[void][System.Diagnostics.Process]::Start($psi)
`
