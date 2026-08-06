import { performance } from "node:perf_hooks";

const baseUrl = process.env.LOAD_BASE_URL || "http://127.0.0.1:8788";
const path = process.env.LOAD_PATH || "/api/live";
const concurrency = positiveInt("LOAD_CONCURRENCY", 20);
const durationMs = positiveInt("LOAD_DURATION_MS", 10_000);
const timeoutMs = positiveInt("LOAD_TIMEOUT_MS", 3_000);
const maxErrorRate = number("LOAD_MAX_ERROR_RATE", 0.01);
const maxP95Ms = positiveInt("LOAD_MAX_P95_MS", 500);
const deadline = performance.now() + durationMs;
const latencies = [];
let completed = 0;
let failed = 0;

await Promise.all(Array.from({ length: concurrency }, runClient));

latencies.sort((left, right) => left - right);
const errorRate = completed + failed ? failed / (completed + failed) : 1;
const summary = {
  url: new URL(path, baseUrl).toString(),
  concurrency,
  durationMs,
  requests: completed + failed,
  qps: round((completed + failed) / (durationMs / 1_000)),
  errorRate: round(errorRate),
  latencyMs: {
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99)
  }
};

console.log(JSON.stringify(summary, null, 2));
if (errorRate > maxErrorRate || summary.latencyMs.p95 > maxP95Ms) process.exitCode = 1;

async function runClient() {
  while (performance.now() < deadline) {
    const startedAt = performance.now();
    try {
      const response = await fetch(new URL(path, baseUrl), { signal: AbortSignal.timeout(timeoutMs) });
      await response.arrayBuffer();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      completed += 1;
      latencies.push(performance.now() - startedAt);
    } catch {
      failed += 1;
    }
  }
}

function percentile(value) {
  if (!latencies.length) return 0;
  return round(latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * value) - 1)]);
}

function positiveInt(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function number(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

function round(value) {
  return Math.round(value * 1_000) / 1_000;
}
