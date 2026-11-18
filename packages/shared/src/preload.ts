// preload 专用的轻量入口：不引入 zod 等运行时依赖
export { IPC_EVENT, IPC_INVOKE, type EventEnvelope, type InvokeEnvelope } from './ipc/transport'
export { decodeBootstrapArg } from './ipc/bootstrap'
export type { PchBridge } from './ipc/contract'
