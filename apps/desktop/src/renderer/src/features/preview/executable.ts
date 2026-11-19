/**
 * 「用系统应用打开」前需要确认的可执行类扩展名（设计 devDoc/2026-11-19-12 第 3.3 节，
 * 审查时追加 .pif .scf .msp .jar .appref-ms）：双击这些文件会运行程序、脚本或修改系统设置。
 */
const EXECUTABLE_EXTENSIONS = new Set([
  'exe',
  'com',
  'bat',
  'cmd',
  'ps1',
  'vbs',
  'vbe',
  'js',
  'jse',
  'wsf',
  'wsh',
  'msi',
  'msc',
  'scr',
  'lnk',
  'reg',
  'hta',
  'cpl',
  'pif',
  'scf',
  'msp',
  'jar',
  'appref-ms'
])

/**
 * 文件名的扩展名是否属于可执行类（大小写不敏感）。
 * - NTFS 备用数据流（`run.bat::$DATA`、`run.bat:stream`）按第一个 `:` 之前的文件名判断。
 * - Windows 打开路径时会去掉名称末尾的点与空格（`run.bat.` 按 `run.bat` 打开），判断前同样去掉。
 */
export function isExecutableExtension(name: string): boolean {
  const colon = name.indexOf(':')
  const base = colon < 0 ? name : name.slice(0, colon)
  const trimmed = base.replace(/[. ]+$/, '')
  const dot = trimmed.lastIndexOf('.')
  if (dot < 0) return false
  return EXECUTABLE_EXTENSIONS.has(trimmed.slice(dot + 1).toLowerCase())
}
