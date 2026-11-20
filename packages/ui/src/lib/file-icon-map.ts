/** 图标类别（与具体图标库解耦；FileIcon 组件把类别映射到 lucide 图标） */
export type IconCategory =
  | 'folder'
  | 'folder-link'
  | 'file-link'
  | 'link-broken'
  | 'text'
  | 'log'
  | 'code'
  | 'json'
  | 'spreadsheet'
  | 'document'
  | 'presentation'
  | 'pdf'
  | 'image'
  | 'audio'
  | 'video'
  | 'archive'
  | 'executable'
  | 'config'
  | 'file'

function group(category: IconCategory, exts: string): [string, IconCategory][] {
  return exts.split(' ').map((e) => [e, category])
}

/**
 * 扩展名（小写）→ 类别。
 * 可执行类对齐渲染端 features/preview/executable.ts 的 EXECUTABLE_EXTENSIONS（@pch/ui 不能 import 渲染端代码，
 * 这里另列一份；那份是「打开前需确认」的安全清单，这份只决定图标，两者无需逐项同步）。
 * 同一扩展名出现在多组时以后者为准（js 归可执行还是代码：按文件管理器的习惯归代码，故不放入可执行组）。
 */
const BY_EXTENSION: ReadonlyMap<string, IconCategory> = new Map<string, IconCategory>([
  ...group('text', 'txt md markdown rtf text'),
  ...group('log', 'log out'),
  ...group(
    'code',
    'js mjs cjs jsx ts tsx py java c h cpp hpp cs go rs rb php sh sql html htm css scss xml vue kt swift'
  ),
  ...group('json', 'json jsonc json5'),
  ...group('spreadsheet', 'xlsx xls xlsm csv tsv ods'),
  ...group('document', 'docx doc docm odt'),
  ...group('presentation', 'pptx ppt pptm odp'),
  ...group('pdf', 'pdf'),
  ...group('image', 'png jpg jpeg gif bmp webp svg ico tif tiff heic'),
  ...group('audio', 'mp3 wav flac aac ogg m4a wma'),
  ...group('video', 'mp4 mkv avi mov wmv webm flv m4v'),
  ...group('archive', 'zip 7z rar tar gz tgz bz2 xz cab iso'),
  ...group(
    'executable',
    'exe com bat cmd ps1 vbs vbe jse wsf wsh msi msc scr lnk reg hta cpl pif scf msp jar url'
  ),
  ...group('config', 'ini conf cfg yaml yml toml properties env')
])

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
  return BY_EXTENSION.get(extensionOf(name)) ?? 'file'
}
