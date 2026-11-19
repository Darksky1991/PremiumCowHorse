/**
 * folder 插件自带的语言资源（键不含 '.'；三种语言的键必须一致）。
 * items_one / items_other 为 i18next 的复数形式（按 count 选择；ja / zh-CN 只用 _other），n 为按界面语言格式化的数字
 */
const ja = {
  name: 'フォルダー',
  breadcrumb: '場所',
  up: '上のフォルダーへ',
  refresh: '最新の情報に更新',
  colName: '名前',
  colModified: '更新日時',
  colType: '種類',
  colSize: 'サイズ',
  typeFolder: 'フォルダー',
  typeFolderLink: 'フォルダーへのリンク',
  typeFileLink: 'ファイルへのリンク',
  typeBrokenLink: 'リンク切れ',
  typeFile: '{{ext}} ファイル',
  typeFileNoExt: 'ファイル',
  empty: 'このフォルダーは空です。',
  loading: '読み込み中…',
  retry: '再試行',
  items_one: '{{n}} 個の項目',
  items_other: '{{n}} 個の項目',
  offline: '切断中（キャッシュを表示中）'
}

type Messages = Record<keyof typeof ja, string>

const zhCN: Messages = {
  name: '文件夹',
  breadcrumb: '位置',
  up: '上一级',
  refresh: '刷新',
  colName: '名称',
  colModified: '修改时间',
  colType: '类型',
  colSize: '大小',
  typeFolder: '文件夹',
  typeFolderLink: '指向文件夹的链接',
  typeFileLink: '指向文件的链接',
  typeBrokenLink: '失效的链接',
  typeFile: '{{ext}} 文件',
  typeFileNoExt: '文件',
  empty: '此文件夹为空。',
  loading: '正在加载…',
  retry: '重试',
  items_one: '{{n}} 项',
  items_other: '{{n}} 项',
  offline: '已断开（基于缓存）'
}

const en: Messages = {
  name: 'Folder',
  breadcrumb: 'Location',
  up: 'Up one level',
  refresh: 'Refresh',
  colName: 'Name',
  colModified: 'Modified',
  colType: 'Type',
  colSize: 'Size',
  typeFolder: 'Folder',
  typeFolderLink: 'Link to folder',
  typeFileLink: 'Link to file',
  typeBrokenLink: 'Broken link',
  typeFile: '{{ext}} file',
  typeFileNoExt: 'File',
  empty: 'This folder is empty.',
  loading: 'Loading…',
  retry: 'Retry',
  items_one: '{{n}} item',
  items_other: '{{n}} items',
  offline: 'Disconnected (showing cached contents)'
}

export const messages: Record<string, Messages> = { ja, 'zh-CN': zhCN, en }
