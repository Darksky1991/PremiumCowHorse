/** fallback 插件自带的语言资源（键不含 '.'；三种语言的键必须一致） */
const ja = {
  name: 'ファイル情報',
  location: '場所',
  size: 'サイズ',
  sizeWithBytes: '{{short}}（{{bytes}}）',
  modified: '更新日時',
  kind: '種類',
  kindFile: 'ファイル',
  kindDirectory: 'フォルダー',
  noPreview: 'この種類のファイルはプレビューできません。',
  reveal: 'エクスプローラーで表示',
  copyPath: 'パスをコピー',
  openWithSystem: '既定のアプリで開く',
  viewAsText: 'テキストとして表示'
}

type Messages = Record<keyof typeof ja, string>

const zhCN: Messages = {
  name: '文件信息',
  location: '位置',
  size: '大小',
  sizeWithBytes: '{{short}}（{{bytes}}）',
  modified: '修改时间',
  kind: '类型',
  kindFile: '文件',
  kindDirectory: '文件夹',
  noPreview: '无法预览此类文件。',
  reveal: '在资源管理器中显示',
  copyPath: '复制路径',
  openWithSystem: '用系统应用打开',
  viewAsText: '作为文本查看'
}

const en: Messages = {
  name: 'File info',
  location: 'Location',
  size: 'Size',
  sizeWithBytes: '{{short}} ({{bytes}})',
  modified: 'Modified',
  kind: 'Type',
  kindFile: 'File',
  kindDirectory: 'Folder',
  noPreview: "This kind of file can't be previewed.",
  reveal: 'Reveal in File Explorer',
  copyPath: 'Copy path',
  openWithSystem: 'Open with default app',
  viewAsText: 'View as text'
}

export const messages: Record<string, Messages> = { ja, 'zh-CN': zhCN, en }
