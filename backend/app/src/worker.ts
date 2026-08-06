import { Worker } from "bullmq";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import { assetQueueName, workerRedisConnection, closeAssetQueue, type AssetQueueJob } from "./services/asset-queue.js";
import { processAsset, resumePendingAssetProcessing } from "./services/asset-processing.js";
import { cleanupRetrievalCaches } from "./services/cache-maintenance.js";
import {
  closeMaintenanceQueue, maintenanceQueueName, type MaintenanceQueueJob
} from "./services/maintenance-queue.js";
import {
  dispatchPendingConsolidations, executeConsolidationRun,
  startConsolidationScheduler, stopConsolidationScheduler
} from "./modules/consolidation/service.js";
import { startWechatChannels, stopWechatChannels, syncWechatChannels } from "./modules/channels/service.js";
import { logger } from "./utils/logger.js";

const worker = new Worker<AssetQueueJob>(
  assetQueueName,
  async (job) => processAsset(job.data.assetId, {
    attempt: job.attemptsMade + 1,
    maxAttempts: Number(job.opts.attempts || 1),
    processingId: job.data.processingId
  }),
  {
    connection: workerRedisConnection,
    concurrency: Number(process.env.ASSET_WORKER_CONCURRENCY || 2),
    lockDuration: Number(process.env.ASSET_WORKER_LOCK_MS || 300_000),
    maxStalledCount: 2
  }
);

const maintenanceWorker = new Worker<MaintenanceQueueJob>(
  maintenanceQueueName,
  async (job) => {
    if (job.data.type === "consolidation") return executeConsolidationRun(job.data.runId);
  },
  {
    connection: workerRedisConnection,
    concurrency: Number(process.env.MAINTENANCE_WORKER_CONCURRENCY || 1),
    lockDuration: Number(process.env.MAINTENANCE_WORKER_LOCK_MS || 15 * 60_000),
    maxStalledCount: 1
  }
);

let recovering = false;
async function recoverPending() {
  if (recovering) return;
  recovering = true;
  try {
    await resumePendingAssetProcessing();
  } finally {
    recovering = false;
  }
}

const recoveryTimer = setInterval(() => void recoverPending(), Number(process.env.ASSET_DISPATCH_INTERVAL_MS || 30_000));
recoveryTimer.unref();
const maintenanceTimer = setInterval(() => void cleanupRetrievalCaches().catch((error) => logger.error({ error }, "Retrieval cache cleanup failed")), 60 * 60_000);
maintenanceTimer.unref();
const channelTimer = setInterval(
  () => void syncWechatChannels().catch((error) => logger.error({ error }, "Wechat channel sync failed")),
  env.channels.syncIntervalMs
);
channelTimer.unref();

worker.on("ready", () => {
  logger.info("Mem-kb asset worker ready");
  void recoverPending();
});
worker.on("completed", (job) => logger.info({ assetId: job.data.assetId }, "Asset job completed"));
worker.on("failed", (job, error) => logger.error({ assetId: job?.data.assetId || "unknown", error: error.message }, "Asset job failed"));
maintenanceWorker.on("completed", (job) => logger.info({ runId: job.data.runId }, "Maintenance job completed"));
maintenanceWorker.on("failed", (job, error) => logger.error({ runId: job?.data.runId || "unknown", error: error.message }, "Maintenance job failed"));

let backgroundReady = false;
let bootTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;

async function bootBackgroundServices() {
  if (backgroundReady || shuttingDown) return;
  try {
    await startWechatChannels();
    await dispatchPendingConsolidations();
    startConsolidationScheduler();
    backgroundReady = true;
    logger.info("Mem-kb background services ready");
  } catch (error) {
    logger.error({ error }, "Background services unavailable; retrying");
    bootTimer = setTimeout(() => void bootBackgroundServices(), 5_000);
    bootTimer.unref();
  }
}

void bootBackgroundServices();

async function shutdown() {
  shuttingDown = true;
  if (bootTimer) clearTimeout(bootTimer);
  clearInterval(recoveryTimer);
  clearInterval(maintenanceTimer);
  clearInterval(channelTimer);
  stopConsolidationScheduler();
  await stopWechatChannels();
  await Promise.all([worker.close(), maintenanceWorker.close()]);
  await Promise.all([closeAssetQueue(), closeMaintenanceQueue()]);
  await pool.end();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
