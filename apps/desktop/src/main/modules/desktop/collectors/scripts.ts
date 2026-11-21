/**
 * 固定 PowerShell 脚本：不拼接任何数据，输入只经环境变量。
 * 输出统一为 UTF-8 的紧凑 JSON；空输出表示没有项目。
 */

/**
 * 资源管理器：输入 PCH_HWNDS（逗号分隔的窗口句柄数值）。
 * 输出 [{ hwnd, tabs }]；标签取 Shell.Application 的各标签项（不含主文件夹页内的非窗口子标签），
 * 顺序按 UI Automation 的 TabItem 顺序（以 LocationName 对应），对不上的排在后面。
 */
export const EXPLORER_SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$want = @{}
foreach ($s in ($env:PCH_HWNDS -split ',')) { if ($s -match '^\\d+$') { $want[[int64]$s] = $true } }
$sh = New-Object -ComObject Shell.Application
$byHwnd = @{}
foreach ($w in $sh.Windows()) {
  try {
    $h = [int64]$w.HWND
    if (-not $want.ContainsKey($h)) { continue }
    $p = $w.Document.Folder.Self.Path
    if ([string]::IsNullOrEmpty($p)) { continue }
    if (-not $byHwnd.ContainsKey($h)) { $byHwnd[$h] = New-Object System.Collections.ArrayList }
    [void]$byHwnd[$h].Add([pscustomobject]@{ Path = $p; Name = [string]$w.LocationName })
  } catch {}
}
$AE = [type]::GetType('System.Windows.Automation.AutomationElement, UIAutomationTypes')
$out = @()
foreach ($h in ($byHwnd.Keys | Sort-Object)) {
  $items = @($byHwnd[$h])
  $order = @()
  try {
    $root = $AE::FromHandle([IntPtr]$h)
    $cond = New-Object Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [Windows.Automation.ControlType]::TabItem)
    foreach ($t in $root.FindAll([Windows.Automation.TreeScope]::Descendants, $cond)) { $order += [string]$t.Current.Name }
  } catch {}
  $sorted = @(); $used = @{}
  foreach ($n in $order) {
    for ($i = 0; $i -lt $items.Count; $i++) {
      if (-not $used.ContainsKey($i) -and $items[$i].Name -eq $n) { $used[$i] = $true; $sorted += $items[$i].Path; break }
    }
  }
  for ($i = 0; $i -lt $items.Count; $i++) { if (-not $used.ContainsKey($i)) { $sorted += $items[$i].Path } }
  $out += [pscustomobject]@{ hwnd = $h; tabs = @($sorted) }
}
if ($out.Count -gt 0) { ConvertTo-Json -InputObject @($out) -Depth 4 -Compress }
`

/**
 * Office：输入 PCH_PIDS（逗号分隔的进程号）。
 * 对可见顶层窗口（XLMAIN / OpusApp / PPTFrameClass）的子窗口（EXCEL7 / _WwG / mdiClass）取 OBJID_NATIVEOM，
 * 再 .Application，按 pid 去重后枚举文档。输出 [{ app, path, readOnly, hwnd }]。
 * 找到子窗口但取不到 Application、或 FullName 为空（弹着对话框）时输出 {"error":"busy"}。无完整路径的文档不输出。
 */
export const OFFICE_SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
Add-Type @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class PchOW {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc p, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr h, uint id, ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object o);
  public static string Cls(IntPtr h){ var s=new StringBuilder(256); GetClassNameW(h,s,256); return s.ToString(); }
  public static List<object[]> Tops(){ var r=new List<object[]>(); EnumWindows((h,l)=>{ uint p; GetWindowThreadProcessId(h,out p); r.Add(new object[]{h.ToInt64(),(int)p,Cls(h),IsWindowVisible(h)}); return true;}, IntPtr.Zero); return r; }
  public static List<object[]> Children(IntPtr top){ var r=new List<object[]>(); EnumChildWindows(top,(h,l)=>{ r.Add(new object[]{h.ToInt64(),Cls(h)}); return true;}, IntPtr.Zero); return r; }
  public static object NativeOM(IntPtr h){ Guid g=new Guid("00020400-0000-0000-C000-000000000046"); object o; int hr=AccessibleObjectFromWindow(h,0xFFFFFFF0,ref g,out o); if(hr!=0) return null; return o; }
}
'@
$pids = @{}
foreach ($s in ($env:PCH_PIDS -split ',')) { if ($s -match '^\\d+$') { $pids[[int]$s] = $true } }
$map = @{ XLMAIN = @('Workbooks', 'excel', 'EXCEL7'); OpusApp = @('Documents', 'word', '_WwG'); PPTFrameClass = @('Presentations', 'powerpoint', 'mdiClass') }
$done = @{}
$out = @()
function Busy { '{"error":"busy"}'; exit 0 }
foreach ($t in [PchOW]::Tops()) {
  if (-not $pids.ContainsKey($t[1]) -or -not $map.ContainsKey($t[2]) -or -not $t[3] -or $done.ContainsKey($t[1])) { continue }
  $m = $map[$t[2]]
  $app = $null
  $found = $false
  foreach ($c in [PchOW]::Children([IntPtr]$t[0])) {
    if ($c[1] -eq $m[2]) {
      $found = $true
      $oc = [PchOW]::NativeOM([IntPtr]$c[0])
      if (-not $oc) { Busy }
      try { $app = $oc.Application } catch { Busy }
      if (-not $app) { Busy }
      break
    }
  }
  if (-not $found) { continue }
  $done[$t[1]] = $true
  $col = $app.($m[0])
  $n = $col.Count
  for ($i = 1; $i -le $n; $i++) {
    if ($m[1] -eq 'word') { $ix = [ref]$i; $it = $col.Item($ix) } else { $it = $col.Item($i) }
    $full = $it.FullName
    if ([string]::IsNullOrEmpty($full)) { Busy }
    if ($m[1] -eq 'excel') { try { if ($it.Windows.Count -eq 0) { continue } } catch {} }
    if ($full -notmatch '^([A-Za-z]:\\\\|\\\\\\\\|https?://)') { continue }
    $out += [pscustomobject]@{ app = $m[1]; path = [string]$full; readOnly = [bool]$it.ReadOnly; hwnd = $t[0] }
  }
}
if ($out.Count -gt 0) { ConvertTo-Json -InputObject @($out) -Depth 4 -Compress }
`

/**
 * Eclipse：输入 PCH_PID（进程号，脚本内先校验为纯数字）。
 * 只输出该进程的 CommandLine（可能含其他参数，调用方只取 -data，不保存整串）；进程不存在时无输出。
 */
export const ECLIPSE_COMMANDLINE_SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
if ($env:PCH_PID -notmatch '^\\d+$') { exit 1 }
$p = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$env:PCH_PID)
if ($p -and $p.CommandLine) { $p.CommandLine }
`

/**
 * 资源管理器多标签恢复：输入 PCH_TABS（路径的 JSON 数组；`::{CLSID}` 为原样）。
 * 记下现有 Shell 窗口 → 打开第一个路径（CLSID 写成 shell:::{CLSID}）→ 找到新出现的窗口 →
 * 对其余路径逐个点「添加新标签页」（UIA AutomationId = AddButton），对新标签 Navigate2。
 * 每完成一步输出一行 OK（新窗口建好 1 行，每加好一个标签 1 行），因此即便超时被终止，
 * 调用方也能按已收到的行数得知已恢复的标签数；中途出错时停止，不抛错。
 */
export const EXPLORER_RESTORE_SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$tabs = @(ConvertFrom-Json $env:PCH_TABS | ForEach-Object { $_ })
$sh = New-Object -ComObject Shell.Application
function Get-Shell { foreach ($w in $sh.Windows()) { try { [pscustomobject]@{ Hwnd = [int64]$w.HWND; Obj = $w; Path = [string]$w.Document.Folder.Self.Path } } catch {} } }
try {
  $before = @(Get-Shell | ForEach-Object { $_.Hwnd })
  $first = [string]$tabs[0]
  if ($first.StartsWith('::{')) { $first = 'shell:' + $first }
  Start-Process -FilePath (Join-Path $env:SystemRoot 'explorer.exe') -ArgumentList ('"' + $first + '"')
  $hwnd = $null
  for ($i = 0; $i -lt 60 -and -not $hwnd; $i++) {
    Start-Sleep -Milliseconds 250
    $n = Get-Shell | Where-Object { $before -notcontains $_.Hwnd } | Select-Object -First 1
    if ($n) { $hwnd = $n.Hwnd }
  }
  if (-not $hwnd) { exit 0 }
  Write-Output 'OK'
  if ($tabs.Count -gt 1) {
    $AE = [System.Windows.Automation.AutomationElement]
    $root = $AE::FromHandle([IntPtr]$hwnd)
    $add = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object Windows.Automation.PropertyCondition($AE::AutomationIdProperty, 'AddButton')))
    if (-not $add) { exit 0 }
    for ($k = 1; $k -lt $tabs.Count; $k++) {
      $known = @(Get-Shell | Where-Object { $_.Hwnd -eq $hwnd })
      $add.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      $new = $null
      for ($i = 0; $i -lt 50 -and -not $new; $i++) {
        Start-Sleep -Milliseconds 100
        $cur = @(Get-Shell | Where-Object { $_.Hwnd -eq $hwnd })
        if ($cur.Count -gt $known.Count) {
          $new = $cur | Where-Object { $_.Path -eq '::{F874310E-B6B7-47DC-BC84-B9E6B38F5903}' } | Select-Object -Last 1
          if (-not $new) { $new = $cur | Select-Object -Last 1 }
        }
      }
      if (-not $new) { break }
      if ($new.Path -ne [string]$tabs[$k]) { $new.Obj.Navigate2([string]$tabs[$k]) }
      Write-Output 'OK'
      Start-Sleep -Milliseconds 300
    }
  }
} catch {}
`
