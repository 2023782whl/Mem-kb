import { Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export const metrics = new Registry();
collectDefaultMetrics({ register: metrics, prefix: "aiteam_" });

const dbPool = new Gauge({
  name: "aiteam_db_pool_connections",
  help: "PostgreSQL pool connections by state",
  labelNames: ["state"] as const,
  registers: [metrics]
});

export const dbAcquireDuration = new Histogram({
  name: "aiteam_db_pool_acquire_seconds",
  help: "Time spent waiting for a PostgreSQL connection",
  buckets: [0.001, 0.005, 0.01, 0.02, 0.05, 0.1, 0.3, 1, 3],
  registers: [metrics]
});

export const dbTransactionDuration = new Histogram({
  name: "aiteam_db_transaction_seconds",
  help: "Database transaction duration by outcome",
  labelNames: ["outcome"] as const,
  buckets: [0.001, 0.005, 0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30],
  registers: [metrics]
});

export function updateDbPoolMetrics(snapshot: { total: number; idle: number; waiting: number }) {
  dbPool.set({ state: "total" }, snapshot.total);
  dbPool.set({ state: "idle" }, snapshot.idle);
  dbPool.set({ state: "waiting" }, snapshot.waiting);
}
