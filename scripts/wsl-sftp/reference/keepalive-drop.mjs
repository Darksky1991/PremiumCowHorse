// 断线检测：连接后由外部终止 sshd / 实例，记录 ssh2 多久报告 close / error
import { Client } from 'ssh2'
const [port, ka] = process.argv.slice(2)
const c = new Client()
const t0 = Date.now()
c.on('ready', () => {
  console.log('ready; waiting for drop...')
  c.sftp((e) => console.log('sftp', e ? e.message : 'ok'))
})
c.on('error', (e) => console.log(`error after ${Date.now() - t0}ms: ${e.message} level=${e.level}`))
c.on('close', () => {
  console.log(`close after ${Date.now() - t0}ms`)
  process.exit(0)
})
c.connect({
  host: '127.0.0.1',
  port: Number(port),
  username: 'pchuser',
  password: 'Pch-pass1',
  keepaliveInterval: Number(ka),
  keepaliveCountMax: 3,
  hostVerifier: (key) => {
    console.log('host key bytes', key.length)
    return true
  }
})
setTimeout(() => {
  console.log('no drop detected in 120s')
  process.exit(1)
}, 120_000)
