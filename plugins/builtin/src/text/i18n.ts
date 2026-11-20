/** text 插件自带的语言资源（键不含 '.'；三种语言的键必须一致） */
const ja = {
  name: 'テキスト',
  viewLabel: 'ファイルの内容',
  toolbarLabel: '表示位置',
  toStart: '先頭へ',
  toEnd: '末尾へ',
  follow: '末尾を追従',
  encoding: '文字コード',
  encodingAuto: '自動判別',
  encodingAutoDetected: '{{name}}（自動）',
  encodingGuess: '文字コードは推定です',
  mayBeGarbled: '文字化けしている可能性があります',
  lineCount: '{{lines}} 行',
  indexing: '行を数えています {{percent}}%（{{lines}} 行）',
  indexFailed: '読み込みに失敗しました（{{code}}）。更新で再試行します',
  partialHead: '先頭 {{window}} のみ表示（全体 {{size}}）',
  partialTail: '末尾 {{window}} のみ表示（全体 {{size}}）',
  readAll: 'すべて読み込む',
  truncatedHint: '長すぎる行は途中までしか表示していません',
  lineTruncated: '…（行が長すぎるため省略）',
  missing: 'ファイルが存在しません。以前の内容を表示しています',
  binaryHint: 'バイナリファイルをテキストとして表示しています',
  empty: '空のファイルです'
}

type Messages = Record<keyof typeof ja, string>

const zhCN: Messages = {
  name: '文本',
  viewLabel: '文件内容',
  toolbarLabel: '显示位置',
  toStart: '到开头',
  toEnd: '到末尾',
  follow: '跟随末尾',
  encoding: '编码',
  encodingAuto: '自动判断',
  encodingAutoDetected: '{{name}}（自动）',
  encodingGuess: '编码为推测',
  mayBeGarbled: '可能乱码',
  lineCount: '{{lines}} 行',
  indexing: '正在统计行数 {{percent}}%（{{lines}} 行）',
  indexFailed: '读取失败（{{code}}），刷新时重试',
  partialHead: '仅显示开头 {{window}} / 共 {{size}}',
  partialTail: '仅显示末尾 {{window}} / 共 {{size}}',
  readAll: '读取全部',
  truncatedHint: '过长的行只显示了开头部分',
  lineTruncated: '…（本行过长，已截断）',
  missing: '文件已不存在，显示的是之前的内容',
  binaryHint: '正在把二进制文件作为文本显示',
  empty: '空文件'
}

const en: Messages = {
  name: 'Text',
  viewLabel: 'File content',
  toolbarLabel: 'Position',
  toStart: 'Go to start',
  toEnd: 'Go to end',
  follow: 'Follow end',
  encoding: 'Encoding',
  encodingAuto: 'Auto-detect',
  encodingAutoDetected: '{{name}} (auto)',
  encodingGuess: 'Encoding is a guess',
  mayBeGarbled: 'Text may be garbled',
  lineCount: 'Lines: {{lines}}',
  indexing: 'Counting lines {{percent}}% ({{lines}} lines)',
  indexFailed: 'Reading failed ({{code}}); refresh to retry',
  partialHead: 'Showing the first {{window}} of {{size}}',
  partialTail: 'Showing the last {{window}} of {{size}}',
  readAll: 'Read all',
  truncatedHint: 'Long lines are cut off',
  lineTruncated: '… (line too long, cut off)',
  missing: 'The file no longer exists; showing earlier content',
  binaryHint: 'Showing a binary file as text',
  empty: 'Empty file'
}

export const messages: Record<string, Messages> = { ja, 'zh-CN': zhCN, en }
