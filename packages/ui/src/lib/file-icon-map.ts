/**
 * 图标类别（与具体图标库解耦；FileIcon 组件把类别映射到 lucide 图标与颜色）。
 * 共 27 个，与 devDoc/assets/2026-11-23-m5-design/file-icons.html 的 CATS 一致。
 */
export type IconCategory =
  | 'folder'
  | 'folder-link'
  | 'file-link'
  | 'link-broken'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'pdf'
  | 'csv'
  | 'mail'
  | 'text'
  | 'markdown'
  | 'log'
  | 'script'
  | 'code'
  | 'sql'
  | 'database'
  | 'json'
  | 'config'
  | 'cert'
  | 'archive'
  | 'package'
  | 'image'
  | 'audio'
  | 'video'
  | 'executable'
  | 'file'

function group(category: IconCategory, exts: string): [string, IconCategory][] {
  return exts.split(' ').map((e) => [e, category])
}

/**
 * 扩展名（小写）→ 类别（取自设计稿 file-icons.html，同一扩展名只出现在一组）。
 * 可执行类对齐渲染端 features/preview/executable.ts 的 EXECUTABLE_EXTENSIONS（@pch/ui 不能 import 渲染端代码，
 * 这里另列一份；那份是「打开前需确认」的安全清单，这份只决定图标，两者无需逐项同步）。
 */
const BY_EXTENSION: ReadonlyMap<string, IconCategory> = new Map<string, IconCategory>([
  ...group('document', 'doc docx docm dot dotx dotm odt rtf'),
  ...group('spreadsheet', 'xls xlsx xlsm xlsb xlt xltx xltm ods'),
  ...group('presentation', 'ppt pptx pptm pps ppsx pot potx odp'),
  ...group('pdf', 'pdf'),
  ...group('csv', 'csv tsv'),
  ...group('mail', 'msg eml oft emlx mbox'),
  ...group('text', 'txt text'),
  ...group('markdown', 'md markdown mdx'),
  ...group('log', 'log out err trc trace audit'),
  ...group('script', 'sh bash zsh ksh csh bat cmd ps1 psm1 psd1 vbs vbe wsf'),
  ...group(
    'code',
    'java kt scala groovy py rb php go rs c h cpp hpp cs vb js mjs cjs jsx ts tsx vue html htm css scss jsp asp aspx swift pl'
  ),
  ...group('sql', 'sql ddl dml pls pck plsql'),
  ...group('database', 'db sqlite sqlite3 mdb accdb dmp bak frm ibd'),
  ...group('json', 'json jsonc json5 ndjson'),
  ...group('config', 'ini conf cfg cnf yaml yml toml properties env xml xsd plist service'),
  ...group('cert', 'pem crt cer der p12 pfx key pub jks keystore csr ppk'),
  ...group('archive', 'zip 7z rar lzh tar gz tgz bz2 xz zst cab iso'),
  ...group('package', 'jar war ear rpm deb whl nupkg apk'),
  ...group('image', 'png jpg jpeg gif bmp webp svg ico tif tiff heic'),
  ...group('audio', 'mp3 wav flac aac ogg m4a wma'),
  ...group('video', 'mp4 mkv avi mov wmv webm flv m4v'),
  ...group('executable', 'exe com msi msc scr lnk reg hta cpl pif scf msp url')
])

/** 全名（小写）→ 类别：无扩展名或以点开头的常见文件 */
const BY_NAME: ReadonlyMap<string, IconCategory> = new Map<string, IconCategory>([
  ['dockerfile', 'config'],
  ['makefile', 'script'],
  ['.env', 'config'],
  ['.gitignore', 'config'],
  ['.gitattributes', 'config'],
  ['.editorconfig', 'config'],
  ['.npmrc', 'config']
])

/** 轮转日志：app.log.1、app.log.2026-11-01、app.log.gz、catalina.out.3 */
const ROTATED_LOG = /\.(?:log|out)\.(?:\d[\w.-]*|gz|bz2|xz|zip|old)$/i

/** 小写扩展名；没有扩展名（含以点开头的隐藏文件如 .gitignore）时为空串 */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * 条目的图标类别。kind 与 FileEntry 一致（file / directory / symlink）；
 * symlink 的 target 为链接目标类型，null 或缺省表示失效链接。
 */
export function iconFor(
  name: string,
  kind: 'file' | 'directory' | 'symlink',
  target?: 'file' | 'directory' | null
): IconCategory {
  if (kind === 'directory') return 'folder'
  if (kind === 'symlink') {
    if (target === 'directory') return 'folder-link'
    return target === 'file' ? 'file-link' : 'link-broken'
  }
  const lower = name.toLowerCase()
  const byName = BY_NAME.get(lower)
  if (byName) return byName
  if (lower.startsWith('.env.')) return 'config'
  if (ROTATED_LOG.test(name)) return 'log'
  return BY_EXTENSION.get(extensionOf(name)) ?? 'file'
}
