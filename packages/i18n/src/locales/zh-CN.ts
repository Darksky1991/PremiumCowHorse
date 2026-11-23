import type { Resource } from '../types'

export default {
  common: {
    appName: 'PremiumCowHorse',
    workspace: '工作区',
    defaultWorkspace: '默认',
    search: '搜索文件或命令…',
    explorer: '资源管理器',
    connections: '远程连接',
    settings: '设置',
    language: '语言',
    theme: '主题',
    themeLight: '浅色',
    themeDark: '深色',
    followSystem: '跟随系统',
    themeColors: '配色主题',
    themeDefault: '默认',
    themeAitetsu: '蓝铁',
    themeWashi: '和纸',
    themeMatsuba: '松针',
    reduceMotion: '减少动效',
    reduceMotionOn: '开',
    reduceMotionOff: '关',
    accentThemeDefault: '主题默认',
    ready: '就绪',
    messages: '通知 {{count}} 条',
    messagesRestore: '显示未确认的通知',
    crashTitle: '界面显示时出现问题',
    crashHint: '如果重新加载后仍无法解决，请附上日志文件（main.log）联系负责人。',
    reload: '重新加载',
    minimize: '最小化',
    maximize: '最大化',
    restore: '还原',
    close: '关闭'
  },
  explorer: {
    emptyTitle: '工作区为空',
    emptyHint: '把文件夹或文件拖到这里，或通过下方按钮添加。',
    addFolder: '添加文件夹',
    title: '资源管理器',
    refresh: '刷新',
    collapseAll: '全部折叠',
    locate: '定位到当前项',
    loading: '正在加载…',
    empty: '没有项目',
    retry: '重试',
    newGroup: '新建分组',
    newGroupDefaultName: '新建分组',
    newGroupTitle: '新建分组',
    groupName: '分组名称',
    create: '创建',
    rename: '重命名',
    renameTitle: '重命名',
    renameDescription: '只修改在工作区中的显示名称，不会改动磁盘上的名称。',
    name: '名称',
    nameRequired: '请输入名称',
    save: '重命名',
    remove: '从工作区移除',
    removeTitle: '从工作区移除「{{name}}」？',
    removeDescription: '只会移除工作区中的条目，不会删除磁盘上的文件或文件夹。',
    removeGroupDescription: '将移除该分组及其下的所有条目，不会删除磁盘上的文件或文件夹。',
    openInNewTab: '在新标签页中打开',
    reveal: '在资源管理器中显示',
    cacheStrategy: '缓存策略',
    cacheStrategyFollowGlobal: '跟随全局（{{strategy}}）',
    levelAll: '全部',
    levelActive: '积极',
    levelDefault: '默认',
    levelPassive: '消极',
    buildIndex: '建立索引',
    lastUpdated: '最后更新：{{time}}',
    disconnected: '已断开',
    copyPath: '复制路径',
    copyUri: '复制 URI',
    pinToRoot: '固定到工作区根部',
    menuAddFolder: '添加文件夹…',
    menuAddFile: '添加文件…',
    copiedPath: '已复制路径',
    copiedUri: '已复制 URI',
    cancel: '取消',
    revealNotInWorkspace: '该项目不在当前工作区的条目中',
    revealNotFound: '在资源树中找不到该项目，目录内容可能已变化（按 F5 刷新）',
    revealTimeout: '目录加载时间过长，已展开到能到达的最深一层',
    addRemoteFolder: '添加远程文件夹',
    menuAddRemoteFolder: '添加远程文件夹…',
    remoteFolder: '远程文件夹',
    addRemoteTitle: '添加远程文件夹',
    addRemoteDescription: '把 SFTP 服务器上的文件夹添加为只读条目。不会修改服务器上的文件。',
    remoteConnection: '连接',
    remoteNoConnections: '还没有远程连接。请在「管理连接」中添加。',
    manageConnections: '管理连接',
    remoteIdentity: '读取身份',
    remoteLoginUser: '登录用户（{{name}}）',
    remoteIdentityHint: '切换身份经 sudo 读取；默认路径为 /。',
    remotePath: '路径',
    remotePathInvalid: '请输入以 / 开头的绝对路径（不能含 . 或 ..）',
    remoteHomeLoading: '正在获取主目录…',
    add: '添加',
    addAsOwner: '以 {{owner}} 身份添加为条目',
    addedAsOwner: '已以 {{owner}} 身份添加「{{label}}」'
  },
  search: {
    title: '搜索',
    placeholder: '搜索文件名',
    inputLabel: '文件名',
    clear: '清除',
    kindLabel: '类型',
    kindAll: '全部',
    kindFile: '文件',
    kindDirectory: '文件夹',
    resultsLabel: '搜索结果',
    scopeHint: '在当前工作区的缓存中按文件名搜索。范围取决于各条目的缓存策略与「建立索引」。',
    wildcardHint: '空格分隔表示同时包含，* 和 ? 为通配符',
    noResults: '没有找到',
    count: '{{total}} 项',
    basedOnCache: '基于缓存（{{time}}更新）',
    justNow: '刚刚',
    incomplete: '部分目录尚未扫描',
    truncated: '只显示前 {{limit}} 项，请输入更多关键词',
    unavailableTitle: '搜索不可用',
    revealInTree: '在树中定位'
  },
  workspace: {
    switcherLabel: '切换工作区',
    listLabel: '工作区',
    newItem: '新建工作区…',
    renameItem: '重命名当前工作区…',
    restoreName: '恢复默认名称',
    deleteItem: '删除当前工作区…',
    name: '工作区名称',
    nameRequired: '请输入名称',
    cancel: '取消',
    createTitle: '新建工作区',
    createDescription: '创建一个工作区，按案件等单位集中管理文件。',
    create: '创建',
    renameTitle: '重命名工作区',
    renameDescription: '只修改工作区的显示名称。',
    save: '保存',
    deleteTitle: '删除“{{name}}”？',
    deleteDescription: '只删除工作区及其条目，不会删除磁盘上的文件或文件夹。',
    delete: '删除',
    createdNotActivated: '已创建，但未能切换到该工作区',
    manage: '管理工作区…',
    listPage: '工作区一览',
    current: '当前',
    lastOpened: '上次使用：{{time}}',
    renameMenu: '重命名…',
    deleteMenu: '删除…'
  },
  desktop: {
    title: '桌面记录',
    listLabel: '桌面记录列表',
    saveNow: '立即保存',
    current: '当前',
    kind: {
      auto: '自动保存',
      manual: '手动保存',
      exit: '退出时保存',
      exitNone: '退出时未保存'
    },
    beforeRestart: '重启前',
    itemCount: '{{count}} 项',
    renameMenu: '重命名…',
    deleteMenu: '删除…',
    renameTitle: '重命名记录',
    renameDescription: '留空则恢复为按种类显示。',
    nameLabel: '名称',
    cancel: '取消',
    renameSubmit: '修改',
    deleteTitle: '删除这条记录？',
    deleteDescription: '只删除记录本身，不影响当前打开的文件和文件夹，也不影响磁盘上的文件。',
    deleteSubmit: '删除',
    noSnapshots: '还没有记录',
    snapshotGone: '这条记录已不存在，可能已被删除',
    saved: '已保存桌面（{{count}} 项）',
    nothingToSave: '没有可保存的项目',
    category: {
      explorer: '资源管理器',
      word: 'Word',
      excel: 'Excel',
      powerpoint: 'PowerPoint',
      vscode: 'VS Code',
      eclipse: 'Eclipse'
    },
    groupSelected: '已选 {{selected}} / {{total}}',
    checklistLabel: '项目列表',
    specialLocation: '特殊位置',
    tabCount: '（{{count}} 个标签）',
    readOnly: '只读',
    selectedCount: '已选 {{selected}} / {{total}} 项',
    unreadable: '无法读取：{{names}}',
    sharePointNote: 'SharePoint / OneDrive 上的文件不会被记录',
    emptyCurrent: '当前没有打开的项目',
    emptySnapshot: '这条记录中没有项目',
    restoreSelected: '恢复所选项目',
    saveSelected: '保存',
    restoreTitle: '要恢复上次的桌面吗？',
    restoreDescription: '这是重启前打开的项目，请选择要恢复的项目。',
    restoreSubmit: '恢复',
    restoreLater: '以后再说',
    explorerWindow: '同一窗口 · {{count}} 个标签',
    clearTitle: '删除已保存的快照吗？',
    clearDescription: '恢复已完成。将删除全部 {{count}} 个已保存的快照，并重新记录当前桌面。',
    clearFailedNote: '有项目未能恢复（连不上或启动失败）。保留快照可以稍后再试。',
    clearKeep: '保留',
    clearConfirm: '删除',
    exitTitle: '退出前要保存桌面吗？',
    exitDescription: '请选择要保存的项目，下次启动时可以恢复。',
    exitNoItems: '当前没有打开的项目',
    exitLoading: '正在读取打开的项目…',
    exitSave: '保存并退出',
    exitNoSave: '不保存并退出',
    dontAskAgain: '以后不再询问',
    askOnExit: '退出时询问',
    moreActions: '更多操作',
    restored: '已恢复 {{count}} 项',
    restoredNone: '没有恢复任何项目',
    skipped: '已跳过：{{details}}',
    skipReason: {
      open: '已打开 {{count}} 项',
      missing: '找不到 {{count}} 项',
      unreachable: '无法连接 {{count}} 项',
      failed: '启动失败 {{count}} 项'
    }
  },
  connections: {
    title: '远程连接',
    listLabel: '远程连接列表',
    add: '新建连接',
    emptyTitle: '还没有远程连接',
    emptyHint: '添加 SFTP 服务器后，任何工作区都可以引用。',
    status: {
      online: '在线',
      idle: '未连接',
      connecting: '正在连接',
      offline: '离线',
      authFailed: '认证失败',
      sudoAuthFailed: 'sudo 认证失败',
      hostKeyPending: '等待确认主机密钥',
      hostKeyChanged: '主机密钥已变化'
    },
    identitiesLine: '切换身份：{{list}}',
    test: '测试',
    edit: '编辑',
    delete: '删除',
    reconnect: '重新连接',
    trustNewKey: '信任新的密钥',
    newTitle: '新建连接',
    editTitle: '编辑连接',
    dialogDescription: '通过 SFTP（SSH）只读连接。密码加密后保存在本机。',
    name: '名称',
    namePlaceholder: '例：客户A 生产 AP1',
    host: '主机',
    port: '端口',
    username: '用户名',
    auth: '认证方式',
    authPassword: '密码认证',
    authKey: '私钥认证',
    password: '密码',
    secretSaved: '已保存（不变）',
    keyPath: '私钥文件',
    browse: '浏览…',
    keyHint: '支持 OpenSSH / PEM 格式以及 PuTTY 的 PPK v2（RSA / DSA）。',
    passphrase: '口令',
    passphraseNone: '无',
    identities: '切换身份',
    identitiesHint: '通过 sudo 切换后读取的用户（例：app1、root）。按回车添加。',
    identityPlaceholder: '输入用户名',
    removeIdentity: '删除 {{name}}',
    sudo: 'sudo 密码',
    sudoSame: '同登录密码',
    sudoNone: '不使用 sudo 密码（NOPASSWD）',
    sudoSeparate: '另外设置',
    sudoHint: '要求输入 root 密码的环境（如 SUSE 的 targetpw）请另外设置。',
    sftpServer: 'sftp-server 路径',
    sftpAuto: '自动探测',
    sftpCustom: '指定',
    hostKey: '已信任的主机密钥',
    hostKeyNone: '尚无（首次连接时确认）',
    hostKeyPresented: '服务器出示的新密钥',
    cancel: '取消',
    save: '保存',
    formError: {
      nameRequired: '请输入名称',
      hostRequired: '请输入主机',
      portInvalid: '请输入 1～65535 之间的数字',
      usernameRequired: '请输入用户名',
      usernameInvalid: '只能使用小写字母、数字和 _ . -（以小写字母或 _ 开头，最多 32 个字符）',
      passwordRequired: '请输入密码',
      keyPathRequired: '请选择私钥文件',
      sudoPasswordRequired: '请输入 sudo 密码',
      sftpServerPathInvalid: '请输入以 / 开头的绝对路径（只能包含字母、数字和 . _ / + -）',
      identityInvalid: '只能使用小写字母、数字和 _ . -（以小写字母或 _ 开头，最多 32 个字符）',
      identityDuplicate: '已经添加过了',
      identityTooMany: '最多登记 20 个用户'
    },
    testResult: '测试结果',
    testing: '正在测试…',
    closeResult: '关闭测试结果',
    step: {
      connect: '连接',
      hostKey: '主机密钥',
      auth: '认证',
      sftp: 'SFTP',
      identity: '切换到 {{identity}}'
    },
    stepOk: '成功',
    stepFailed: '失败',
    stepSkipped: '未执行',
    homeInfo: '主目录：{{path}}',
    identityInfo: 'sftp-server：{{path}}（{{mode}}）',
    modeNopty: '非终端',
    modePty: '终端',
    deleteTitle: '删除此连接？',
    deleteCounting: '正在确认使用此连接的条目…',
    deleteNoRefs: '没有工作区条目使用此连接。',
    deleteRefs: '使用此连接的工作区条目：{{count}} 个。条目会保留，并显示“连接不存在”。',
    deleteCountFailed: '无法确认使用此连接的条目数。',
    deleteSubmit: '删除',
    trustTitle: '信任新的主机密钥？',
    trustDescription: '服务器的主机密钥与之前不同。只有确认是服务器重建等原因造成的变化时才信任。',
    oldKey: '原来的密钥',
    newKey: '新的密钥',
    trustSubmit: '信任',
    trustKeyStale: '服务器出示的密钥与刚才显示的不同。请确认新的密钥后再信任。',
    promptTitle: '信任此服务器？',
    promptDescription: '首次连接“{{name}}”（{{address}}）。请先向管理员确认指纹无误，再选择信任。',
    algorithm: '算法',
    fingerprint: '指纹',
    promptAccept: '信任并连接',
    promptMore: '之后还有 {{count}} 个确认'
  },
  welcome: {
    title: '欢迎',
    subtitle: '按案件整理文件，随时快速查阅。',
    startTitle: '开始',
    newWorkspace: '新建工作区',
    openFolder: '打开本地文件夹',
    connectRemote: '连接 SFTP 服务器',
    shortcutsTitle: '快捷键',
    shortcutCommand: '命令面板',
    shortcutSidebar: '显示/隐藏侧栏',
    shortcutSettings: '打开设置',
    comingSoon: '该功能将在后续里程碑中实现'
  },
  addressBar: {
    label: '地址栏',
    back: '后退',
    forward: '前进',
    up: '上一级',
    refresh: '刷新',
    viewer: '查看方式',
    alwaysOpenWith: '.{{ext}} 总是用此查看器打开',
    copyHint: '单击复制路径'
  },
  about: {
    title: '关于本应用',
    version: '版本',
    electron: 'Electron',
    chromium: 'Chromium',
    node: 'Node.js',
    platform: '平台',
    dataDir: '数据文件夹',
    logsDir: '日志文件夹',
    openLogs: '打开日志文件夹',
    openData: '打开数据文件夹',
    copyDiagnostics: '复制诊断信息',
    copied: '已复制诊断信息',
    openFailed: '无法打开文件夹',
    copyFailed: '无法复制诊断信息'
  },
  settings: {
    title: '设置',
    searchPlaceholder: '搜索设置…',
    searchLabel: '搜索设置',
    noResults: '没有匹配的设置',
    navLabel: '设置分类',
    sections: {
      general: '常规',
      appearance: '外观',
      workspace: '工作区',
      explorer: '资源管理器',
      preview: '预览',
      cache: '缓存与扫描',
      remote: '远程连接',
      desktop: '桌面记录',
      privacy: '隐私'
    },
    about: '关于本应用',
    reset: '恢复默认',
    unit: {
      sec: '秒',
      ms: '毫秒',
      min: '分钟',
      mb: 'MB'
    },
    error: {
      required: '请输入数值',
      invalid: '请输入正确的值',
      integer: '请输入整数',
      range: '请输入 {{min}} 到 {{max}} 之间的值',
      min: '请输入不小于 {{min}} 的值'
    },
    keepaliveNote: '对新建立的连接生效',
    associations: {
      title: '文件关联',
      desc: '按扩展名保存的「总是用此方式打开」设置。',
      empty: '没有文件关联',
      remove: '删除 {{ext}} 的关联'
    },
    cache: {
      usage: '缓存占用',
      usageLoading: '正在确认…',
      usageUnavailable: '无法获取',
      clear: '清空缓存',
      confirmTitle: '清空缓存？',
      confirmDesc: '清除文件夹列表缓存与索引，不会改动磁盘上的文件。下次显示时会重新建立。',
      confirm: '清空',
      cancel: '取消',
      cleared: '已清空缓存',
      clearFailed: '无法清空缓存'
    },
    privacy: {
      recentTitle: '最近使用',
      recentDesc: '清除最近打开项目的历史记录。',
      clearRecent: '清除最近使用',
      soon: '将在后续里程碑中提供'
    },
    options: {
      language: {
        system: '跟随系统',
        ja: '日本語',
        'zh-CN': '简体中文',
        en: 'English'
      },
      themeMode: {
        system: '跟随系统',
        light: '浅色',
        dark: '深色'
      },
      theme: {
        default: '标准',
        aitetsu: '藍鉄',
        washi: '和紙',
        matsuba: '松葉'
      },
      accent: {
        neutral: '主题默认',
        blue: '蓝色',
        green: '绿色',
        violet: '紫色',
        orange: '橙色'
      },
      density: {
        comfortable: '标准',
        compact: '紧凑'
      },
      reduceMotion: {
        system: '跟随系统',
        on: '开',
        off: '关'
      },
      pickerStyle: {
        carousel: '环形',
        menu: '菜单'
      },
      strategy: {
        passive: '消极',
        default: '默认',
        active: '积极',
        all: '全部'
      }
    },
    item: {
      general_language: {
        name: '语言',
        desc: '界面显示使用的语言。'
      },
      appearance_theme: {
        name: '配色主题',
        desc: '整个界面的配色。'
      },
      appearance_themeMode: {
        name: '明暗',
        desc: '浅色 / 深色的切换。'
      },
      appearance_accent: {
        name: '强调色',
        desc: '按钮与选中状态的强调色。'
      },
      appearance_density: {
        name: '显示密度',
        desc: '列表与留白的紧凑程度。'
      },
      appearance_reduceMotion: {
        name: '减少动效',
        desc: '让动画更克制。「跟随系统」时遵循操作系统的设置。'
      },
      workspace_pickerStyle: {
        name: '工作区选择器的形式',
        desc: '切换工作区时的显示形式。'
      },
      workspace_pickerDetail: {
        name: '默认显示详细信息',
        desc: '在工作区选择器的卡片上显示详细信息。'
      },
      explorer_showHiddenFiles: {
        name: '显示隐藏文件',
        desc: '在列表中显示带隐藏属性的文件和文件夹。'
      },
      explorer_singleClickPreview: {
        name: '单击即打开',
        desc: '单击（或用方向键移动到）项目即打开预览。关闭后需双击或按 Enter 打开。'
      },
      preview_maxTextSizeMB: {
        name: '文本预览的大小上限',
        desc: '超过此大小的文本文件不会直接打开。'
      },
      cache_strategy_local: {
        name: '缓存策略（本地）',
        desc: '本地文件夹的默认缓存策略，条目可单独设置。'
      },
      cache_strategy_network: {
        name: '缓存策略（网络）',
        desc: '网络文件夹的默认缓存策略，条目可单独设置。'
      },
      cache_activeDepth: {
        name: '「积极」策略预读的层数',
        desc: '「积极」策略下，以关注点为中心上下预读的层数。'
      },
      cache_interval_focus_local: {
        name: '确认间隔：关注点（本地）',
        desc: '定期确认关注点的间隔。'
      },
      cache_interval_near_local: {
        name: '确认间隔：近处（本地）',
        desc: '定期确认关注点附近的间隔。'
      },
      cache_interval_far_local: {
        name: '确认间隔：远处（本地）',
        desc: '定期确认远离关注点之处的间隔。'
      },
      cache_interval_focus_network: {
        name: '确认间隔：关注点（网络）',
        desc: '定期确认关注点的间隔。'
      },
      cache_interval_near_network: {
        name: '确认间隔：近处（网络）',
        desc: '定期确认关注点附近的间隔。'
      },
      cache_interval_far_network: {
        name: '确认间隔：远处（网络）',
        desc: '定期确认远离关注点之处的间隔。'
      },
      cache_backgroundGapMs_local: {
        name: '后台处理的间隔（本地）',
        desc: '后台填充缓存时，每个文件夹完成后的休息时间。'
      },
      cache_backgroundGapMs_network: {
        name: '后台处理的间隔（网络）',
        desc: '后台填充缓存时，每个文件夹完成后的休息时间。'
      },
      vfs_timeoutSec_local: {
        name: '超时（本地）',
        desc: '无响应时等待的时间上限。'
      },
      vfs_timeoutSec_network: {
        name: '超时（网络）',
        desc: '无响应时等待的时间上限。'
      },
      remote_keepaliveSec: {
        name: '保活间隔',
        desc: '为保持连接而确认响应的间隔。连续 3 次无响应视为断线。'
      },
      remote_idleDisconnectMin: {
        name: '空闲自动断开',
        desc: '无请求超过此时间后自动断开连接。'
      },
      vfs_timeoutSec_remote: {
        name: '超时（远程）',
        desc: '远程文件操作等待响应的时间上限。'
      },
      cache_backgroundGapMs_remote: {
        name: '后台处理的间隔（远程）',
        desc: '远程后台填充缓存时，每个文件夹完成后的休息时间。'
      },
      cache_remoteIndexIntervalMin: {
        name: '索引更新间隔（远程）',
        desc: '重新建立远程文件夹索引的间隔。'
      },
      desktop_askOnExit: {
        name: '退出时询问保存',
        desc: '退出应用时询问保存哪些桌面项目。关闭后全部保存。'
      }
    }
  },
  tabs: {
    label: '已打开的标签',
    close: '关闭'
  },
  preview: {
    loading: '正在加载…',
    errorTitle: '无法显示此预览',
    errorHint: '预览（{{plugin}}）出错。其他标签不受影响。',
    showInfo: '以文件信息显示',
    retry: '重试',
    copiedPath: '已复制路径',
    offline: '该位置已断开，重新连接后显示。',
    confirmTitle: '要打开“{{name}}”吗？',
    confirmDescription: '该文件会作为程序或脚本运行，可能更改电脑的设置。请只在信任该文件时打开。',
    confirmOpen: '打开',
    cancel: '取消',
    overviewEmpty: '此工作区还没有条目。'
  },
  errors: {
    UNKNOWN: '发生了意外错误',
    IPC_FORBIDDEN: '不允许的调用',
    IPC_BAD_INPUT: '输入内容不正确',
    IPC_UNKNOWN_CHANNEL: '未知的操作',
    SETTINGS_INVALID: '设置值不正确',
    WORKSPACE_NOT_FOUND: '找不到工作区',
    WORKSPACE_DEFAULT_PROTECTED: '默认工作区不能删除',
    WORKSPACE_NAME_REQUIRED: '请输入名称',
    ENTRY_NOT_FOUND: '找不到该条目',
    ENTRY_INVALID_PARENT: '不能移动或添加到这里（只有分组可以作为上级）',
    ENTRY_KIND_MISMATCH: '文件夹与文件的类型不一致',
    ENTRY_TEMPORARY_PATH: '无法添加临时文件（例如压缩包内的文件），请先解压。',
    FS_NOT_FOUND: '找不到文件或文件夹',
    FS_PERMISSION_DENIED: '没有访问权限',
    FS_NOT_A_DIRECTORY: '不是文件夹',
    FS_INVALID_URI: '路径格式不正确',
    FS_UNSUPPORTED_SCHEME: '不支持这种类型的位置',
    FS_CANCELLED: '操作已取消',
    FS_TIMEOUT: '没有响应，已中止',
    FS_UNAVAILABLE: '无法访问该位置',
    INDEX_UNAVAILABLE: '索引不可用',
    DOC_NOT_FOUND: '文档已关闭，请重新打开',
    LAUNCH_FAILED: '启动失败，请检查关联的应用程序',
    DESKTOP_SNAPSHOT_NOT_FOUND: '找不到该桌面记录，可能已被删除',
    CONN_NOT_FOUND: '找不到该连接（可能已被删除）',
    CONN_AUTH_FAILED: '认证失败，请检查用户名、密码或密钥（不会自动重试）',
    CONN_KEY_INVALID:
      '无法读取私钥：只支持 OpenSSH / PEM 格式与 PuTTY 的 PPK v2（RSA / DSA）私钥，也请确认口令是否正确',
    CONN_HOST_KEY_REJECTED: '未信任服务器的主机密钥，已取消连接',
    CONN_HOST_KEY_CHANGED:
      '服务器的主机密钥与已信任的不同，已拒绝连接；确认后在「远程连接」中信任新的密钥',
    CONN_SUDO_AUTH_FAILED: 'sudo 密码错误（不会自动重试）',
    CONN_SUDO_DENIED: 'sudo 不允许切换到该用户',
    CONN_SUDO_FAILED: '切换用户失败（超时或通道被关闭）',
    CONN_SFTP_SERVER_NOT_FOUND: '服务器上找不到 sftp-server，请在连接设置中指定路径',
    CONN_PROCESS_LIST_HIDDEN: '服务器隐藏了其他用户的进程，无法安全地切换身份',
    CONN_SECRET_UNAVAILABLE: '无法解密已保存的密码，请在连接设置中重新输入'
  }
} satisfies Resource
