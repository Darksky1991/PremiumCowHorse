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
    themeColors: 'カラーテーマ',
    themeDefault: '標準',
    themeAitetsu: '藍鉄',
    themeWashi: '和紙',
    themeMatsuba: '松葉',
    reduceMotion: '動きを減らす',
    reduceMotionOn: 'オン',
    reduceMotionOff: 'オフ',
    accentThemeDefault: 'テーマの既定',
    ready: '準備完了',
    messages: '通知 {{count}} 件',
    messagesRestore: '未確認の通知を表示',
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
    title: 'エクスプローラー',
    refresh: '最新の情報に更新',
    collapseAll: 'すべて折りたたむ',
    locate: '現在の項目を表示',
    loading: '読み込み中…',
    empty: '項目はありません',
    retry: '再試行',
    newGroup: 'グループを新規作成',
    newGroupDefaultName: '新しいグループ',
    newGroupTitle: 'グループを新規作成',
    groupName: 'グループ名',
    create: '作成',
    rename: '名前の変更',
    renameTitle: '名前の変更',
    renameDescription:
      'ワークスペース内での表示名だけを変更します。ディスク上の名前は変わりません。',
    name: '名前',
    nameRequired: '名前を入力してください',
    save: '変更',
    remove: 'ワークスペースから外す',
    removeTitle: '「{{name}}」をワークスペースから外しますか？',
    removeDescription:
      'ワークスペースの項目だけを外します。ディスク上のファイルやフォルダーは削除されません。',
    removeGroupDescription:
      'このグループとその中の項目をすべてワークスペースから外します。ディスク上のファイルやフォルダーは削除されません。',
    openInNewTab: '新しいタブで開く',
    reveal: 'エクスプローラーで表示',
    cacheStrategy: 'キャッシュ方針',
    cacheStrategyFollowGlobal: '全体設定に従う（{{strategy}}）',
    levelAll: 'すべて',
    levelActive: '積極',
    levelDefault: '標準',
    levelPassive: '控えめ',
    buildIndex: 'インデックスを作成',
    lastUpdated: '最終更新：{{time}}',
    disconnected: '切断',
    copyPath: 'パスをコピー',
    copyUri: 'URI をコピー',
    pinToRoot: 'ワークスペースのルートに固定',
    menuAddFolder: 'フォルダーを追加…',
    menuAddFile: 'ファイルを追加…',
    copiedPath: 'パスをコピーしました',
    copiedUri: 'URI をコピーしました',
    cancel: 'キャンセル',
    revealNotInWorkspace: 'この項目は現在のワークスペースのどの項目にも含まれていません',
    revealNotFound:
      'ツリーに見つかりません。フォルダーの内容が変わった可能性があります（F5 で最新の情報に更新）',
    revealTimeout: 'フォルダーの読み込みに時間がかかっているため、途中まで展開しました',
    addRemoteFolder: 'リモートフォルダーを追加',
    menuAddRemoteFolder: 'リモートフォルダーを追加…',
    remoteFolder: 'リモートフォルダー',
    addRemoteTitle: 'リモートフォルダーを追加',
    addRemoteDescription:
      'SFTP サーバー上のフォルダーを読み取り専用の項目として追加します。サーバー上のファイルは変更しません。',
    remoteConnection: '接続',
    remoteNoConnections: 'リモート接続がありません。「接続の管理」から登録してください。',
    manageConnections: '接続の管理',
    remoteIdentity: '読み取るユーザー',
    remoteLoginUser: 'ログインユーザー（{{name}}）',
    remoteIdentityHint: '切り替えユーザーは sudo で読み取ります。既定のパスは / です。',
    remotePath: 'パス',
    remotePathInvalid: '/ で始まる絶対パスを入力してください（. や .. は使えません）',
    remoteHomeLoading: 'ホームフォルダーを取得しています…',
    add: '追加',
    addAsOwner: '{{owner}} として項目に追加',
    addedAsOwner: '「{{label}}」を {{owner}} として追加しました'
  },
  search: {
    title: '検索',
    placeholder: 'ファイル名を検索',
    inputLabel: 'ファイル名',
    clear: 'クリア',
    kindLabel: '種類',
    kindAll: 'すべて',
    kindFile: 'ファイル',
    kindDirectory: 'フォルダー',
    resultsLabel: '検索結果',
    scopeHint:
      '現在のワークスペースのキャッシュをファイル名で検索します。検索できる範囲は、各項目のキャッシュ方針と「インデックスを作成」によって決まります。',
    wildcardHint: 'スペース区切りで AND 検索、* と ? でワイルドカード',
    noResults: '見つかりませんでした',
    count: '{{total}} 件',
    basedOnCache: 'キャッシュから検索（最終更新：{{time}}）',
    justNow: 'たった今',
    incomplete: 'まだスキャンされていないフォルダーがあります',
    truncated: '先頭の {{limit}} 件だけを表示しています。キーワードを追加して絞り込んでください',
    unavailableTitle: '検索を利用できません',
    revealInTree: 'ツリーで表示'
  },
  workspace: {
    switcherLabel: 'ワークスペースの切り替え',
    listLabel: 'ワークスペース',
    newItem: '新しいワークスペース…',
    renameItem: '現在のワークスペースの名前を変更…',
    restoreName: '既定の名前に戻す',
    deleteItem: '現在のワークスペースを削除…',
    name: 'ワークスペース名',
    nameRequired: '名前を入力してください',
    cancel: 'キャンセル',
    createTitle: '新しいワークスペース',
    createDescription: '案件などの単位でファイルをまとめるワークスペースを作成します。',
    create: '作成',
    renameTitle: 'ワークスペースの名前を変更',
    renameDescription: 'ワークスペースの表示名だけを変更します。',
    save: '変更',
    deleteTitle: '「{{name}}」を削除しますか？',
    deleteDescription:
      'ワークスペースとその項目だけを削除します。ディスク上のファイルやフォルダーは削除されません。',
    delete: '削除',
    createdNotActivated: '作成しましたが、切り替えに失敗しました',
    manage: 'ワークスペースの管理…',
    listPage: 'ワークスペース一覧',
    current: '使用中',
    lastOpened: '最終使用: {{time}}',
    renameMenu: '名前の変更…',
    deleteMenu: '削除…'
  },
  desktop: {
    title: 'デスクトップ記録',
    listLabel: 'デスクトップ記録の一覧',
    saveNow: '今すぐ保存',
    current: '現在',
    kind: {
      auto: '自動保存',
      manual: '手動保存',
      exit: '終了時に保存',
      exitNone: '保存せずに終了'
    },
    beforeRestart: '再起動前',
    itemCount: '{{count}} 件',
    renameMenu: '名前の変更…',
    deleteMenu: '削除…',
    renameTitle: '記録の名前を変更',
    renameDescription: '空にすると、種類名の表示に戻ります。',
    nameLabel: '名前',
    cancel: 'キャンセル',
    renameSubmit: '変更',
    deleteTitle: 'この記録を削除しますか？',
    deleteDescription:
      '記録だけを削除します。いま開いているファイルやフォルダー、ディスク上のファイルには影響しません。',
    deleteSubmit: '削除',
    noSnapshots: '記録はまだありません',
    snapshotGone: 'この記録はもうありません。削除された可能性があります',
    saved: 'デスクトップを保存しました（{{count}} 件）',
    nothingToSave: '保存できる項目がありません',
    category: {
      explorer: 'エクスプローラー',
      word: 'Word',
      excel: 'Excel',
      powerpoint: 'PowerPoint',
      vscode: 'VS Code',
      eclipse: 'Eclipse'
    },
    groupSelected: '{{selected}} / {{total}} 選択中',
    checklistLabel: '項目の一覧',
    specialLocation: '特殊な場所',
    tabCount: '（{{count}} 個のタブ）',
    readOnly: '読み取り専用',
    selectedCount: '{{selected}} / {{total}} 件を選択中',
    unreadable: '読み取れません：{{names}}',
    sharePointNote: 'SharePoint / OneDrive 上のファイルは記録されません',
    emptyCurrent: '現在開いている項目はありません',
    emptySnapshot: 'この記録には項目がありません',
    restoreSelected: '選択した項目を復元',
    saveSelected: '保存',
    restoreTitle: '前回のデスクトップを復元しますか？',
    restoreDescription: '再起動前に開いていた項目です。復元する項目を選んでください。',
    restoreSubmit: '復元',
    restoreLater: '後で',
    explorerWindow: '同じウィンドウ・{{count}} 個のタブ',
    clearTitle: '保存済みのスナップショットを削除しますか？',
    clearDescription:
      '復元が終わりました。保存済みのスナップショット {{count}} 件をすべて削除し、現在のデスクトップを記録し直します。',
    clearFailedNote:
      '復元できなかった項目があります（接続できない / 起動に失敗）。スナップショットを残すと後でやり直せます。',
    clearKeep: '残す',
    clearConfirm: '削除',
    exitTitle: '終了前にデスクトップを保存しますか？',
    exitDescription: '保存する項目を選んでください。次回の起動時に復元できます。',
    exitNoItems: '現在開いている項目はありません',
    exitLoading: '開いている項目を読み込んでいます…',
    exitSave: '保存して終了',
    exitNoSave: '保存しないで終了',
    dontAskAgain: '次回から確認しない',
    askOnExit: '終了時に確認する',
    moreActions: 'その他の操作',
    restored: '{{count}} 件を復元しました',
    restoredNone: '復元した項目はありません',
    skipped: 'スキップ：{{details}}',
    skipReason: {
      open: 'すでに開いている {{count}} 件',
      missing: '見つからない {{count}} 件',
      unreachable: '接続できない {{count}} 件',
      failed: '起動に失敗した {{count}} 件'
    }
  },
  connections: {
    title: 'リモート接続',
    listLabel: 'リモート接続の一覧',
    add: '新規接続',
    emptyTitle: 'リモート接続はまだありません',
    emptyHint: 'SFTP サーバーを登録すると、どのワークスペースからでも参照できます。',
    status: {
      online: 'オンライン',
      idle: '未接続',
      connecting: '接続中',
      offline: 'オフライン',
      authFailed: '認証失敗',
      sudoAuthFailed: 'sudo 認証失敗',
      hostKeyPending: 'ホストキーの確認待ち',
      hostKeyChanged: 'ホストキー変更'
    },
    identitiesLine: '切り替えユーザー: {{list}}',
    test: 'テスト',
    edit: '編集',
    delete: '削除',
    reconnect: '再接続',
    trustNewKey: '新しいキーを信頼',
    newTitle: '新規接続',
    editTitle: '接続の編集',
    dialogDescription:
      'SFTP（SSH）で読み取り専用で接続します。パスワードは暗号化してこの PC に保存されます。',
    name: '名前',
    namePlaceholder: '例: 顧客A 本番 AP1',
    host: 'ホスト',
    port: 'ポート',
    username: 'ユーザー名',
    auth: '認証方式',
    authPassword: 'パスワード認証',
    authKey: '秘密鍵認証',
    password: 'パスワード',
    secretSaved: '保存済み（変更しない）',
    keyPath: '秘密鍵ファイル',
    browse: '参照…',
    keyHint: 'OpenSSH / PEM 形式と PuTTY の PPK v2（RSA / DSA）に対応しています。',
    passphrase: 'パスフレーズ',
    passphraseNone: 'なし',
    identities: '切り替えユーザー',
    identitiesHint: 'sudo で切り替えて読み取るユーザー（例: app1、root）。Enter で追加します。',
    identityPlaceholder: 'ユーザー名を入力',
    removeIdentity: '{{name}} を削除',
    sudo: 'sudo パスワード',
    sudoSame: 'ログインパスワードと同じ',
    sudoNone: 'sudo パスワードを使わない（NOPASSWD）',
    sudoSeparate: '別に設定する',
    sudoHint:
      'root のパスワードを求められる環境（SUSE の targetpw など）では別に設定してください。',
    sftpServer: 'sftp-server のパス',
    sftpAuto: '自動検出',
    sftpCustom: '指定する',
    hostKey: '信頼済みのホストキー',
    hostKeyNone: 'まだありません（初回接続時に確認します）',
    hostKeyPresented: 'サーバーが提示した新しいキー',
    cancel: 'キャンセル',
    save: '保存',
    formError: {
      nameRequired: '名前を入力してください',
      hostRequired: 'ホストを入力してください',
      portInvalid: '1〜65535 の数値を入力してください',
      usernameRequired: 'ユーザー名を入力してください',
      usernameInvalid: '使えるのは英小文字・数字・_ . - です（先頭は英小文字か _、32 文字まで）',
      passwordRequired: 'パスワードを入力してください',
      keyPathRequired: '秘密鍵ファイルを選んでください',
      sudoPasswordRequired: 'sudo パスワードを入力してください',
      sftpServerPathInvalid: '/ で始まる絶対パスを入力してください（英数字と . _ / + - のみ）',
      identityInvalid: '使えるのは英小文字・数字・_ . - です（先頭は英小文字か _、32 文字まで）',
      identityDuplicate: 'すでに追加されています',
      identityTooMany: '登録できるのは 20 ユーザーまでです'
    },
    testResult: 'テスト結果',
    testing: 'テスト中…',
    closeResult: 'テスト結果を閉じる',
    step: {
      connect: '接続',
      hostKey: 'ホストキー',
      auth: '認証',
      sftp: 'SFTP',
      identity: '{{identity}} に切り替え'
    },
    stepOk: '成功',
    stepFailed: '失敗',
    stepSkipped: '未実施',
    homeInfo: 'ホーム: {{path}}',
    identityInfo: 'sftp-server: {{path}}（{{mode}}）',
    modeNopty: '端末なし',
    modePty: '端末あり',
    deleteTitle: 'この接続を削除しますか？',
    deleteCounting: 'この接続を使っている項目を確認しています…',
    deleteNoRefs: 'この接続を使っているワークスペースの項目はありません。',
    deleteRefs:
      'この接続を使っているワークスペースの項目: {{count}} 件。項目は残り、「接続が見つかりません」と表示されます。',
    deleteCountFailed: 'この接続を使っている項目の数を確認できませんでした。',
    deleteSubmit: '削除',
    trustTitle: '新しいホストキーを信頼しますか？',
    trustDescription:
      'サーバーのホストキーが以前と異なります。サーバーの再構築などで変わったことを確認できた場合だけ信頼してください。',
    oldKey: '以前のキー',
    newKey: '新しいキー',
    trustSubmit: '信頼する',
    trustKeyStale:
      'サーバーが提示しているキーが、表示していたものから変わりました。新しいキーを確認してから信頼してください。',
    promptTitle: 'このサーバーを信頼しますか？',
    promptDescription:
      '「{{name}}」（{{address}}）に初めて接続します。フィンガープリントが正しいことを管理者に確認してから信頼してください。',
    algorithm: 'アルゴリズム',
    fingerprint: 'フィンガープリント',
    promptAccept: '信頼して接続',
    promptMore: 'このあと {{count}} 件の確認があります'
  },
  welcome: {
    title: 'ようこそ',
    subtitle: '案件ごとにファイルをまとめて、すばやく確認できます。',
    startTitle: 'はじめに',
    newWorkspace: '新しいワークスペースを作成',
    openFolder: 'ローカルフォルダーを開く',
    connectRemote: 'SFTP サーバーに接続',
    shortcutsTitle: 'ショートカット',
    shortcutCommand: 'コマンドパレット',
    shortcutSidebar: 'サイドバーの表示切替',
    shortcutSettings: '設定を開く',
    comingSoon: 'この機能は今後のマイルストーンで実装されます'
  },
  addressBar: {
    label: 'アドレスバー',
    back: '戻る',
    forward: '進む',
    up: '1 つ上へ',
    refresh: '最新の情報に更新',
    viewer: '表示',
    alwaysOpenWith: '.{{ext}} は常にこれで開く',
    copyHint: 'クリックでパスをコピー'
  },
  about: {
    title: 'このアプリについて',
    version: 'バージョン',
    electron: 'Electron',
    chromium: 'Chromium',
    node: 'Node.js',
    platform: 'プラットフォーム',
    dataDir: 'データフォルダー',
    logsDir: 'ログフォルダー',
    openLogs: 'ログフォルダーを開く',
    openData: 'データフォルダーを開く',
    copyDiagnostics: '診断情報をコピー',
    copied: '診断情報をコピーしました',
    openFailed: 'フォルダーを開けませんでした',
    copyFailed: '診断情報をコピーできませんでした'
  },
  settings: {
    title: '設定',
    searchPlaceholder: '設定を検索…',
    searchLabel: '設定を検索',
    noResults: '一致する設定がありません',
    navLabel: '設定の分類',
    sections: {
      general: '一般',
      appearance: '外観',
      workspace: 'ワークスペース',
      explorer: 'エクスプローラー',
      preview: 'プレビュー',
      cache: 'キャッシュとスキャン',
      remote: 'リモート接続',
      desktop: 'デスクトップ記録',
      privacy: 'プライバシー'
    },
    about: 'このアプリについて',
    reset: '既定に戻す',
    unit: {
      sec: '秒',
      ms: 'ミリ秒',
      min: '分',
      mb: 'MB'
    },
    error: {
      required: '値を入力してください',
      invalid: '正しい値を入力してください',
      integer: '整数を入力してください',
      range: '{{min}}〜{{max}} の範囲で入力してください',
      min: '{{min}} 以上で入力してください'
    },
    keepaliveNote: '新しい接続から有効',
    associations: {
      title: 'ファイルの関連付け',
      desc: '拡張子ごとの「常にこれで開く」の設定です。',
      empty: '関連付けはありません',
      remove: '{{ext}} の関連付けを削除'
    },
    cache: {
      usage: 'キャッシュの使用量',
      usageLoading: '確認中…',
      usageUnavailable: '取得できません',
      clear: 'キャッシュを消去',
      confirmTitle: 'キャッシュを消去しますか？',
      confirmDesc:
        'フォルダー一覧のキャッシュとインデックスを消去します。ディスク上のファイルは変更されません。次回の表示時に作り直されます。',
      confirm: '消去',
      cancel: 'キャンセル',
      cleared: 'キャッシュを消去しました',
      clearFailed: 'キャッシュを消去できませんでした'
    },
    privacy: {
      recentTitle: '最近使った項目',
      recentDesc: '最近開いた項目の履歴を消去します。',
      clearRecent: '最近使用を消去',
      confirmTitle: '最近使った項目を消去しますか？',
      confirmDesc:
        'すべてのワークスペースの履歴を消去します。ディスク上のファイルは変更されません。',
      confirm: '消去',
      cancel: 'キャンセル',
      cleared: '最近使った項目を消去しました',
      clearFailed: '最近使った項目を消去できませんでした'
    },
    options: {
      language: {
        system: 'システムに従う',
        ja: '日本語',
        'zh-CN': '简体中文',
        en: 'English'
      },
      themeMode: {
        system: 'システムに従う',
        light: 'ライト',
        dark: 'ダーク'
      },
      theme: {
        default: '標準',
        aitetsu: '藍鉄',
        washi: '和紙',
        matsuba: '松葉'
      },
      accent: {
        neutral: 'テーマの既定',
        blue: 'ブルー',
        green: 'グリーン',
        violet: 'バイオレット',
        orange: 'オレンジ'
      },
      density: {
        comfortable: '標準',
        compact: 'コンパクト'
      },
      reduceMotion: {
        system: 'システムに従う',
        on: 'オン',
        off: 'オフ'
      },
      pickerStyle: {
        carousel: 'リング',
        menu: 'メニュー'
      },
      strategy: {
        passive: '控えめ',
        default: '標準',
        active: '積極',
        all: 'すべて'
      }
    },
    item: {
      general_language: {
        name: '言語',
        desc: '画面表示に使う言語です。'
      },
      appearance_theme: {
        name: 'カラーテーマ',
        desc: '画面全体の配色です。'
      },
      appearance_themeMode: {
        name: '明暗',
        desc: 'ライト / ダークの切り替えです。'
      },
      appearance_accent: {
        name: 'アクセントカラー',
        desc: 'ボタンや選択状態の強調色です。'
      },
      appearance_density: {
        name: '表示密度',
        desc: '一覧や余白の詰め具合です。'
      },
      appearance_reduceMotion: {
        name: '動きを減らす',
        desc: 'アニメーションを控えめにします。「システムに従う」では OS の設定に合わせます。'
      },
      workspace_pickerStyle: {
        name: 'ワークスペース選択の形式',
        desc: 'ワークスペースを切り替えるときの表示形式です。'
      },
      workspace_pickerDetail: {
        name: '詳細情報を既定で表示',
        desc: 'ワークスペース選択のカードに詳細情報を表示します。'
      },
      explorer_showHiddenFiles: {
        name: '隠しファイルを表示',
        desc: '隠し属性のファイルとフォルダーを一覧に表示します。'
      },
      explorer_singleClickPreview: {
        name: 'クリックですぐに開く',
        desc: '項目を 1 回クリック（または矢印キーで移動）するとプレビューを開きます。オフにするとダブルクリックまたは Enter で開きます。'
      },
      preview_maxTextSizeMB: {
        name: 'テキストプレビューの上限サイズ',
        desc: 'これより大きいテキストファイルは、そのままでは開きません。'
      },
      cache_strategy_local: {
        name: 'キャッシュ方針（ローカル）',
        desc: 'ローカルのフォルダーに対する既定のキャッシュ方針です。項目ごとに変更できます。'
      },
      cache_strategy_network: {
        name: 'キャッシュ方針（ネットワーク）',
        desc: 'ネットワーク上のフォルダーに対する既定のキャッシュ方針です。項目ごとに変更できます。'
      },
      cache_activeDepth: {
        name: '「積極」で先読みする階層数',
        desc: '「積極」方針で、注目している場所の上下に何階層ぶん先読みするかです。'
      },
      cache_interval_focus_local: {
        name: '確認間隔：注目中（ローカル）',
        desc: '注目している場所を定期的に確認する間隔です。'
      },
      cache_interval_near_local: {
        name: '確認間隔：近く（ローカル）',
        desc: '注目している場所の近くを定期的に確認する間隔です。'
      },
      cache_interval_far_local: {
        name: '確認間隔：遠く（ローカル）',
        desc: '注目している場所から遠い場所を定期的に確認する間隔です。'
      },
      cache_interval_focus_network: {
        name: '確認間隔：注目中（ネットワーク）',
        desc: '注目している場所を定期的に確認する間隔です。'
      },
      cache_interval_near_network: {
        name: '確認間隔：近く（ネットワーク）',
        desc: '注目している場所の近くを定期的に確認する間隔です。'
      },
      cache_interval_far_network: {
        name: '確認間隔：遠く（ネットワーク）',
        desc: '注目している場所から遠い場所を定期的に確認する間隔です。'
      },
      cache_backgroundGapMs_local: {
        name: 'バックグラウンド処理の休止（ローカル）',
        desc: 'バックグラウンドでキャッシュを作るとき、1 フォルダーごとに置く休止時間です。'
      },
      cache_backgroundGapMs_network: {
        name: 'バックグラウンド処理の休止（ネットワーク）',
        desc: 'バックグラウンドでキャッシュを作るとき、1 フォルダーごとに置く休止時間です。'
      },
      vfs_timeoutSec_local: {
        name: 'タイムアウト（ローカル）',
        desc: '応答がないまま待つ時間の上限です。'
      },
      vfs_timeoutSec_network: {
        name: 'タイムアウト（ネットワーク）',
        desc: '応答がないまま待つ時間の上限です。'
      },
      remote_keepaliveSec: {
        name: 'キープアライブ間隔',
        desc: '接続を保つために応答を確認する間隔です。3 回続けて応答がないと切断とみなします。'
      },
      remote_idleDisconnectMin: {
        name: '無操作での自動切断',
        desc: 'リクエストがないまま、この時間が過ぎると接続を切ります。'
      },
      vfs_timeoutSec_remote: {
        name: 'タイムアウト（リモート）',
        desc: 'リモートのファイル操作で応答を待つ時間の上限です。'
      },
      cache_backgroundGapMs_remote: {
        name: 'バックグラウンド処理の休止（リモート）',
        desc: 'リモートでバックグラウンドのキャッシュを作るとき、1 フォルダーごとに置く休止時間です。'
      },
      cache_remoteIndexIntervalMin: {
        name: 'インデックス更新間隔（リモート）',
        desc: 'リモートのフォルダーのインデックスを作り直す間隔です。'
      },
      desktop_askOnExit: {
        name: '終了時に保存を確認',
        desc: 'アプリを終了するとき、どのデスクトップ項目を保存するか確認します。オフにするとすべて保存します。'
      }
    }
  },
  commands: {
    group: {
      general: '一般',
      view: '表示',
      navigation: '移動',
      workspace: 'ワークスペース',
      appearance: '外観'
    },
    paletteOpen: 'コマンドパレットを開く',
    settingsOpen: '設定を開く',
    aboutOpen: 'このアプリについてを開く',
    workspacePick: 'ワークスペースを選ぶ',
    tabClose: 'タブを閉じる',
    navBack: '戻る',
    navForward: '進む',
    navUp: '一つ上へ',
    navRefresh: '更新',
    viewSearch: '検索を開く',
    viewToggleSidebar: 'サイドバーの表示を切り替え'
  },
  tabs: {
    label: '開いているタブ',
    close: '閉じる'
  },
  preview: {
    loading: '読み込み中…',
    errorTitle: 'このプレビューを表示できません',
    errorHint: 'プレビュー（{{plugin}}）でエラーが発生しました。ほかのタブには影響しません。',
    showInfo: 'ファイル情報で表示',
    retry: '再試行',
    copiedPath: 'パスをコピーしました',
    offline: 'この場所は切断されています。再接続すると表示されます。',
    confirmTitle: '「{{name}}」を開きますか？',
    confirmDescription:
      'このファイルはプログラムやスクリプトとして実行され、PC の設定を変更する可能性があります。信頼できるファイルの場合だけ開いてください。',
    confirmOpen: '開く',
    cancel: 'キャンセル',
    overviewEmpty: 'このワークスペースにはまだ項目がありません。'
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
    ENTRY_TEMPORARY_PATH:
      '一時ファイル（圧縮ファイル内のファイルなど）は追加できません。先に展開してください。',
    FS_NOT_FOUND: 'ファイルまたはフォルダーが見つかりません',
    FS_PERMISSION_DENIED: 'アクセス権がありません',
    FS_NOT_A_DIRECTORY: 'フォルダーではありません',
    FS_INVALID_URI: 'パスの形式が正しくありません',
    FS_UNSUPPORTED_SCHEME: 'この種類の場所には対応していません',
    FS_CANCELLED: '操作をキャンセルしました',
    FS_TIMEOUT: '応答がないため中断しました',
    FS_UNAVAILABLE: '場所にアクセスできません',
    INDEX_UNAVAILABLE: 'インデックスを利用できません',
    DOC_NOT_FOUND: 'ドキュメントが閉じられています。もう一度開いてください',
    LAUNCH_FAILED: '起動できませんでした。関連付けられたアプリを確認してください',
    DESKTOP_SNAPSHOT_NOT_FOUND: 'デスクトップの記録が見つかりません。削除された可能性があります',
    CONN_NOT_FOUND: '接続が見つかりません（削除された可能性があります）',
    CONN_AUTH_FAILED:
      '認証に失敗しました。ユーザー名・パスワード・鍵を確認してください（自動では再試行しません）',
    CONN_KEY_INVALID:
      '秘密鍵を読み込めません。対応形式は OpenSSH / PEM と PuTTY の PPK v2（RSA / DSA）です。パスフレーズも確認してください',
    CONN_HOST_KEY_REJECTED: 'サーバーのホストキーを信頼しなかったため、接続しませんでした',
    CONN_HOST_KEY_CHANGED:
      'サーバーのホストキーが信頼済みのものと異なるため、接続を拒否しました。確認のうえ「リモート接続」で新しいキーを信頼してください',
    CONN_SUDO_AUTH_FAILED: 'sudo のパスワードが正しくありません（自動では再試行しません）',
    CONN_SUDO_DENIED: 'sudo でこのユーザーに切り替える権限がありません',
    CONN_SUDO_FAILED:
      'ユーザーの切り替えに失敗しました（タイムアウトまたはチャネルが閉じられました）',
    CONN_SFTP_SERVER_NOT_FOUND:
      'サーバー上に sftp-server が見つかりません。接続の設定でパスを指定してください',
    CONN_PROCESS_LIST_HIDDEN:
      'サーバーが他のユーザーのプロセスを隠しているため、安全にユーザーを切り替えられません',
    CONN_SECRET_UNAVAILABLE:
      '保存されたパスワードを復号できません。接続の設定で入力し直してください'
  }
}
