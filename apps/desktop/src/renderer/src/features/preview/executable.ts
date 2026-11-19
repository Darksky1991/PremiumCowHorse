/**
 * 「用系统应用打开」前需要确认的可执行类扩展名（设计 devDoc/2026-11-19-12 第 3.3 节，
 * 审查时追加 .pif .scf .msp .jar .appref-ms，最终审查追加 .url 起的 21 个）：双击这些文件会运行程序、
 * 脚本、安装应用或修改系统设置。只增加确认，不阻止打开（需求方可裁剪）。
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
  'appref-ms',
  // 最终审查追加：快捷方式 / 网页应用、ClickOnce、安装信息、HTML 帮助、设置快捷方式
  'url',
  'website',
  'application',
  'inf',
  'chm',
  'settingcontent-ms',
  // PowerShell 模块 / 数据 / 格式文件、Windows Script（组件）、VB 源码
  'psm1',
  'psd1',
  'ps1xml',
  'ws',
  'wsc',
  'sct',
  'vb',
  // 应用安装包、Excel 加载项、诊断包、库 / 搜索连接器、边栏小工具
  'appinstaller',
  'msix',
  'appx',
  'xll',
  'diagcab',
  'library-ms',
  'search-ms',
  'gadget'
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
