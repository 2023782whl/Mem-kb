import { describe, expect, it, vi } from "vitest";
import { backoffMs, Bulkhead, CircuitBreaker, CircuitOpenError, retryAfterMs } from "../src/utils/resilience.js";

describe("resilience", () => {
  it("bounds active work and rejects excess queueing", async () => {
    const bulkhead = new Bulkhead(1, 1);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const first = bulkhead.run(() => blocked);
    const second = bulkhead.run(async () => undefined);
    await expect(bulkhead.run(async () => undefined)).rejects.toMatchObject({ statusCode: 429 });
    release();
    await Promise.all([first, second]);
  });

  it("opens after repeated failures and permits a later probe", () => {
    const breaker = new CircuitBreaker(2, 1_000);
    breaker.failure(0);
    breaker.failure(10);
    expect(() => breaker.beforeRequest(100)).toThrow(CircuitOpenError);
    expect(() => breaker.beforeRequest(1_100)).not.toThrow();
    expect(() => breaker.beforeRequest(1_100)).toThrow(CircuitOpenError);
    breaker.success();
    expect(() => breaker.beforeRequest(1_101)).not.toThrow();
  });

  it("honors retry-after and bounded jitter", () => {
    expect(retryAfterMs("3")).toBe(3_000);
    expect(backoffMs(2, 200, 5_000, vi.fn(() => 0))).toBe(200);
    expect(backoffMs(2, 200, 5_000, vi.fn(() => 1))).toBe(400);
  });
});
