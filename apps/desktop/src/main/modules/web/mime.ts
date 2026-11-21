/** 内置扩展名 → Content-Type 表（设计 5.3.4；不引入 mime 包）。文本类不带 charset：页面可能是 Shift_JIS，交给浏览器按 meta / 嗅探判断 */
const MIME_BY_EXT: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  map: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  xml: 'application/xml',
  wasm: 'application/wasm'
}

/** 按文件名（或路径）的扩展名取 Content-Type；未知为 application/octet-stream */
export function mimeOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1)
  const ext = base.slice(base.lastIndexOf('.') + 1).toLowerCase()
  return (base.includes('.') && MIME_BY_EXT[ext]) || 'application/octet-stream'
}
