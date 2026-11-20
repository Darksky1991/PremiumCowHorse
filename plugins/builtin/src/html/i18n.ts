/** html 插件自带的语言资源（键不含 '.'；三种语言的键必须一致） */
const ja = {
  name: 'ブラウザー表示',
  page: 'ページ',
  loading: '読み込み中…',
  failed: '表示できません: {{reason}}',
  retry: '再試行',
  openExternal: 'システムのブラウザーで開く',
  noticeOutOfScope: '範囲外のファイルは開けません',
  noticeDownload: 'ダウンロードには対応していません',
  noticeUnsupported: 'このリンクは開けません'
}

type Messages = Record<keyof typeof ja, string>

const zhCN: Messages = {
  name: '浏览器显示',
  page: '页面',
  loading: '正在加载…',
  failed: '无法显示：{{reason}}',
  retry: '重试',
  openExternal: '在系统浏览器中打开',
  noticeOutOfScope: '无法打开范围外的文件',
  noticeDownload: '不支持下载',
  noticeUnsupported: '无法打开此链接'
}

const en: Messages = {
  name: 'Browser view',
  page: 'Page',
  loading: 'Loading…',
  failed: "Can't display: {{reason}}",
  retry: 'Retry',
  openExternal: 'Open in system browser',
  noticeOutOfScope: "Files outside this folder can't be opened",
  noticeDownload: 'Downloads are not supported',
  noticeUnsupported: "This link can't be opened"
}

export const messages: Record<string, Messages> = { ja, 'zh-CN': zhCN, en }
