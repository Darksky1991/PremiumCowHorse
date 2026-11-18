import type { Resource } from '../types'

export default {
  common: {
    appName: 'PremiumCowHorse',
    workspace: 'Workspace',
    defaultWorkspace: 'Common',
    search: 'Search files or commands…',
    explorer: 'Explorer',
    connections: 'Remote connections',
    settings: 'Settings',
    language: 'Language',
    theme: 'Theme',
    themeLight: 'Light',
    themeDark: 'Dark',
    followSystem: 'System',
    ready: 'Ready',
    crashTitle: 'Something went wrong while displaying this window',
    crashHint: 'If reloading does not help, contact support and attach the log file (main.log).',
    reload: 'Reload'
  },
  explorer: {
    emptyTitle: 'This workspace is empty',
    emptyHint: 'Drag folders or files here, or add them with the buttons below.',
    addFolder: 'Add folder',
    addConnection: 'Add remote connection'
  },
  connections: {
    emptyTitle: 'No remote connections yet',
    emptyHint: 'Add an SMB, FTP or SFTP server once and use it from any workspace.'
  },
  welcome: {
    title: 'Welcome',
    subtitle: 'Keep each case’s files together and review them quickly.',
    startTitle: 'Start',
    newWorkspace: 'Create a workspace',
    openFolder: 'Open a local folder',
    connectRemote: 'Connect to SMB / FTP / SFTP',
    shortcutsTitle: 'Shortcuts',
    shortcutCommand: 'Command palette',
    shortcutSidebar: 'Toggle sidebar',
    shortcutSettings: 'Open settings',
    comingSoon: 'This feature arrives in a later milestone'
  },
  errors: {
    UNKNOWN: 'An unexpected error occurred',
    IPC_FORBIDDEN: 'This call is not allowed',
    IPC_BAD_INPUT: 'The input is invalid',
    IPC_UNKNOWN_CHANNEL: 'Unknown operation',
    SETTINGS_INVALID: 'The setting value is invalid'
  }
} satisfies Resource
