import { Queue, type ConnectionOptions } from "bullmq";
import { env } from "../config/env.js";

export interface AssetQueueJob {
  assetId: string;
  processingId: string;
}

const redisBase: ConnectionOptions = {
  host: env.redis.host,
  port: env.redis.port,
  password: env.redis.password || undefined,
  db: env.redis.db
};

export const queueRedisConnection: ConnectionOptions = {
  ...redisBase,
  maxRetriesPerRequest: 1
};

export const workerRedisConnection: ConnectionOptions = {
  ...redisBase,
  maxRetriesPerRequest: null
};

export const assetQueueName = process.env.ASSET_QUEUE_NAME || "aiteam-asset-processing";

const assetQueue = new Queue<AssetQueueJob>(assetQueueName, {
  connection: queueRedisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2_000 },
    removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 }
  }
});

export async function enqueueAssetProcessing(assetId: string, processingId: string) {
  await assetQueue.add("process", { assetId, processingId }, { jobId: processingId });
}

export async function assetQueueCounts() {
  return assetQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
}

export async function closeAssetQueue() {
  await assetQueue.close();
}
