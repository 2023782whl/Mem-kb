import { env } from "../config/env.js";
import { backoffMs, Bulkhead, CircuitBreaker, retryAfterMs, waitFor } from "../utils/resilience.js";

interface FetchPolicy {
  timeoutMs: number;
  maxAttempts?: number;
  signal?: AbortSignal;
}

interface Guard {
  bulkhead: Bulkhead;
  breaker: CircuitBreaker;
}

const guards = new Map<string, Guard>();

function guardFor(scope: string) {
  let guard = guards.get(scope);
  if (!guard) {
    guard = {
      bulkhead: new Bulkhead(env.resilience.providerConcurrency, env.resilience.providerQueueLimit),
      breaker: new CircuitBreaker(env.resilience.breakerFailureThreshold, env.resilience.breakerCooldownMs)
    };
    guards.set(scope, guard);
  }
  return guard;
}

function transientStatus(status: number) {
  return status === 429 || status >= 500;
}

function retryableNetworkError(error: unknown, signal: AbortSignal) {
  if (signal.aborted) return false;
  return error instanceof TypeError || (error instanceof Error && ["ECONNRESET", "ECONNREFUSED", "EPIPE"].includes((error as Error & { code?: string }).code || ""));
}

export async function resilientFetch(scope: string, url: string, init: RequestInit, policy: FetchPolicy) {
  const guard = guardFor(scope);
  const signal = policy.signal
    ? AbortSignal.any([policy.signal, AbortSignal.timeout(policy.timeoutMs)])
    : AbortSignal.timeout(policy.timeoutMs);
  const maxAttempts = Math.max(1, policy.maxAttempts ?? 2);

  return guard.bulkhead.run(async () => {
    guard.breaker.beforeRequest();
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch(url, { ...init, signal });
        if (!transientStatus(response.status)) {
          guard.breaker.success();
          return response;
        }
        if (attempt === maxAttempts) {
          guard.breaker.failure();
          return response;
        }
        const delay = retryAfterMs(response.headers.get("retry-after"))
          ?? backoffMs(attempt, env.resilience.retryBaseMs, env.resilience.retryMaxMs);
        await response.body?.cancel().catch(() => undefined);
        await waitFor(delay, signal);
      } catch (error) {
        if (!retryableNetworkError(error, signal) || attempt === maxAttempts) {
          guard.breaker.failure();
          throw error;
        }
        await waitFor(backoffMs(attempt, env.resilience.retryBaseMs, env.resilience.retryMaxMs), signal);
      }
    }
    throw new Error("outbound request exhausted");
  }, signal);
}

export function outboundSnapshots() {
  return [...guards.entries()].map(([scope, guard]) => ({ scope, ...guard.bulkhead.snapshot }));
}
