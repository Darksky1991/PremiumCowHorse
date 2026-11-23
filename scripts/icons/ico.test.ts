import { describe, expect, it } from 'vitest'
import { encodeIco } from './ico.mjs'

const png = (n: number, fill: number): Buffer => Buffer.alloc(n, fill)

describe('encodeIco', () => {
  const a = png(30, 1)
  const b = png(50, 2)
  const out = encodeIco([
    { size: 16, data: a },
    { size: 256, data: b }
  ])

  it('写出 ICONDIR 头（类型 1、2 张图）', () => {
    expect([...out.subarray(0, 6)]).toEqual([0, 0, 1, 0, 2, 0])
  })

  it('目录项的宽高：16 原样，256 写 0', () => {
    expect([out[6], out[7]]).toEqual([16, 16])
    expect([out[22], out[23]]).toEqual([0, 0])
  })

  it('偏移等于头加目录长度后的累计，大小与输入一致', () => {
    const base = 6 + 16 * 2
    expect(out.readUInt32LE(6 + 12)).toBe(base)
    expect(out.readUInt32LE(6 + 8)).toBe(a.length)
    expect(out.readUInt32LE(22 + 12)).toBe(base + a.length)
    expect(out.readUInt32LE(22 + 8)).toBe(b.length)
  })

  it('数据段与输入 PNG 逐字节相同', () => {
    const base = 6 + 16 * 2
    expect(out.subarray(base, base + a.length).equals(a)).toBe(true)
    expect(out.subarray(base + a.length).equals(b)).toBe(true)
  })
})
