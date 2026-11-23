import type { JSX } from 'react'
import {
  AppWindowIcon,
  BookTextIcon,
  DatabaseIcon,
  FileArchiveIcon,
  FileBracesIcon,
  FileCodeIcon,
  FileCogIcon,
  FileIcon as FallbackIcon,
  FileHeadphoneIcon,
  FileImageIcon,
  FileKeyIcon,
  FilePlayIcon,
  FileSpreadsheetIcon,
  FileSymlinkIcon,
  FileTerminalIcon,
  FileTextIcon,
  FileTypeIcon,
  FileXIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderSymlinkIcon,
  MailIcon,
  PackageIcon,
  PresentationIcon,
  ScrollTextIcon,
  SheetIcon,
  type LucideIcon
} from 'lucide-react'
import { cn } from 'cn'
import { iconFor, type IconCategory } from './lib/file-icon-map'

/** 文件夹类的同色填充（lucide 的 folder 是单一闭合路径，填充可靠；其他图标只着色描边） */
const FOLDER_FILL = 'fill-fi-folder-fill'

/**
 * 类别 → 字形与颜色（取自设计稿 file-icons.html；颜色令牌见 globals.css 的 --fi-*）。
 * 类名写成完整字面量，Tailwind 才能扫描到
 */
const ICONS: Record<IconCategory, { Icon: LucideIcon; color: string }> = {
  folder: { Icon: FolderIcon, color: 'text-fi-folder' },
  'folder-link': { Icon: FolderSymlinkIcon, color: 'text-fi-folder' },
  'file-link': { Icon: FileSymlinkIcon, color: 'text-fi-neutral' },
  'link-broken': { Icon: FileXIcon, color: 'text-fi-danger' },
  document: { Icon: FileTextIcon, color: 'text-fi-word' },
  spreadsheet: { Icon: FileSpreadsheetIcon, color: 'text-fi-excel' },
  presentation: { Icon: PresentationIcon, color: 'text-fi-powerpoint' },
  pdf: { Icon: FileTypeIcon, color: 'text-fi-pdf' },
  csv: { Icon: SheetIcon, color: 'text-fi-csv' },
  mail: { Icon: MailIcon, color: 'text-fi-mail' },
  text: { Icon: FileTextIcon, color: 'text-fi-neutral' },
  markdown: { Icon: BookTextIcon, color: 'text-fi-markdown' },
  log: { Icon: ScrollTextIcon, color: 'text-fi-log' },
  script: { Icon: FileTerminalIcon, color: 'text-fi-script' },
  code: { Icon: FileCodeIcon, color: 'text-fi-code' },
  sql: { Icon: FileCodeIcon, color: 'text-fi-database' },
  database: { Icon: DatabaseIcon, color: 'text-fi-database' },
  json: { Icon: FileBracesIcon, color: 'text-fi-config' },
  config: { Icon: FileCogIcon, color: 'text-fi-config' },
  cert: { Icon: FileKeyIcon, color: 'text-fi-cert' },
  archive: { Icon: FileArchiveIcon, color: 'text-fi-archive' },
  package: { Icon: PackageIcon, color: 'text-fi-archive' },
  image: { Icon: FileImageIcon, color: 'text-fi-image' },
  audio: { Icon: FileHeadphoneIcon, color: 'text-fi-media' },
  video: { Icon: FilePlayIcon, color: 'text-fi-media' },
  executable: { Icon: AppWindowIcon, color: 'text-fi-exe' },
  file: { Icon: FallbackIcon, color: 'text-fi-neutral' }
}

export interface FileIconProps {
  name: string
  kind: 'file' | 'directory' | 'symlink'
  /** kind 为 symlink 时的链接目标类型；null / 缺省为失效链接 */
  target?: 'file' | 'directory' | null
  /** 目录已展开（打开的文件夹图标） */
  open?: boolean
  /** 不按类别着色，随调用方的前景色（选中行等）；失效链接仍为红色 */
  monochrome?: boolean
  className?: string
}

/**
 * 按类型（扩展名 / 目录 / 链接）显示、按类别着色的图标。
 * 颜色在前、调用方的 className 在后，经 cn（tailwind-merge）合并；
 * 失效链接固定 text-destructive，取代调用方传入的文字颜色，不取决于生成的 CSS 中两个类的先后
 */
export function FileIcon({
  name,
  kind,
  target,
  open,
  monochrome,
  className
}: FileIconProps): JSX.Element {
  const category = iconFor(name, kind, target)
  const { Icon: base, color } = ICONS[category]
  const Icon = category === 'folder' && open ? FolderOpenIcon : base
  const fill = category === 'folder' || category === 'folder-link' ? FOLDER_FILL : undefined
  let cls: string | undefined
  if (category === 'link-broken') cls = cn(className, 'text-destructive')
  else if (monochrome) cls = className
  else cls = cn(color, fill, className)
  return <Icon aria-hidden className={cls} />
}
