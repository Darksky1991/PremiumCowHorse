// feature 的公开 API：其他模块只能从这里引用，禁止深层路径 import
export { DesktopView } from './desktop-view'
export { SnapshotPage } from './snapshot-page'
export { DesktopPrompts } from './desktop-prompts'
// 退出 / 恢复对话框（Task 12）复用的清单
export { ItemChecklist } from './item-checklist'
export { itemLabel } from './item-label'
