import { Worker } from "bullmq";
import { pool } from "./db/pool.js";
import { redisConnection, closeAssetQueue } from "./services/asset-queue.js";
import { processAsset } from "./services/asset-processing.js";

const worker = new Worker<{ assetId: string }>(
  "aiteam-asset-processing",
  async (job) => processAsset(job.data.assetId),
  { connection: redisConnection, concurrency: Number(process.env.ASSET_WORKER_CONCURRENCY || 2) }
);

worker.on("ready", () => console.log("Mem-kb asset worker ready"));
worker.on("completed", (job) => console.log(`Asset job completed: ${job.data.assetId}`));
worker.on("failed", (job, error) => console.error(`Asset job failed: ${job?.data.assetId || "unknown"}`, error.message));

async function shutdown() {
  await worker.close();
  await closeAssetQueue();
  await pool.end();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
