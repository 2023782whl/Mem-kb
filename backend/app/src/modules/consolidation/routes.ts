import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../../auth/context.js";
import { assertWorkspace } from "../../auth/permissions.js";
import { one, query, runAsSystem } from "../../db/pool.js";
import type { ConsolidationConfig, ConsolidationRun } from "../../db/schema.js";
import { createId } from "../../utils/id.js";
import { nextScheduledAt, scheduleConsolidation } from "./service.js";

const configSchema = z.object({
  enabled: z.boolean(),
  scheduleTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  workspaceIds: z.array(z.string()).max(100)
});

export async function registerConsolidationRoutes(app: FastifyInstance) {
  app.get("/api/consolidation", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const config = await ensureConfig(user.tenant_id);
    const runs = await query<ConsolidationRun>(
      `select * from consolidation_runs where tenant_id = $1 order by created_at desc limit 20`,
      [user.tenant_id]
    );
    const runIds = runs.map((item) => item.id);
    const logs = runIds.length ? await query(
      `select * from consolidation_logs where tenant_id = $1 and run_id = any($2) order by created_at desc limit 200`,
      [user.tenant_id, runIds]
    ) : [];
    return { config, runs, logs };
  });

  app.put("/api/consolidation", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const body = configSchema.parse(request.body);
    await Promise.all(body.workspaceIds.map((id) => assertWorkspace(user, id, "read")));
    const nextRun = body.enabled ? nextScheduledAt(body.scheduleTime, "Asia/Shanghai") : null;
    const [config] = await query<ConsolidationConfig>(
      `insert into consolidation_configs
        (id, tenant_id, enabled, schedule_time, timezone, workspace_ids, updated_by, next_run_at)
       values ($1,$2,$3,$4,'Asia/Shanghai',$5,$6,$7)
       on conflict (tenant_id) do update
         set enabled = excluded.enabled, schedule_time = excluded.schedule_time,
             workspace_ids = excluded.workspace_ids, updated_by = excluded.updated_by,
             next_run_at = excluded.next_run_at, updated_at = now()
       returning *`,
      [createId("consolidation_config"), user.tenant_id, body.enabled, body.scheduleTime, body.workspaceIds, user.id, nextRun?.toISOString() || null]
    );
    return { config };
  });

  app.post("/api/consolidation/run", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const config = await ensureConfig(user.tenant_id);
    await Promise.all(config.workspace_ids.map((id) => assertWorkspace(user, id, "read")));
    const run = await runAsSystem(() => scheduleConsolidation(user.tenant_id, config.workspace_ids, "manual"));
    return reply.code(202).send({ run });
  });
}

async function ensureConfig(tenantId: string) {
  const existing = await one<ConsolidationConfig>(`select * from consolidation_configs where tenant_id = $1`, [tenantId]);
  if (existing) return existing;
  const [created] = await query<ConsolidationConfig>(
    `insert into consolidation_configs (id, tenant_id) values ($1,$2)
     on conflict (tenant_id) do update set updated_at = consolidation_configs.updated_at returning *`,
    [createId("consolidation_config"), tenantId]
  );
  return created;
}
