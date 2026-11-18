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
    ready: '就绪',
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
    addConnection: '添加远程连接'
  },
  connections: {
    emptyTitle: '还没有远程连接',
    emptyHint: '添加 SMB、FTP 或 SFTP 服务器后，任何工作区都可以引用。'
  },
  welcome: {
    title: '欢迎',
    subtitle: '按案件整理文件，随时快速查阅。',
    startTitle: '开始',
    newWorkspace: '新建工作区',
    openFolder: '打开本地文件夹',
    connectRemote: '连接 SMB / FTP / SFTP',
    shortcutsTitle: '快捷键',
    shortcutCommand: '命令面板',
    shortcutSidebar: '显示/隐藏侧栏',
    shortcutSettings: '打开设置',
    comingSoon: '该功能将在后续里程碑中实现'
  },
  errors: {
    UNKNOWN: '发生了意外错误',
    IPC_FORBIDDEN: '不允许的调用',
    IPC_BAD_INPUT: '输入内容不正确',
    IPC_UNKNOWN_CHANNEL: '未知的操作',
    SETTINGS_INVALID: '设置值不正确',
    WORKSPACE_NOT_FOUND: '找不到工作区',
    WORKSPACE_DEFAULT_PROTECTED: '默认工作区不能删除',
    ENTRY_NOT_FOUND: '找不到该条目',
    ENTRY_INVALID_PARENT: '不能移动或添加到这里（只有分组可以作为上级）',
    ENTRY_KIND_MISMATCH: '文件夹与文件的类型不一致',
    FS_NOT_FOUND: '找不到文件或文件夹',
    FS_PERMISSION_DENIED: '没有访问权限',
    FS_NOT_A_DIRECTORY: '不是文件夹',
    FS_INVALID_URI: '路径格式不正确',
    FS_UNSUPPORTED_SCHEME: '不支持这种类型的位置',
    FS_CANCELLED: '操作已取消',
    FS_TIMEOUT: '没有响应，已中止'
  }
} satisfies Resource
