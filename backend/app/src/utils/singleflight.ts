export class Singleflight<T> {
  private readonly pending = new Map<string, Promise<T>>();

  run(key: string, operation: () => Promise<T>) {
    const active = this.pending.get(key);
    if (active) return active;
    const promise = operation().finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
}
