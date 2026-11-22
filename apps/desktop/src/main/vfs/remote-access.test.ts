import { describe, expect, it } from 'vitest'
import { AppError, type WorkspaceEntry } from '@pch/shared'
import { RemoteAccess, remoteFolderRoots } from './remote-access'

const ID = '3f2a0000-0000-4000-8000-000000000001'

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p
    return null
  } catch (e) {
    expect(e).toBeInstanceOf(AppError)
    return (e as AppError).code
  }
}

function ready(roots: string[]): RemoteAccess {
  const a = new RemoteAccess()
  a.setRoots(roots)
  return a
}

describe('RemoteAccess.check', () => {
  it('根之下通过；根之外、不同身份为 IPC_FORBIDDEN；file: 直接通过', async () => {
    const a = ready([`sftp://${ID}/opt`])
    expect(await codeOf(a.check(`sftp://${ID}/opt/a`))).toBeNull()
    expect(await codeOf(a.check(`sftp://${ID}/opt`))).toBeNull()
    expect(await codeOf(a.check(`sftp://${ID}/etc`))).toBe('IPC_FORBIDDEN')
    expect(await codeOf(a.check(`sftp://app1@${ID}/opt/a`))).toBe('IPC_FORBIDDEN')
    expect(await codeOf(a.check('file:///C:/x'))).toBeNull()
  })

  it('前缀相同的兄弟目录、其他连接不在范围内', async () => {
    const a = ready([`sftp://${ID}/opt`])
    expect(await codeOf(a.check(`sftp://${ID}/opt2/a`))).toBe('IPC_FORBIDDEN')
    expect(await codeOf(a.check(`sftp://other/opt/a`))).toBe('IPC_FORBIDDEN')
  })

  it('身份根只放行同一身份；登录用户的根不放行身份', async () => {
    const a = ready([`sftp://app1@${ID}/opt/app1`])
    expect(await codeOf(a.check(`sftp://app1@${ID}/opt/app1/log`))).toBeNull()
    expect(await codeOf(a.check(`sftp://${ID}/opt/app1/log`))).toBe('IPC_FORBIDDEN')
    expect(await codeOf(a.check(`sftp://root@${ID}/opt/app1/log`))).toBe('IPC_FORBIDDEN')
  })

  it('连接根（sftp://ID）放行该连接登录用户的全部路径', async () => {
    const a = ready([`sftp://${ID}`])
    expect(await codeOf(a.check(`sftp://${ID}/etc/passwd`))).toBeNull()
    expect(await codeOf(a.check(`sftp://${ID}/`))).toBeNull()
  })

  it('经 .. / 编码的 / 逃出根的 URI 被拒绝', async () => {
    const a = ready([`sftp://${ID}/opt`])
    // URL 解析会消去 ..（结果为 /etc）
    expect(await codeOf(a.check(`sftp://${ID}/opt/../etc`))).toBe('IPC_FORBIDDEN')
    // %2F 解码后路径中出现 .. 段：服务器会解析到根之外
    expect(await codeOf(a.check(`sftp://${ID}/opt/a%2F..%2F..%2Fetc`))).toBe('IPC_FORBIDDEN')
    expect(await codeOf(a.check(`sftp://${ID}/opt/%2E%2E`))).toBe('IPC_FORBIDDEN')
    expect(await codeOf(a.check(`sftp://${ID}/opt/a%00b`))).toBe('IPC_FORBIDDEN')
  })

  it('scheme 的大小写与前导空白不能绕过检查（VfsService 经 URL 解析后仍路由到 sftp）', async () => {
    const a = ready([`sftp://${ID}/opt`])
    expect(await codeOf(a.check(`SFTP://${ID}/etc`))).toBe('IPC_FORBIDDEN')
    expect(await codeOf(a.check(` sftp://${ID}/etc`))).toBe('IPC_FORBIDDEN')
    expect(await codeOf(a.check(`Sftp://${ID}/opt/a`))).toBeNull()
  })

  it('无法解析的 sftp URI 为 IPC_FORBIDDEN', async () => {
    const a = ready([`sftp://${ID}/opt`])
    expect(await codeOf(a.check('sftp://'))).toBe('IPC_FORBIDDEN')
    expect(await codeOf(a.check(`sftp://bad%20id!@${ID}/opt`))).toBe('IPC_FORBIDDEN')
  })

  it('根中的结尾 / 与编码被规范化', async () => {
    const a = ready([`sftp://${ID}/opt/%E6%97%A5%E5%BF%97/`])
    expect(await codeOf(a.check(`sftp://${ID}/opt/%E6%97%A5%E5%BF%97/a`))).toBeNull()
  })

  it('setRoots 之前发起的 check 在 setRoots 之后才结束', async () => {
    const a = new RemoteAccess()
    let settled: string | null | undefined
    const p = codeOf(a.check(`sftp://${ID}/opt/a`)).then((c) => (settled = c))
    // file: 不等待
    expect(await codeOf(a.check('file:///C:/x'))).toBeNull()
    await new Promise((r) => setTimeout(r, 10))
    expect(settled).toBeUndefined()
    a.setRoots([`sftp://${ID}/opt`])
    await p
    expect(settled).toBeNull()
  })

  it('setRoots 替换根：移除的条目之下不再放行', async () => {
    const a = ready([`sftp://${ID}/opt`])
    a.setRoots([`sftp://${ID}/var`])
    expect(await codeOf(a.check(`sftp://${ID}/opt/a`))).toBe('IPC_FORBIDDEN')
    expect(await codeOf(a.check(`sftp://${ID}/var/log`))).toBeNull()
  })
})

describe('RemoteAccess：根的更新在途', () => {
  it('更新在途时对新根的 check 等到 setRoots 之后通过', async () => {
    const a = ready([`sftp://${ID}/opt`])
    const done = a.beginUpdate()
    let settled: string | null | undefined
    const p = codeOf(a.check(`sftp://${ID}/var/log`)).then((c) => (settled = c))
    // 已在范围内的不等待
    expect(await codeOf(a.check(`sftp://${ID}/opt/a`))).toBeNull()
    await new Promise((r) => setTimeout(r, 10))
    expect(settled).toBeUndefined()
    a.setRoots([`sftp://${ID}/opt`, `sftp://${ID}/var`])
    done()
    await p
    expect(settled).toBeNull()
  })

  it('更新结束后仍不在范围内 → IPC_FORBIDDEN', async () => {
    const a = ready([`sftp://${ID}/opt`])
    const done = a.beginUpdate()
    const p = codeOf(a.check(`sftp://${ID}/etc`))
    a.setRoots([`sftp://${ID}/opt`])
    done()
    expect(await p).toBe('IPC_FORBIDDEN')
  })

  it('多个更新在途：全部结束后才再判；done 重复调用无副作用', async () => {
    const a = ready([])
    const d1 = a.beginUpdate()
    const d2 = a.beginUpdate()
    let settled: string | null | undefined
    const p = codeOf(a.check(`sftp://${ID}/opt/a`)).then((c) => (settled = c))
    d1()
    d1()
    await new Promise((r) => setTimeout(r, 10))
    expect(settled).toBeUndefined()
    a.setRoots([`sftp://${ID}/opt`])
    d2()
    await p
    expect(settled).toBeNull()
  })

  it('filter：更新在途时范围外的等到更新结束后再判', async () => {
    const a = ready([`sftp://${ID}/opt`])
    const done = a.beginUpdate()
    const p = a.filter([`sftp://${ID}/opt/a`, `sftp://${ID}/var/log`, `sftp://${ID}/etc`])
    a.setRoots([`sftp://${ID}/opt`, `sftp://${ID}/var`])
    done()
    await expect(p).resolves.toEqual([`sftp://${ID}/opt/a`, `sftp://${ID}/var/log`])
  })

  it('没有更新在途时范围外照常立即拒绝', async () => {
    const a = ready([`sftp://${ID}/opt`])
    a.beginUpdate()() // 已结束的更新不影响
    let settled = false
    const p = a.check(`sftp://${ID}/etc`).catch((e: unknown) => {
      settled = true
      throw e
    })
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(settled).toBe(true)
    await expect(p).rejects.toMatchObject({ code: 'IPC_FORBIDDEN' })
  })
})

describe('RemoteAccess.filter', () => {
  it('丢弃范围外的 sftp URI，其余保持原样与顺序', async () => {
    const a = ready([`sftp://${ID}/opt`])
    await expect(
      a.filter([
        'file:///C:/a',
        `sftp://${ID}/etc`,
        `sftp://${ID}/opt/x`,
        `sftp://app1@${ID}/opt/x`,
        'file:///C:/b'
      ])
    ).resolves.toEqual(['file:///C:/a', `sftp://${ID}/opt/x`, 'file:///C:/b'])
  })

  it('没有 sftp URI 时不等待 setRoots', async () => {
    const a = new RemoteAccess()
    await expect(a.filter(['file:///C:/a'])).resolves.toEqual(['file:///C:/a'])
  })
})

describe('remoteFolderRoots', () => {
  const entry = (over: Partial<WorkspaceEntry>): WorkspaceEntry => ({
    id: 'e',
    workspaceId: 'w',
    parentId: null,
    kind: 'folder',
    label: 'x',
    uri: null,
    sortOrder: 0,
    meta: null,
    cacheStrategy: null,
    createdAt: 0,
    updatedAt: 0,
    ...over
  })

  it('只取 sftp: 的 folder 条目，规范化并去重', () => {
    expect(
      remoteFolderRoots([
        entry({ uri: `sftp://${ID}/opt/` }),
        entry({ uri: `sftp://${ID}/opt` }),
        entry({ uri: 'file:///C:/work' }),
        entry({ kind: 'file', uri: `sftp://${ID}/etc/hosts` }),
        entry({ kind: 'group', uri: null }),
        entry({ uri: `sftp://app1@${ID}/` })
      ])
    ).toEqual([`sftp://${ID}/opt`, `sftp://app1@${ID}`])
  })
})
