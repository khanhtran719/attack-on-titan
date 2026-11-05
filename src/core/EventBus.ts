type Listener<T = any> = (payload: T) => void;

export class EventBus {
  private listeners: Map<string, Set<Listener>> = new Map();

  public on<T = any>(event: string, listener: Listener<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  public off<T = any>(event: string, listener: Listener<T>): void {
    this.listeners.get(event)?.delete(listener);
  }

  public emit<T = any>(event: string, payload?: T): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      fn(payload);
    }
  }

  public clear(): void {
    this.listeners.clear();
  }
}

export const globalEvents = new EventBus();
