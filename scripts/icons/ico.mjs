/**
 * 把若干 PNG 打包成 ICO（PNG 内嵌格式，Windows Vista 起支持）。
 * 纯函数：ICONDIR（6 字节）+ 每张图一个 ICONDIRENTRY（16 字节）+ 各图数据。
 * 宽高字节只有一个字节，256 写作 0。
 * @param {{ size: number; data: Buffer }[]} images
 * @returns {Buffer}
 */
export function encodeIco(images) {
  const headerLen = 6 + 16 * images.length
  const header = Buffer.alloc(headerLen)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)
  let offset = headerLen
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i
    const dim = size >= 256 ? 0 : size
    header[e] = dim // width
    header[e + 1] = dim // height
    header[e + 2] = 0 // palette
    header[e + 3] = 0 // reserved
    header.writeUInt16LE(1, e + 4) // planes
    header.writeUInt16LE(32, e + 6) // bit count
    header.writeUInt32LE(data.length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([header, ...images.map((i) => i.data)])
}

/**
 * 读取 PNG 的 IHDR 宽高（签名 8 字节 + 长度 4 + 'IHDR' 4，之后是大端宽、高）。
 * @param {Buffer} buf
 * @returns {{ width: number; height: number }}
 */
export function pngSize(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (
    buf.length < 24 ||
    !buf.subarray(0, 8).equals(sig) ||
    buf.toString('latin1', 12, 16) !== 'IHDR'
  ) {
    throw new Error('不是有效的 PNG')
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}
