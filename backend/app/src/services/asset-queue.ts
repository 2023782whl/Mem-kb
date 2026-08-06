import { Queue, type ConnectionOptions } from "bullmq";
import { env } from "../config/env.js";

export const redisConnection: ConnectionOptions = {
  host: env.redis.host,
  port: env.redis.port,
  password: env.redis.password || undefined,
  db: env.redis.db,
  maxRetriesPerRequest: null
};

const assetQueue = new Queue<{ assetId: string }>("aiteam-asset-processing", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2_000 },
    removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 }
  }
});

export async function enqueueAssetProcessing(assetId: string) {
  await assetQueue.add("process", { assetId });
}

export async function assetQueueCounts() {
  return assetQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
}

export async function closeAssetQueue() {
  await assetQueue.close();
}
