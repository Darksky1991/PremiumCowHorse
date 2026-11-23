/** office 插件自带的语言资源（键不含 '.'；三种语言的键必须一致） */
const ja = {
  name: 'Office 起動',
  location: '場所',
  size: 'サイズ',
  sizeWithBytes: '{{short}}（{{bytes}}）',
  modified: '更新日時',
  openWithApp: '{{app}} で開く',
  openWithAssociated: '関連付けられたアプリで開く',
  openWithDefault: '既定のアプリで開く',
  modeReadOnly: '読み取り専用',
  modeEdit: '編集',
  modeNewFromFile: '新規作成',
  modeProtectedView: '保護ビュー',
  launching: '起動中',
  detectFailed:
    'アプリの検出に失敗しました（PowerShell が制限されている可能性があります）。「再検出」をお試しください',
  detecting: '検出中…',
  reveal: 'エクスプローラーで表示',
  copyPath: 'パスをコピー',
  redetect: '再検出'
}

type Messages = Record<keyof typeof ja, string>

const zhCN: Messages = {
  name: 'Office 启动',
  location: '位置',
  size: '大小',
  sizeWithBytes: '{{short}}（{{bytes}}）',
  modified: '修改时间',
  openWithApp: '用 {{app}} 打开',
  openWithAssociated: '用关联的应用打开',
  openWithDefault: '用默认应用打开',
  modeReadOnly: '只读',
  modeEdit: '编辑',
  modeNewFromFile: '新建',
  modeProtectedView: '保护视图',
  launching: '启动中',
  detectFailed: '检测应用失败（PowerShell 可能受到限制）。请尝试“重新检测”',
  detecting: '检测中…',
  reveal: '在资源管理器中显示',
  copyPath: '复制路径',
  redetect: '重新检测'
}

const en: Messages = {
  name: 'Office launcher',
  location: 'Location',
  size: 'Size',
  sizeWithBytes: '{{short}} ({{bytes}})',
  modified: 'Modified',
  openWithApp: 'Open with {{app}}',
  openWithAssociated: 'Open with the associated app',
  openWithDefault: 'Open with default app',
  modeReadOnly: 'Read-only',
  modeEdit: 'Edit',
  modeNewFromFile: 'Create new',
  modeProtectedView: 'Protected View',
  launching: 'Launching',
  detectFailed: 'Could not detect the app (PowerShell may be restricted). Try “Re-detect”',
  detecting: 'Detecting…',
  reveal: 'Reveal in File Explorer',
  copyPath: 'Copy path',
  redetect: 'Re-detect'
}

export const messages: Record<string, Messages> = { ja, 'zh-CN': zhCN, en }
