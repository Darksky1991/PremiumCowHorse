import type { DocChangedEvent, DocProgressEvent, SniffInfo } from '@pch/shared'
import { call, subscribe } from '@renderer/lib/ipc'

/**
 * 文本文档（doc.*）的事件订阅：预览宿主（features/preview/doc-session.ts）按 docId 分发。
 * 主进程只把事件发给文档所属的窗口
 */
export const docEvents = {
  onProgress: (listener: (event: DocProgressEvent) => void): (() => void) =>
    subscribe('doc.progress', listener),
  onChanged: (listener: (event: DocChangedEvent) => void): (() => void) =>
    subscribe('doc.changed', listener)
}

/** 读开头 8KB 判断文本 / 二进制 / 空文件（选择插件用；开-读-关） */
export async function sniffResource(uri: string): Promise<SniffInfo['kind']> {
  return (await call('vfs.sniff', { uri })).kind
}
