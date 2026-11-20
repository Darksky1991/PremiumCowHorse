import { describe, expect, it } from 'vitest'
import { SEARCH_TOTAL_CAP, type SearchHit } from '@pch/shared'
import { formatTotal, locationParts, relativeTime } from './format'

const MIN = 60_000

describe('relativeTime', () => {
  const now = Date.UTC(2026, 10, 19, 12, 0, 0)

  it('1 分钟以内为 null（由调用方显示「刚刚」）', () => {
    expect(relativeTime(now, now, 'en')).toBeNull()
    expect(relativeTime(now - 59_000, now, 'en')).toBeNull()
    // 时钟回拨（未来时刻）也按刚刚处理
    expect(relativeTime(now + 5 * MIN, now, 'en')).toBeNull()
  })

  it('按当前语言选择分钟 / 小时 / 天', () => {
    expect(relativeTime(now - 3 * MIN, now, 'en')).toBe('3 minutes ago')
    expect(relativeTime(now - 3 * MIN, now, 'ja')).toBe('3 分前')
    expect(relativeTime(now - 3 * MIN, now, 'zh-CN')).toBe('3分钟前')
    expect(relativeTime(now - 2 * 60 * MIN, now, 'en')).toBe('2 hours ago')
    expect(relativeTime(now - 3 * 24 * 60 * MIN, now, 'en')).toBe('3 days ago')
  })
})

describe('formatTotal', () => {
  it('千位分隔；达到上限时加「+」', () => {
    expect(formatTotal(1234, 'en')).toBe('1,234')
    expect(formatTotal(SEARCH_TOTAL_CAP, 'ja')).toBe('10,000+')
  })
})

describe('locationParts', () => {
  const hit = (relativePath: string): SearchHit => ({
    uri: 'file:///C:/x',
    name: relativePath.split('/').at(-1) ?? '',
    kind: 'file',
    size: 0,
    mtime: 0,
    hidden: false,
    entryId: 'e',
    relativePath
  })

  it('条目标签 + 父目录各段（不含命中项自身），最后一段单独给出以便中间省略', () => {
    expect(locationParts(hit('設計書/第10章/a.xlsx'), '案件A')).toEqual({
      head: '案件A › 設計書',
      tail: '第10章'
    })
    expect(locationParts(hit('設計書/a.xlsx'), '案件A')).toEqual({
      head: '案件A',
      tail: '設計書'
    })
  })

  it('直接位于条目根下、或固定的单个文件条目（relativePath 为空）时只有条目标签', () => {
    expect(locationParts(hit('a.xlsx'), '案件A')).toEqual({ head: '案件A', tail: null })
    expect(locationParts(hit(''), '仕様.xlsx')).toEqual({ head: '仕様.xlsx', tail: null })
  })
})
