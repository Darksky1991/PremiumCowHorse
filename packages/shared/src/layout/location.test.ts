import { describe, expect, it } from 'vitest'
import { workspaceIdOfUri, workspaceLocation, workspaceUri } from './location'

describe('工作区总览的位置', () => {
  it('URI 为 pch-workspace:<id>，可以取回 id', () => {
    expect(workspaceUri('w1')).toBe('pch-workspace:w1')
    expect(workspaceIdOfUri('pch-workspace:w1')).toBe('w1')
    expect(workspaceLocation('w1', '保守')).toEqual({
      uri: 'pch-workspace:w1',
      kind: 'workspace',
      title: '保守'
    })
  })

  it('不是总览 URI（文件 URI、id 为空）时为 null', () => {
    expect(workspaceIdOfUri('file:///C:/a')).toBeNull()
    expect(workspaceIdOfUri('pch-workspace:')).toBeNull()
  })
})
