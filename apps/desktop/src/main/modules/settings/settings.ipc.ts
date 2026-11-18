import type { HandlersOf } from '../../ipc/router'
import type { SettingsService } from './settings.service'

export function settingsHandlers(
  settings: SettingsService
): HandlersOf<'settings.getAll' | 'settings.set'> {
  return {
    'settings.getAll': async () => settings.getAll(),
    'settings.set': async (patch) => settings.set(patch)
  }
}
