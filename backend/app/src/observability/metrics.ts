import { Counter, Gauge, Histogram } from "prom-client";
import { assetQueueCounts } from "../services/asset-queue.js";
import { maintenanceQueueCounts } from "../services/maintenance-queue.js";
import { outboundSnapshots } from "../services/outbound.js";
import { qaAdmissionSnapshot } from "../modules/qa/admission.js";
export { metrics } from "./registry.js";
import { metrics } from "./registry.js";

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
  name: "aiteam_queue_jobs",
  help: "BullMQ jobs by queue and state",
  labelNames: ["queue", "state"] as const,
  registers: [metrics]
});

const workload = new Gauge({
  name: "aiteam_workload_concurrency",
  help: "Active and waiting workload by scope",
  labelNames: ["scope", "state"] as const,
  registers: [metrics]
});

export async function refreshRuntimeMetrics() {
  const counts = await Promise.race([
    Promise.all([assetQueueCounts(), maintenanceQueueCounts()]),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_000))
  ]);
  if (counts) {
    for (const [queue, values] of [["asset", counts[0]], ["maintenance", counts[1]]] as const) {
      for (const [state, value] of Object.entries(values)) queueJobs.set({ queue, state }, value);
    }
  }
  workload.reset();
  const qa = qaAdmissionSnapshot();
  workload.set({ scope: "qa", state: "active" }, qa.active);
  workload.set({ scope: "qa", state: "waiting" }, qa.waiting);
  for (const snapshot of outboundSnapshots()) {
    workload.set({ scope: snapshot.scope, state: "active" }, snapshot.active);
    workload.set({ scope: snapshot.scope, state: "waiting" }, snapshot.waiting);
  }
}
