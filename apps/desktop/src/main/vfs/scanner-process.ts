import { utilityProcess } from 'electron'
import scannerPath from '../../scanner/main?modulePath'
import type { Logger } from '../infra/logger'
import type { ScannerPort } from './scanner-client'

/**
 * 扫描进程的 libuv 线程池大小。koffi 的异步调用与 fs 都在线程池中执行，卡住的网络调用会一直
 * 占着线程（被中止也无法真正取消），默认的 4 个太少。必须在进程启动时经环境变量设置；
 * 调度器在扫描进程中读取同一个值作为并发上限（knowledge/electron.md）。
 */
export const SCANNER_THREADPOOL_SIZE = 16

/** 启动扫描进程（utilityProcess）。stdout / stderr 转写到主进程日志 */
export function forkScanner(log: Logger): ScannerPort {
  const child = utilityProcess.fork(scannerPath, [], {
    serviceName: 'pch-scanner',
    stdio: 'pipe',
    env: { ...process.env, UV_THREADPOOL_SIZE: String(SCANNER_THREADPOOL_SIZE) }
  })
  child.stdout?.on('data', (d: Buffer) => log.info(`[scanner:stdout] ${String(d).trimEnd()}`))
  child.stderr?.on('data', (d: Buffer) => log.warn(`[scanner:stderr] ${String(d).trimEnd()}`))
  return child
}
