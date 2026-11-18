import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import {
  decodeBootstrapArg,
  IPC_EVENT,
  IPC_INVOKE,
  type EventEnvelope,
  type PchBridge
} from '@pch/shared/preload'

/**
 * 渲染端唯一的桥接 API（window.pch）。渲染端拿不到 ipcRenderer 本身：
 * 调用一律经 IPC_INVOKE 交给主进程，由主进程按契约校验通道与输入。
 * 运行在 sandbox 中，只能 require('electron')，不能使用 Buffer 等 Node API。
 */
const listeners = new Map<string, Set<(payload: unknown) => void>>()

ipcRenderer.on(IPC_EVENT, (_e: IpcRendererEvent, { event, payload }: EventEnvelope) => {
  listeners.get(event)?.forEach((listener) => listener(payload))
})

const bridge: PchBridge = {
  invoke: (channel, input) => ipcRenderer.invoke(IPC_INVOKE, { channel, input }),
  on: (event, listener) => {
    let set = listeners.get(event)
    if (!set) listeners.set(event, (set = new Set()))
    set.add(listener)
    return () => {
      set.delete(listener)
    }
  },
  // 拖入文件时取得真实路径
  getPathForFile: (file) => webUtils.getPathForFile(file),
  // 初始主题/语言/windowId，渲染端首帧同步读取，防止闪烁
  bootstrap: decodeBootstrapArg(process.argv)
}

contextBridge.exposeInMainWorld('pch', bridge)
