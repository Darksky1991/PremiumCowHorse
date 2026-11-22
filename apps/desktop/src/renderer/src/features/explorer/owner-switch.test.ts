import { describe, expect, it } from 'vitest'
import type { ConnectionDto, WorkspaceEntry } from '@pch/shared'
import { ownerSwitchFor } from './owner-switch'
import type { TreeNode } from './tree-model'

const conn = (over: Partial<ConnectionDto> = {}): ConnectionDto => ({
  id: 'ID',
  name: 'AP1',
  host: '10.0.0.5',
  port: 22,
  username: 'ope01',
  auth: 'password',
  keyPath: null,
  hasSecret: true,
  hasSudoSecret: false,
  identities: ['app1', 'root'],
  sftpServerPath: null,
  hostKey: null,
  presentedHostKey: null,
  authState: 'ok',
  state: 'online',
  createdAt: 0,
  updatedAt: 0,
  ...over
})

const entry = (over: Partial<WorkspaceEntry> = {}): WorkspaceEntry => ({
  id: 'e1',
  workspaceId: 'ws',
  parentId: 'g1',
  kind: 'folder',
  label: 'opt',
  uri: 'sftp://ID/opt',
  sortOrder: 0,
  meta: null,
  cacheStrategy: null,
  createdAt: 0,
  updatedAt: 0,
  ...over
})

/** 无权限的状态行（真实子目录 /opt/app1/log 之下） */
const statusRow = (over: Partial<TreeNode> = {}): TreeNode => ({
  id: 'fs:e1:app1/log#status',
  parentId: 'fs:e1:app1/log',
  depth: 3,
  label: '',
  kind: 'directory',
  source: 'fs',
  entryId: 'e1',
  uri: 'sftp://ID/opt/app1/log',
  expandable: false,
  expanded: false,
  status: 'error',
  errorCode: 'FS_PERMISSION_DENIED',
  owner: 'app1',
  ...over
})

describe('ownerSwitchFor', () => {
  it('属主在登记的身份中：以属主身份的同一路径，加在包含它的条目所在的父分组下，标签为最后一段', () => {
    expect(ownerSwitchFor(statusRow(), [entry()], [conn()])).toEqual({
      owner: 'app1',
      uri: 'sftp://app1@ID/opt/app1/log',
      parentId: 'g1',
      label: 'log'
    })
  })

  it('条目在根下时 parentId 为 null；根目录的标签为 /', () => {
    const row = statusRow({ uri: 'sftp://ID', owner: 'root' })
    expect(ownerSwitchFor(row, [entry({ parentId: null })], [conn()])).toMatchObject({
      uri: 'sftp://root@ID',
      parentId: null,
      label: '/'
    })
  })

  it('已切换到其他身份时也可以（属主与当前身份不同）', () => {
    const row = statusRow({ uri: 'sftp://root@ID/opt/app1/log' })
    expect(ownerSwitchFor(row, [entry()], [conn()])?.uri).toBe('sftp://app1@ID/opt/app1/log')
  })

  it('不显示：属主不在登记的身份中、等于当前身份、等于登录用户', () => {
    expect(ownerSwitchFor(statusRow({ owner: 'db1' }), [entry()], [conn()])).toBeNull()
    const asApp1 = statusRow({ uri: 'sftp://app1@ID/opt/app1/log' })
    expect(ownerSwitchFor(asApp1, [entry()], [conn()])).toBeNull()
    const loginOwned = conn({ identities: ['app1', 'ope01'] })
    expect(ownerSwitchFor(statusRow({ owner: 'ope01' }), [entry()], [loginOwned])).toBeNull()
  })

  it('不显示：其他错误、没有属主、本地、连接不存在、连接列表未加载', () => {
    const rows = [
      statusRow({ errorCode: 'FS_NOT_FOUND' }),
      statusRow({ status: 'empty' }),
      statusRow({ owner: undefined }),
      statusRow({ uri: 'file:///C:/opt' })
    ]
    for (const row of rows) expect(ownerSwitchFor(row, [entry()], [conn()])).toBeNull()
    expect(ownerSwitchFor(statusRow(), [entry()], [conn({ id: 'OTHER' })])).toBeNull()
    expect(ownerSwitchFor(statusRow(), [entry()], undefined)).toBeNull()
  })
})
