import type { Migration } from 'kysely/migration'
import * as m0001 from './0001-init'
import * as m0002 from './0002-workspaces'
import * as m0003 from './0003-refresh'
import * as m0004 from './0004-cache-strategy'

/**
 * 迁移按键名的字典序执行，键名一旦发布不得修改。
 * 迁移随主进程代码一起打包，不需要在运行时读取 SQL 文件。
 */
export const migrations: Record<string, Migration> = {
  '0001-init': m0001,
  '0002-workspaces': m0002,
  '0003-refresh': m0003,
  '0004-cache-strategy': m0004
}
