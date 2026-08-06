import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { gbrainHealth } from "../../services/gbrain.js";
import { modelCatalog } from "../../services/model.js";
import { assetQueueCounts } from "../../services/asset-queue.js";
import { query } from "../../db/pool.js";

export async function registerSystemRoutes(app: FastifyInstance) {
  app.get("/api/health", async (_request, reply) => {
    let database: Record<string, unknown>;
    try {
      await query(`select 1 as ok`);
      database = { ok: true, name: env.database.name };
    } catch (error) {
      database = { ok: false, name: env.database.name, error: error instanceof Error ? error.message : "数据库不可用" };
    }
    let gbrain: Record<string, unknown>;
    try {
      gbrain = await gbrainHealth();
    } catch (error) {
      gbrain = { ok: false, error: error instanceof Error ? error.message : "GBrain 不可用" };
    }
    let queue: Record<string, unknown>;
    try {
      queue = { ok: true, ...(await assetQueueCounts()) };
    } catch (error) {
      queue = { ok: false, error: error instanceof Error ? error.message : "Redis 队列不可用" };
    }
    const ok = database.ok === true && gbrain.ok === true && queue.ok === true;
    return reply.code(ok ? 200 : 503).send({
      ok,
      name: "mem-kb-api",
      time: new Date().toISOString(),
      database,
      gbrain,
      queue,
      models: modelCatalog()
    });
  });

  app.get("/api/models", async () => ({ models: modelCatalog() }));
}
