// page.evaluate 的回调在渲染进程里运行：补上 preload 暴露的 window.pch 与 WCO 的类型
interface Window {
  /** preload 暴露的桥（e2e 只调用 invoke，其余按需读取键名） */
  pch?: {
    invoke: (channel: string, input?: unknown) => Promise<unknown>
    bootstrap?: { windowId?: string } & Record<string, unknown>
  } & Record<string, unknown>
}

interface Navigator {
  windowControlsOverlay?: { visible: boolean }
}
