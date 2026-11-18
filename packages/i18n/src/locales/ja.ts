export default {
  common: {
    appName: 'PremiumCowHorse',
    workspace: 'ワークスペース',
    defaultWorkspace: 'デフォルト',
    search: 'ファイルやコマンドを検索…',
    explorer: 'エクスプローラー',
    connections: 'リモート接続',
    settings: '設定',
    language: '言語',
    theme: 'テーマ',
    themeLight: 'ライト',
    themeDark: 'ダーク',
    followSystem: 'システムに従う',
    ready: '準備完了',
    crashTitle: '画面の表示中に問題が発生しました',
    crashHint:
      '再読み込みしても解決しない場合は、ログファイル（main.log）を添えて担当者に連絡してください。',
    reload: '再読み込み',
    minimize: '最小化',
    maximize: '最大化',
    restore: '元に戻す',
    close: '閉じる'
  },
  explorer: {
    emptyTitle: 'ワークスペースは空です',
    emptyHint: 'フォルダーやファイルをここにドラッグするか、下のボタンから追加してください。',
    addFolder: 'フォルダーを追加',
    addConnection: 'リモート接続を追加'
  },
  connections: {
    emptyTitle: 'リモート接続はまだありません',
    emptyHint: 'SMB・FTP・SFTP サーバーを登録すると、どのワークスペースからでも参照できます。'
  },
  welcome: {
    title: 'ようこそ',
    subtitle: '案件ごとにファイルをまとめて、すばやく確認できます。',
    startTitle: 'はじめに',
    newWorkspace: '新しいワークスペースを作成',
    openFolder: 'ローカルフォルダーを開く',
    connectRemote: 'SMB / FTP / SFTP に接続',
    shortcutsTitle: 'ショートカット',
    shortcutCommand: 'コマンドパレット',
    shortcutSidebar: 'サイドバーの表示切替',
    shortcutSettings: '設定を開く',
    comingSoon: 'この機能は今後のマイルストーンで実装されます'
  },
  errors: {
    UNKNOWN: '予期しないエラーが発生しました',
    IPC_FORBIDDEN: '許可されていない呼び出しです',
    IPC_BAD_INPUT: '入力内容が正しくありません',
    IPC_UNKNOWN_CHANNEL: '不明な操作です',
    SETTINGS_INVALID: '設定値が正しくありません',
    WORKSPACE_NOT_FOUND: 'ワークスペースが見つかりません',
    WORKSPACE_DEFAULT_PROTECTED: 'デフォルトのワークスペースは削除できません',
    WORKSPACE_NAME_REQUIRED: '名前を入力してください',
    ENTRY_NOT_FOUND: '項目が見つかりません',
    ENTRY_INVALID_PARENT: 'この場所には移動・追加できません（親にできるのはグループだけです）',
    ENTRY_KIND_MISMATCH: 'フォルダーとファイルの種類が一致しません',
    FS_NOT_FOUND: 'ファイルまたはフォルダーが見つかりません',
    FS_PERMISSION_DENIED: 'アクセス権がありません',
    FS_NOT_A_DIRECTORY: 'フォルダーではありません',
    FS_INVALID_URI: 'パスの形式が正しくありません',
    FS_UNSUPPORTED_SCHEME: 'この種類の場所には対応していません',
    FS_CANCELLED: '操作をキャンセルしました',
    FS_TIMEOUT: '応答がないため中断しました',
    FS_UNAVAILABLE: '場所にアクセスできません'
  }
}
