import type { Resource } from '../types'

export default {
  common: {
    appName: 'PremiumCowHorse',
    workspace: 'Workspace',
    defaultWorkspace: 'Default',
    search: 'Search files or commands…',
    explorer: 'Explorer',
    connections: 'Remote connections',
    settings: 'Settings',
    language: 'Language',
    theme: 'Theme',
    themeLight: 'Light',
    themeDark: 'Dark',
    followSystem: 'System',
    themeColors: 'Color theme',
    themeDefault: 'Default',
    themeAitetsu: 'Indigo Steel',
    themeWashi: 'Washi',
    themeMatsuba: 'Pine',
    reduceMotion: 'Reduce motion',
    reduceMotionOn: 'On',
    reduceMotionOff: 'Off',
    accentThemeDefault: 'Theme default',
    ready: 'Ready',
    messages: 'Notifications: {{count}}',
    messagesRestore: 'Show unread notifications',
    crashTitle: 'Something went wrong while displaying this window',
    crashHint: 'If reloading does not help, contact support and attach the log file (main.log).',
    reload: 'Reload',
    minimize: 'Minimize',
    maximize: 'Maximize',
    restore: 'Restore',
    close: 'Close'
  },
  explorer: {
    emptyTitle: 'This workspace is empty',
    emptyHint: 'Drag folders or files here, or add them with the buttons below.',
    addFolder: 'Add folder',
    title: 'Explorer',
    refresh: 'Refresh',
    collapseAll: 'Collapse all',
    locate: 'Reveal active item',
    loading: 'Loading…',
    empty: 'No items',
    retry: 'Retry',
    newGroup: 'New group',
    newGroupDefaultName: 'New group',
    newGroupTitle: 'New group',
    groupName: 'Group name',
    create: 'Create',
    rename: 'Rename',
    renameTitle: 'Rename',
    renameDescription:
      'Only changes the display name in the workspace. The name on disk is not changed.',
    name: 'Name',
    nameRequired: 'Enter a name',
    save: 'Rename',
    remove: 'Remove from workspace',
    removeTitle: 'Remove "{{name}}" from the workspace?',
    removeDescription:
      'Only the workspace entry is removed. This does not delete any files or folders on disk.',
    removeGroupDescription:
      'This group and everything inside it are removed from the workspace. This does not delete any files or folders on disk.',
    openInNewTab: 'Open in New Tab',
    reveal: 'Reveal in File Explorer',
    cacheStrategy: 'Cache strategy',
    cacheStrategyFollowGlobal: 'Use global setting ({{strategy}})',
    levelAll: 'All',
    levelActive: 'Active',
    levelDefault: 'Default',
    levelPassive: 'Passive',
    buildIndex: 'Build index',
    lastUpdated: 'Last updated: {{time}}',
    disconnected: 'Disconnected',
    copyPath: 'Copy path',
    copyUri: 'Copy URI',
    pinToRoot: 'Pin to workspace root',
    menuAddFolder: 'Add folder…',
    menuAddFile: 'Add file…',
    copiedPath: 'Path copied',
    copiedUri: 'URI copied',
    cancel: 'Cancel',
    revealNotInWorkspace: 'This item is not under any entry of the current workspace',
    revealNotFound:
      'Could not find the item in the tree. The folder may have changed (press F5 to refresh).',
    revealTimeout: 'Loading the folders took too long; expanded as far as possible',
    addRemoteFolder: 'Add remote folder',
    menuAddRemoteFolder: 'Add remote folder…',
    remoteFolder: 'Remote folder',
    addRemoteTitle: 'Add remote folder',
    addRemoteDescription:
      'Adds a folder on an SFTP server as a read-only entry. Files on the server are never changed.',
    remoteConnection: 'Connection',
    remoteNoConnections: 'No remote connections yet. Add one with Manage connections.',
    manageConnections: 'Manage connections',
    remoteIdentity: 'Read as',
    remoteLoginUser: 'Login user ({{name}})',
    remoteIdentityHint: 'Other users are read through sudo; their default path is /.',
    remotePath: 'Path',
    remotePathInvalid: 'Enter an absolute path starting with / (. and .. are not allowed)',
    remoteHomeLoading: 'Getting the home folder…',
    add: 'Add',
    addAsOwner: 'Add entry as {{owner}}',
    addedAsOwner: 'Added “{{label}}” (read as {{owner}})'
  },
  search: {
    title: 'Search',
    placeholder: 'Search file names',
    inputLabel: 'File name',
    clear: 'Clear',
    kindLabel: 'Kind',
    kindAll: 'All',
    kindFile: 'Files',
    kindDirectory: 'Folders',
    resultsLabel: 'Search results',
    scopeHint:
      'Searches file names in the cache of the current workspace. What can be found depends on each entry’s cache strategy and “Build index”.',
    wildcardHint: 'Separate words with spaces to match all of them; use * and ? as wildcards',
    noResults: 'No results',
    count: '{{total}} found',
    basedOnCache: 'From cache (updated {{time}})',
    justNow: 'just now',
    incomplete: 'Some folders have not been scanned yet',
    truncated: 'Showing the first {{limit}} results. Type more keywords to narrow down.',
    unavailableTitle: 'Search is unavailable',
    revealInTree: 'Reveal in tree'
  },
  workspace: {
    switcherLabel: 'Switch workspace',
    listLabel: 'Workspaces',
    newItem: 'New workspace…',
    renameItem: 'Rename current workspace…',
    restoreName: 'Restore default name',
    deleteItem: 'Delete current workspace…',
    name: 'Workspace name',
    nameRequired: 'Enter a name',
    cancel: 'Cancel',
    createTitle: 'New workspace',
    createDescription: 'Create a workspace to keep the files for a case together.',
    create: 'Create',
    renameTitle: 'Rename workspace',
    renameDescription: 'Only changes the display name of the workspace.',
    save: 'Save',
    deleteTitle: 'Delete "{{name}}"?',
    deleteDescription:
      'Only the workspace and its entries are deleted. This does not delete any files or folders on disk.',
    delete: 'Delete',
    createdNotActivated: 'Workspace created, but switching to it failed',
    manage: 'Manage workspaces…',
    listPage: 'Workspaces',
    current: 'Current',
    lastOpened: 'Last opened {{time}}',
    renameMenu: 'Rename…',
    deleteMenu: 'Delete…'
  },
  desktop: {
    title: 'Desktop snapshots',
    listLabel: 'Desktop snapshots',
    saveNow: 'Save now',
    current: 'Now',
    kind: {
      auto: 'Autosave',
      manual: 'Manual save',
      exit: 'Saved on exit',
      exitNone: 'Exited without saving'
    },
    beforeRestart: 'Before restart',
    itemCount: 'Items: {{count}}',
    renameMenu: 'Rename…',
    deleteMenu: 'Delete…',
    renameTitle: 'Rename snapshot',
    renameDescription: 'Leave it empty to show the snapshot type instead.',
    nameLabel: 'Name',
    cancel: 'Cancel',
    renameSubmit: 'Rename',
    deleteTitle: 'Delete this snapshot?',
    deleteDescription:
      'Only the snapshot is deleted. Open files and folders, and files on disk, are not affected.',
    deleteSubmit: 'Delete',
    noSnapshots: 'No snapshots yet',
    snapshotGone: 'This snapshot no longer exists. It may have been deleted',
    saved: 'Desktop saved (items: {{count}})',
    nothingToSave: 'There is nothing to save',
    category: {
      explorer: 'File Explorer',
      word: 'Word',
      excel: 'Excel',
      powerpoint: 'PowerPoint',
      vscode: 'VS Code',
      eclipse: 'Eclipse'
    },
    groupSelected: '{{selected}} / {{total}} selected',
    checklistLabel: 'Items',
    specialLocation: 'Special location',
    tabCount: ' ({{count}} tab(s))',
    readOnly: 'Read-only',
    selectedCount: '{{selected}} of {{total}} selected',
    unreadable: 'Could not read: {{names}}',
    sharePointNote: 'Files on SharePoint / OneDrive are not recorded',
    emptyCurrent: 'Nothing is open right now',
    emptySnapshot: 'This snapshot has no items',
    restoreSelected: 'Restore selected items',
    saveSelected: 'Save',
    restoreTitle: 'Restore your previous desktop?',
    restoreDescription: 'These items were open before the restart. Choose what to restore.',
    restoreSubmit: 'Restore',
    restoreLater: 'Later',
    explorerWindow: 'Same window · {{count}} tab(s)',
    clearTitle: 'Delete the saved snapshots?',
    clearDescription:
      'Restore finished. All {{count}} saved snapshot(s) will be deleted and the current desktop recorded again.',
    clearFailedNote:
      'Some items could not be restored (unreachable or failed to start). Keep the snapshots to try again later.',
    clearKeep: 'Keep',
    clearConfirm: 'Delete',
    exitTitle: 'Save your desktop before exiting?',
    exitDescription: 'Choose the items to save. You can restore them next time you start.',
    exitNoItems: 'Nothing is open right now',
    exitLoading: 'Reading what is open…',
    exitSave: 'Save and exit',
    exitNoSave: 'Exit without saving',
    dontAskAgain: "Don't ask again",
    askOnExit: 'Ask before exiting',
    moreActions: 'More actions',
    restored: 'Restored items: {{count}}',
    restoredNone: 'No items were restored',
    skipped: 'Skipped: {{details}}',
    skipReason: {
      open: '{{count}} already open',
      missing: '{{count}} not found',
      unreachable: '{{count}} unreachable',
      failed: '{{count}} failed to start'
    }
  },
  connections: {
    title: 'Remote connections',
    listLabel: 'Remote connections',
    add: 'New connection',
    emptyTitle: 'No remote connections yet',
    emptyHint: 'Add an SFTP server once and use it from any workspace.',
    status: {
      online: 'Online',
      idle: 'Not connected',
      connecting: 'Connecting',
      offline: 'Offline',
      authFailed: 'Authentication failed',
      sudoAuthFailed: 'sudo authentication failed',
      hostKeyPending: 'Waiting for host key confirmation',
      hostKeyChanged: 'Host key changed'
    },
    identitiesLine: 'Switch users: {{list}}',
    test: 'Test',
    edit: 'Edit',
    delete: 'Delete',
    reconnect: 'Reconnect',
    trustNewKey: 'Trust new key',
    newTitle: 'New connection',
    editTitle: 'Edit connection',
    dialogDescription:
      'Connects read-only over SFTP (SSH). Passwords are encrypted and stored on this PC.',
    name: 'Name',
    namePlaceholder: 'e.g. Customer A prod AP1',
    host: 'Host',
    port: 'Port',
    username: 'User name',
    auth: 'Authentication',
    authPassword: 'Password authentication',
    authKey: 'Private key authentication',
    password: 'Password',
    secretSaved: 'Saved (unchanged)',
    keyPath: 'Private key file',
    browse: 'Browse…',
    keyHint: 'OpenSSH / PEM keys and PuTTY PPK v2 (RSA / DSA) are supported.',
    passphrase: 'Passphrase',
    passphraseNone: 'None',
    identities: 'Switch users',
    identitiesHint:
      'Users to switch to with sudo for reading (e.g. app1, root). Press Enter to add.',
    identityPlaceholder: 'Type a user name',
    removeIdentity: 'Remove {{name}}',
    sudo: 'sudo password',
    sudoSame: 'Same as login password',
    sudoNone: 'No sudo password (NOPASSWD)',
    sudoSeparate: 'Set separately',
    sudoHint: 'Set it separately where sudo asks for the root password (e.g. targetpw on SUSE).',
    sftpServer: 'sftp-server path',
    sftpAuto: 'Auto-detect',
    sftpCustom: 'Specify',
    hostKey: 'Trusted host key',
    hostKeyNone: 'None yet (confirmed on first connection)',
    hostKeyPresented: 'New key presented by the server',
    cancel: 'Cancel',
    save: 'Save',
    formError: {
      nameRequired: 'Enter a name',
      hostRequired: 'Enter a host',
      portInvalid: 'Enter a number from 1 to 65535',
      usernameRequired: 'Enter a user name',
      usernameInvalid:
        'Use lowercase letters, digits and _ . - only (start with a letter or _, up to 32 characters)',
      passwordRequired: 'Enter the password',
      keyPathRequired: 'Choose a private key file',
      sudoPasswordRequired: 'Enter the sudo password',
      sftpServerPathInvalid:
        'Enter an absolute path starting with / (letters, digits and . _ / + - only)',
      identityInvalid:
        'Use lowercase letters, digits and _ . - only (start with a letter or _, up to 32 characters)',
      identityDuplicate: 'Already added',
      identityTooMany: 'Up to 20 users can be added'
    },
    testResult: 'Test result',
    testing: 'Testing…',
    closeResult: 'Close test result',
    step: {
      connect: 'Connect',
      hostKey: 'Host key',
      auth: 'Authentication',
      sftp: 'SFTP',
      identity: 'Switch to {{identity}}'
    },
    stepOk: 'OK',
    stepFailed: 'Failed',
    stepSkipped: 'Not run',
    homeInfo: 'Home: {{path}}',
    identityInfo: 'sftp-server: {{path}} ({{mode}})',
    modeNopty: 'no terminal',
    modePty: 'terminal',
    deleteTitle: 'Delete this connection?',
    deleteCounting: 'Checking which entries use this connection…',
    deleteNoRefs: 'No workspace entries use this connection.',
    deleteRefs:
      'Workspace entries using this connection: {{count}}. They are kept and show “connection not found”.',
    deleteCountFailed: 'Could not check which entries use this connection.',
    deleteSubmit: 'Delete',
    trustTitle: 'Trust the new host key?',
    trustDescription:
      'The server host key differs from the trusted one. Trust it only after confirming the change (for example, the server was rebuilt).',
    oldKey: 'Previous key',
    newKey: 'New key',
    trustSubmit: 'Trust',
    trustKeyStale:
      'The key the server presents has changed from the one shown. Check the new key before trusting it.',
    promptTitle: 'Trust this server?',
    promptDescription:
      'Connecting to “{{name}}” ({{address}}) for the first time. Confirm the fingerprint with the administrator before trusting it.',
    algorithm: 'Algorithm',
    fingerprint: 'Fingerprint',
    promptAccept: 'Trust and connect',
    promptMore: 'More confirmations waiting: {{count}}'
  },
  welcome: {
    title: 'Welcome',
    subtitle: 'Keep each case’s files together and review them quickly.',
    startTitle: 'Start',
    newWorkspace: 'Create a workspace',
    openFolder: 'Open a local folder',
    connectRemote: 'Connect to an SFTP server',
    shortcutsTitle: 'Shortcuts',
    shortcutCommand: 'Command palette',
    shortcutSidebar: 'Toggle sidebar',
    shortcutSettings: 'Open settings',
    comingSoon: 'This feature arrives in a later milestone'
  },
  addressBar: {
    label: 'Address bar',
    back: 'Back',
    forward: 'Forward',
    up: 'Up one level',
    refresh: 'Refresh',
    viewer: 'View as',
    alwaysOpenWith: 'Always open .{{ext}} with this',
    copyHint: 'Click to copy the path'
  },
  about: {
    title: 'About this app',
    version: 'Version',
    electron: 'Electron',
    chromium: 'Chromium',
    node: 'Node.js',
    platform: 'Platform',
    dataDir: 'Data folder',
    logsDir: 'Log folder',
    openLogs: 'Open log folder',
    openData: 'Open data folder',
    copyDiagnostics: 'Copy diagnostics',
    copied: 'Diagnostics copied',
    openFailed: 'Could not open the folder',
    copyFailed: 'Could not copy the diagnostics'
  },
  settings: {
    title: 'Settings',
    searchPlaceholder: 'Search settings…',
    searchLabel: 'Search settings',
    noResults: 'No matching settings',
    navLabel: 'Settings categories',
    sections: {
      general: 'General',
      appearance: 'Appearance',
      workspace: 'Workspace',
      explorer: 'Explorer',
      preview: 'Preview',
      cache: 'Cache and scanning',
      remote: 'Remote connections',
      desktop: 'Desktop records',
      privacy: 'Privacy'
    },
    about: 'About this app',
    reset: 'Restore default',
    unit: {
      sec: 's',
      ms: 'ms',
      min: 'min',
      mb: 'MB'
    },
    error: {
      required: 'Enter a value',
      invalid: 'Enter a valid value',
      integer: 'Enter a whole number',
      range: 'Enter a value from {{min}} to {{max}}',
      min: 'Enter a value of {{min}} or more'
    },
    keepaliveNote: 'Applies to new connections',
    associations: {
      title: 'File associations',
      desc: 'The "always open with" choices saved per extension.',
      empty: 'No file associations',
      remove: 'Remove the association for {{ext}}'
    },
    cache: {
      usage: 'Cache size',
      usageLoading: 'Checking…',
      usageUnavailable: 'Unavailable',
      clear: 'Clear cache',
      confirmTitle: 'Clear the cache?',
      confirmDesc:
        'Removes the folder listing cache and the index. Files on disk are not changed. They are rebuilt the next time you browse.',
      confirm: 'Clear',
      cancel: 'Cancel',
      cleared: 'Cache cleared',
      clearFailed: 'Could not clear the cache'
    },
    privacy: {
      recentTitle: 'Recent items',
      recentDesc: 'Clears the history of recently opened items.',
      clearRecent: 'Clear recent items',
      soon: 'Available in a later milestone'
    },
    options: {
      language: {
        system: 'Follow system',
        ja: '日本語',
        'zh-CN': '简体中文',
        en: 'English'
      },
      themeMode: {
        system: 'Follow system',
        light: 'Light',
        dark: 'Dark'
      },
      theme: {
        default: 'Standard',
        aitetsu: 'Aitetsu',
        washi: 'Washi',
        matsuba: 'Matsuba'
      },
      accent: {
        neutral: 'Theme default',
        blue: 'Blue',
        green: 'Green',
        violet: 'Violet',
        orange: 'Orange'
      },
      density: {
        comfortable: 'Comfortable',
        compact: 'Compact'
      },
      reduceMotion: {
        system: 'Follow system',
        on: 'On',
        off: 'Off'
      },
      pickerStyle: {
        carousel: 'Ring',
        menu: 'Menu'
      },
      strategy: {
        passive: 'Passive',
        default: 'Default',
        active: 'Active',
        all: 'All'
      }
    },
    item: {
      general_language: {
        name: 'Language',
        desc: 'The language used in the interface.'
      },
      appearance_theme: {
        name: 'Color theme',
        desc: 'The color palette of the whole interface.'
      },
      appearance_themeMode: {
        name: 'Light / dark',
        desc: 'Switch between light and dark.'
      },
      appearance_accent: {
        name: 'Accent color',
        desc: 'The highlight color of buttons and selections.'
      },
      appearance_density: {
        name: 'Density',
        desc: 'How tightly lists and spacing are laid out.'
      },
      appearance_reduceMotion: {
        name: 'Reduce motion',
        desc: 'Tones down animations. "Follow system" uses the OS setting.'
      },
      workspace_pickerStyle: {
        name: 'Workspace picker style',
        desc: 'How the picker looks when switching workspaces.'
      },
      workspace_pickerDetail: {
        name: 'Show details by default',
        desc: 'Show detailed information on workspace picker cards.'
      },
      explorer_showHiddenFiles: {
        name: 'Show hidden files',
        desc: 'Show files and folders with the hidden attribute.'
      },
      explorer_singleClickPreview: {
        name: 'Open on single click',
        desc: 'Select an item (or move to it with the arrow keys) to open its preview. When off, double-click or press Enter.'
      },
      preview_maxTextSizeMB: {
        name: 'Text preview size limit',
        desc: 'Text files larger than this are not opened directly.'
      },
      cache_strategy_local: {
        name: 'Cache strategy (local)',
        desc: 'Default cache strategy for local folders. Each item can override it.'
      },
      cache_strategy_network: {
        name: 'Cache strategy (network)',
        desc: 'Default cache strategy for network folders. Each item can override it.'
      },
      cache_activeDepth: {
        name: 'Look-ahead depth for "Active"',
        desc: 'How many levels above and below the focused location the "Active" strategy reads ahead.'
      },
      cache_interval_focus_local: {
        name: 'Check interval: focused (local)',
        desc: 'How often the focused location is checked.'
      },
      cache_interval_near_local: {
        name: 'Check interval: nearby (local)',
        desc: 'How often locations near the focus are checked.'
      },
      cache_interval_far_local: {
        name: 'Check interval: distant (local)',
        desc: 'How often locations far from the focus are checked.'
      },
      cache_interval_focus_network: {
        name: 'Check interval: focused (network)',
        desc: 'How often the focused location is checked.'
      },
      cache_interval_near_network: {
        name: 'Check interval: nearby (network)',
        desc: 'How often locations near the focus are checked.'
      },
      cache_interval_far_network: {
        name: 'Check interval: distant (network)',
        desc: 'How often locations far from the focus are checked.'
      },
      cache_backgroundGapMs_local: {
        name: 'Background pause (local)',
        desc: 'Pause after each folder when filling the cache in the background.'
      },
      cache_backgroundGapMs_network: {
        name: 'Background pause (network)',
        desc: 'Pause after each folder when filling the cache in the background.'
      },
      vfs_timeoutSec_local: {
        name: 'Timeout (local)',
        desc: 'The longest to wait without a response.'
      },
      vfs_timeoutSec_network: {
        name: 'Timeout (network)',
        desc: 'The longest to wait without a response.'
      },
      remote_keepaliveSec: {
        name: 'Keepalive interval',
        desc: 'How often the connection is checked. Three missed replies in a row count as a disconnect.'
      },
      remote_idleDisconnectMin: {
        name: 'Disconnect when idle',
        desc: 'Disconnect after this long without any request.'
      },
      vfs_timeoutSec_remote: {
        name: 'Timeout (remote)',
        desc: 'The longest to wait for a remote file operation.'
      },
      cache_backgroundGapMs_remote: {
        name: 'Background pause (remote)',
        desc: 'Pause after each folder when filling the remote cache in the background.'
      },
      cache_remoteIndexIntervalMin: {
        name: 'Index refresh interval (remote)',
        desc: 'How often the index of remote folders is rebuilt.'
      },
      desktop_askOnExit: {
        name: 'Ask before saving on exit',
        desc: 'Ask which desktop items to save when quitting. When off, everything is saved.'
      }
    }
  },
  commands: {
    group: {
      general: 'General',
      view: 'View',
      navigation: 'Navigation',
      workspace: 'Workspace',
      appearance: 'Appearance'
    },
    paletteOpen: 'Open command palette',
    settingsOpen: 'Open settings',
    aboutOpen: 'Open about',
    workspacePick: 'Choose workspace',
    tabClose: 'Close tab',
    navBack: 'Back',
    navForward: 'Forward',
    navUp: 'Up one level',
    navRefresh: 'Refresh',
    viewSearch: 'Open search',
    viewToggleSidebar: 'Toggle sidebar'
  },
  tabs: {
    label: 'Open tabs',
    close: 'Close'
  },
  preview: {
    loading: 'Loading…',
    errorTitle: "This preview can't be displayed",
    errorHint: 'The preview ({{plugin}}) ran into an error. Other tabs are not affected.',
    showInfo: 'Show file info',
    retry: 'Retry',
    copiedPath: 'Path copied',
    offline: 'This location is disconnected. It will be shown when it reconnects.',
    confirmTitle: 'Open "{{name}}"?',
    confirmDescription:
      'This file runs as a program or script and may change settings on this PC. Open it only if you trust it.',
    confirmOpen: 'Open',
    cancel: 'Cancel',
    overviewEmpty: 'This workspace has no items yet.'
  },
  errors: {
    UNKNOWN: 'An unexpected error occurred',
    IPC_FORBIDDEN: 'This call is not allowed',
    IPC_BAD_INPUT: 'The input is invalid',
    IPC_UNKNOWN_CHANNEL: 'Unknown operation',
    SETTINGS_INVALID: 'The setting value is invalid',
    WORKSPACE_NOT_FOUND: 'Workspace not found',
    WORKSPACE_DEFAULT_PROTECTED: 'The default workspace cannot be deleted',
    WORKSPACE_NAME_REQUIRED: 'Enter a name',
    ENTRY_NOT_FOUND: 'Item not found',
    ENTRY_INVALID_PARENT: 'Cannot move or add here (only groups can contain items)',
    ENTRY_KIND_MISMATCH: 'The item type does not match (folder vs. file)',
    ENTRY_TEMPORARY_PATH:
      "Temporary files (such as files inside an archive) can't be added. Extract them first.",
    FS_NOT_FOUND: 'File or folder not found',
    FS_PERMISSION_DENIED: 'Access denied',
    FS_NOT_A_DIRECTORY: 'Not a folder',
    FS_INVALID_URI: 'The path is not valid',
    FS_UNSUPPORTED_SCHEME: 'This kind of location is not supported',
    FS_CANCELLED: 'The operation was canceled',
    FS_TIMEOUT: 'Stopped because there was no response',
    FS_UNAVAILABLE: 'The location is unavailable',
    INDEX_UNAVAILABLE: 'The index is unavailable',
    DOC_NOT_FOUND: 'The document was closed. Open it again',
    LAUNCH_FAILED: 'Could not launch the app. Check the associated application',
    DESKTOP_SNAPSHOT_NOT_FOUND: 'The desktop snapshot was not found. It may have been deleted',
    CONN_NOT_FOUND: 'Connection not found (it may have been deleted)',
    CONN_AUTH_FAILED:
      'Authentication failed. Check the user name, password or key (no automatic retry)',
    CONN_KEY_INVALID:
      'Cannot read the private key. Only OpenSSH / PEM and PuTTY PPK v2 (RSA / DSA) keys are supported; also check the passphrase',
    CONN_HOST_KEY_REJECTED: 'The server host key was not trusted, so the connection was canceled',
    CONN_HOST_KEY_CHANGED:
      "The server's host key differs from the trusted one, so the connection was refused. After verifying, trust the new key in Remote connections",
    CONN_SUDO_AUTH_FAILED: 'The sudo password is incorrect (no automatic retry)',
    CONN_SUDO_DENIED: 'sudo does not allow switching to this user',
    CONN_SUDO_FAILED: 'Switching user failed (timed out or the channel was closed)',
    CONN_SFTP_SERVER_NOT_FOUND:
      'sftp-server was not found on the server. Specify its path in the connection settings',
    CONN_PROCESS_LIST_HIDDEN:
      "The server hides other users' processes, so the user cannot be switched safely",
    CONN_SECRET_UNAVAILABLE:
      'The saved password cannot be decrypted. Enter it again in the connection settings'
  }
} satisfies Resource
