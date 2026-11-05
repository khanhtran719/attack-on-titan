export class ObjectPool<T> {
  private available: T[] = [];
  private active: Set<T> = new Set();

  constructor(
    private factory: () => T,
    private resetFn: (item: T) => void,
    initialSize = 16
  ) {
    for (let i = 0; i < initialSize; i++) {
      this.available.push(this.factory());
    }
  }

  public acquire(): T {
    const item = this.available.length > 0 ? this.available.pop()! : this.factory();
    this.active.add(item);
    return item;
  }

  public release(item: T): void {
    if (this.active.delete(item)) {
      this.resetFn(item);
      this.available.push(item);
    }
  }

  public releaseAll(): void {
    for (const item of this.active) {
      this.resetFn(item);
      this.available.push(item);
    }
    this.active.clear();
  }

  public getActiveItems(): ReadonlySet<T> {
    return this.active;
  }
}
