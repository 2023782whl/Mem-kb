export class CapacityExceededError extends Error {
  readonly statusCode = 429;
  readonly code = "CAPACITY_EXCEEDED";

  constructor(readonly retryAfterSeconds = 1) {
    super(`capacity exceeded, retry in ${retryAfterSeconds} seconds`);
    this.name = "CapacityExceededError";
  }
}

export class CircuitOpenError extends Error {
  readonly statusCode = 503;
  readonly code = "CIRCUIT_OPEN";

  constructor(readonly retryAfterSeconds: number) {
    super(`dependency unavailable, retry in ${retryAfterSeconds} seconds`);
    this.name = "CircuitOpenError";
  }
}

interface Waiter {
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class Bulkhead {
  private active = 0;
  private readonly waiting: Waiter[] = [];

  constructor(readonly concurrency: number, readonly maxQueue: number) {}

  get snapshot() {
    return { active: this.active, waiting: this.waiting.length, concurrency: this.concurrency };
  }

  async run<T>(operation: () => Promise<T>, signal?: AbortSignal) {
    await this.acquire(signal);
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private async acquire(signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason || new Error("operation aborted");
    if (this.active < this.concurrency) {
      this.active += 1;
      return;
    }
    if (this.waiting.length >= this.maxQueue) throw new CapacityExceededError();
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };
      waiter.onAbort = () => {
        const index = this.waiting.indexOf(waiter);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(signal?.reason || new Error("operation aborted"));
      };
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      this.waiting.push(waiter);
    });
  }

  private release() {
    const waiter = this.waiting.shift();
    if (waiter) {
      waiter.signal?.removeEventListener("abort", waiter.onAbort!);
      waiter.resolve();
      return;
    }
    this.active = Math.max(0, this.active - 1);
  }
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private probeRunning = false;

  constructor(readonly failureThreshold: number, readonly cooldownMs: number) {}

  beforeRequest(now = Date.now()) {
    if (!this.openedAt) return;
    const remaining = this.cooldownMs - (now - this.openedAt);
    if (remaining > 0) throw new CircuitOpenError(Math.max(1, Math.ceil(remaining / 1_000)));
    if (this.probeRunning) throw new CircuitOpenError(1);
    this.probeRunning = true;
  }

  success() {
    this.failures = 0;
    this.openedAt = 0;
    this.probeRunning = false;
  }

  failure(now = Date.now()) {
    this.probeRunning = false;
    this.failures += 1;
    if (this.failures >= this.failureThreshold) this.openedAt = now;
  }
}

export function retryAfterMs(value: string | null, now = Date.now()) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

export function backoffMs(attempt: number, baseMs: number, maxMs: number, random = Math.random) {
  const ceiling = Math.min(maxMs, baseMs * (2 ** Math.max(0, attempt - 1)));
  return Math.max(0, Math.round(ceiling * (0.5 + random() * 0.5)));
}

export async function waitFor(ms: number, signal?: AbortSignal) {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const done = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason || new Error("operation aborted"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
