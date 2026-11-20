/**
 * 浏览器视图类插件（html / markdown）共用的语言资源：各插件把它与自己的 name 合并为 PreviewPlugin.i18n
 * （键不含 '.'；三种语言的键必须一致）
 */
const ja = {
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
  loading: '正在加载…',
  failed: '无法显示：{{reason}}',
  retry: '重试',
  openExternal: '在系统浏览器中打开',
  noticeOutOfScope: '无法打开范围外的文件',
  noticeDownload: '不支持下载',
  noticeUnsupported: '无法打开此链接'
}

const en: Messages = {
  loading: 'Loading…',
  failed: "Can't display: {{reason}}",
  retry: 'Retry',
  openExternal: 'Open in system browser',
  noticeOutOfScope: "Files outside this folder can't be opened",
  noticeDownload: 'Downloads are not supported',
  noticeUnsupported: "This link can't be opened"
}

/** 合并插件自己的名称：`webPageMessages({ ja: '…', 'zh-CN': '…', en: '…' })` */
export function webPageMessages(
  name: Record<'ja' | 'zh-CN' | 'en', string>
): Record<string, Record<string, string>> {
  return {
    ja: { ...ja, name: name.ja },
    'zh-CN': { ...zhCN, name: name['zh-CN'] },
    en: { ...en, name: name.en }
  }
}
