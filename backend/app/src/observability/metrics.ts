import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";
import { assetQueueCounts } from "../services/asset-queue.js";

export const metrics = new Registry();
collectDefaultMetrics({ register: metrics, prefix: "aiteam_" });

export const httpRequests = new Counter({
  name: "aiteam_http_requests_total",
  help: "HTTP requests by method, route and status",
  labelNames: ["method", "route", "status"] as const,
  registers: [metrics]
});

export const httpDuration = new Histogram({
  name: "aiteam_http_request_duration_seconds",
  help: "HTTP request latency",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 120],
  registers: [metrics]
});

const queueJobs = new Gauge({
  name: "aiteam_asset_queue_jobs",
  help: "Asset jobs by BullMQ state",
  labelNames: ["state"] as const,
  registers: [metrics]
});

export async function refreshQueueMetrics() {
  const counts = await assetQueueCounts();
  for (const [state, value] of Object.entries(counts)) queueJobs.set({ state }, value);
}
