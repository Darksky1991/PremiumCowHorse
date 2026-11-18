/** 主进程内部的类型化事件总线（同步分发） */
export class EventBus<Events extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof Events, Set<(payload: never) => void>>()

  on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void {
    let set = this.listeners.get(event)
    if (!set) this.listeners.set(event, (set = new Set()))
    set.add(listener as (payload: never) => void)
    return () => set.delete(listener as (payload: never) => void)
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      ;(listener as (payload: Events[K]) => void)(payload)
    }
  }
}
