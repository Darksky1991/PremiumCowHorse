/** markdown 插件自带的语言资源（键不含 '.'；三种语言的键必须一致） */
const ja = {
  name: 'Markdown 表示',
  loading: '読み込み中…',
  failed: '表示できません: {{reason}}',
  retry: '再試行',
  noticeOutOfScope: '範囲外のファイルは開けません',
  noticeDownload: 'ダウンロードには対応していません',
  noticeUnsupported: 'このリンクは開けません'
}

type Messages = Record<keyof typeof ja, string>

const zhCN: Messages = {
  name: 'Markdown 显示',
  loading: '正在加载…',
  failed: '无法显示：{{reason}}',
  retry: '重试',
  noticeOutOfScope: '无法打开范围外的文件',
  noticeDownload: '不支持下载',
  noticeUnsupported: '无法打开此链接'
}

const en: Messages = {
  name: 'Markdown',
  loading: 'Loading…',
  failed: "Can't display: {{reason}}",
  retry: 'Retry',
  noticeOutOfScope: "Files outside this folder can't be opened",
  noticeDownload: 'Downloads are not supported',
  noticeUnsupported: "This link can't be opened"
}

export const messages: Record<string, Messages> = { ja, 'zh-CN': zhCN, en }
