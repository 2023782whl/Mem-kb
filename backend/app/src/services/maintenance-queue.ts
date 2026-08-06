import { Queue } from "bullmq";
import { queueRedisConnection } from "./asset-queue.js";

export interface MaintenanceQueueJob {
  type: "consolidation";
  runId: string;
}

export const maintenanceQueueName = process.env.MAINTENANCE_QUEUE_NAME || "aiteam-maintenance";

const maintenanceQueue = new Queue<MaintenanceQueueJob>(maintenanceQueueName, {
  connection: queueRedisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
    removeOnFail: { age: 14 * 24 * 60 * 60, count: 2_000 }
  }
});

export async function enqueueConsolidation(runId: string) {
  await maintenanceQueue.add("consolidation", { type: "consolidation", runId }, { jobId: runId });
}

export async function maintenanceQueueCounts() {
  return maintenanceQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
}

export async function closeMaintenanceQueue() {
  await maintenanceQueue.close();
}
