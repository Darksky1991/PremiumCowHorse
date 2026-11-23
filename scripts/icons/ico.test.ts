import { describe, expect, it } from 'vitest'
import { encodeIco, pngSize } from './ico.mjs'

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

describe('pngSize', () => {
  const header = (w: number, h: number): Buffer => {
    const b = Buffer.alloc(33)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
    b.writeUInt32BE(13, 8)
    b.write('IHDR', 12, 'latin1')
    b.writeUInt32BE(w, 16)
    b.writeUInt32BE(h, 20)
    return b
  }

  it('读出 IHDR 的宽高（宽高不等也能区分）', () => {
    expect(pngSize(header(32, 39))).toEqual({ width: 32, height: 39 })
    expect(pngSize(header(256, 256))).toEqual({ width: 256, height: 256 })
  })

  it('非 PNG 时抛错', () => {
    expect(() => pngSize(Buffer.alloc(40))).toThrow()
  })
})
