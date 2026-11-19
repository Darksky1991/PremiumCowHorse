import type { JSX } from 'react'
import {
  FileArchiveIcon,
  FileAudioIcon,
  FileCodeIcon,
  FileCogIcon,
  FileIcon as FallbackIcon,
  FileImageIcon,
  FileJsonIcon,
  FileSpreadsheetIcon,
  FileSymlinkIcon,
  FileTerminalIcon,
  FileTextIcon,
  FileTypeIcon,
  FileVideoIcon,
  FileXIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderSymlinkIcon,
  PresentationIcon,
  ScrollTextIcon,
  type LucideIcon
} from 'lucide-react'
import { cn } from 'cn'
import { iconFor, type IconCategory } from './lib/file-icon-map'

const ICONS: Record<IconCategory, LucideIcon> = {
  folder: FolderIcon,
  'folder-link': FolderSymlinkIcon,
  'file-link': FileSymlinkIcon,
  'link-broken': FileXIcon,
  text: FileTextIcon,
  log: ScrollTextIcon,
  code: FileCodeIcon,
  json: FileJsonIcon,
  spreadsheet: FileSpreadsheetIcon,
  document: FileTypeIcon,
  presentation: PresentationIcon,
  pdf: FileTextIcon,
  image: FileImageIcon,
  audio: FileAudioIcon,
  video: FileVideoIcon,
  archive: FileArchiveIcon,
  executable: FileTerminalIcon,
  config: FileCogIcon,
  file: FallbackIcon
}

export interface FileIconProps {
  name: string
  kind: 'file' | 'directory' | 'symlink'
  /** kind 为 symlink 时的链接目标类型；null / 缺省为失效链接 */
  target?: 'file' | 'directory' | null
  /** 目录已展开（打开的文件夹图标） */
  open?: boolean
  className?: string
}

/**
 * 按类型（扩展名 / 目录 / 链接）显示的图标；失效链接用红色（text-destructive），其余颜色由 className 决定。
 * 失效链接用 cn（tailwind-merge）合并：调用方传入的文字颜色（text-muted-foreground 等）被取代，
 * 不取决于生成的 CSS 中两个类的先后
 */
export function FileIcon({ name, kind, target, open, className }: FileIconProps): JSX.Element {
  const category = iconFor(name, kind, target)
  const Icon = category === 'folder' && open ? FolderOpenIcon : ICONS[category]
  return (
    <Icon
      aria-hidden
      className={category === 'link-broken' ? cn(className, 'text-destructive') : className}
    />
  )
}
