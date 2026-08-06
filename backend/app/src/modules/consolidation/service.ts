import { one, query, runAsSystem, tx } from "../../db/pool.js";
import type { ConsolidationConfig, ConsolidationRun } from "../../db/schema.js";
import { rebuildWorkspaceRelations } from "../../services/knowledge-indexer.js";
import { enqueueConsolidation } from "../../services/maintenance-queue.js";
import { createId } from "../../utils/id.js";

let scheduler: NodeJS.Timeout | null = null;
let schedulerRunning = false;
const consolidationWorkerId = createId("consolidation_worker");
const CONSOLIDATION_LEASE_SECONDS = 10 * 60;

export function nextScheduledAt(scheduleTime: string, timezone: string, from = new Date()) {
  const [hour, minute] = scheduleTime.split(":").map(Number);
  const local = dateParts(from, timezone);
  let candidate = zonedDateToUtc(local.year, local.month, local.day, hour, minute, timezone);
  if (candidate.getTime() <= from.getTime()) {
    const nextDay = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
    candidate = zonedDateToUtc(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), hour, minute, timezone);
  }
  return candidate;
}

export function startConsolidationScheduler() {
  if (scheduler) return;
  const tick = async () => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
      await runAsSystem(runDueConsolidations);
    } finally {
      schedulerRunning = false;
    }
  };
  setTimeout(() => void tick().catch(() => undefined), 3_000).unref();
  scheduler = setInterval(() => void tick().catch(() => undefined), 60_000);
  scheduler.unref();
}

export function stopConsolidationScheduler() {
  if (scheduler) clearInterval(scheduler);
  scheduler = null;
  schedulerRunning = false;
}

export async function runDueConsolidations() {
  const configs = await query<ConsolidationConfig>(
    `select * from consolidation_configs where enabled = true and next_run_at <= now() order by next_run_at limit 10`
  );
  for (const config of configs) {
    const scheduledFor = config.next_run_at ? new Date(config.next_run_at) : new Date();
    const nextRun = nextScheduledAt(config.schedule_time, config.timezone, new Date(scheduledFor.getTime() + 1_000));
    const claimed = await query<{ id: string }>(
      `update consolidation_configs set next_run_at = $3, last_run_at = now(), updated_at = now()
        where id = $1 and next_run_at = $2 returning id`,
      [config.id, config.next_run_at, nextRun.toISOString()]
    );
    if (!claimed.length) continue;
    const scheduledKey = `${config.id}:${scheduledFor.toISOString()}`;
    await scheduleConsolidation(config.tenant_id, config.workspace_ids, "cron", scheduledKey).catch(() => undefined);
  }
  await dispatchPendingConsolidations();
}

export async function scheduleConsolidation(
  tenantId: string,
  requestedWorkspaceIds: string[],
  trigger: "manual" | "cron",
  scheduledKey: string | null = null
) {
  const workspaces = await query<{ id: string }>(
    `select id, name from workspaces
      where tenant_id = $1 and status = 'active' and (cardinality($2::text[]) = 0 or id = any($2))
      order by name`,
    [tenantId, requestedWorkspaceIds]
  );
  const workspaceIds = workspaces.map((item) => item.id);
  const run = await tx(async (client) => {
    await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`consolidation:${tenantId}`]);
    const active = (await client.query<ConsolidationRun>(
      `select * from consolidation_runs
        where tenant_id = $1 and status = 'running'
        order by created_at limit 1`,
      [tenantId]
    )).rows[0];
    if (active) return active;
    return (await client.query<ConsolidationRun>(
      `insert into consolidation_runs (id, tenant_id, trigger, workspace_ids, scheduled_key)
       values ($1,$2,$3,$4,$5)
       on conflict (tenant_id, scheduled_key) do nothing returning *`,
      [createId("consolidation"), tenantId, trigger, workspaceIds, scheduledKey]
    )).rows[0] || null;
  });
  if (!run) return null;
  await enqueueConsolidation(run.id).catch(async (error) => {
    await addLog(run.id, tenantId, "queue", "warning", error instanceof Error ? error.message : "后台队列暂不可用");
  });
  return run;
}

export async function dispatchPendingConsolidations() {
  const runs = await query<Pick<ConsolidationRun, "id">>(
    `select id from consolidation_runs
      where status = 'running'
      order by created_at limit 50`
  );
  await Promise.allSettled(runs.map((run) => enqueueConsolidation(run.id)));
}

export async function executeConsolidationRun(runId: string) {
  const run = await one<ConsolidationRun>(
    `update consolidation_runs
        set lease_owner = $2,
            lease_expires_at = now() + ($3 * interval '1 second')
      where id = $1 and status = 'running'
        and (lease_owner is null or lease_owner = $2 or lease_expires_at < now())
      returning *`,
    [runId, consolidationWorkerId, CONSOLIDATION_LEASE_SECONDS]
  );
  if (!run) return null;
  const tenantId = run.tenant_id;
  const workspaceIds = run.workspace_ids;
  const workspaces = await query<{ id: string; name: string }>(
    `select id, name from workspaces
      where tenant_id = $1 and status = 'active' and id = any($2::text[])
      order by name`,
    [tenantId, workspaceIds]
  );

  const heartbeat = setInterval(() => {
    void query(
      `update consolidation_runs
          set lease_expires_at = now() + ($3 * interval '1 second')
        where id = $1 and lease_owner = $2 and status = 'running'`,
      [run.id, consolidationWorkerId, CONSOLIDATION_LEASE_SECONDS]
    ).catch(() => undefined);
  }, 60_000);
  heartbeat.unref();
  try {
    const conversations = await one<{ count: number }>(
      `select count(*)::int as count from conversations
        where tenant_id = $1 and workspace_id = any($2) and updated_at >= now() - interval '90 days'`,
      [tenantId, workspaceIds]
    );
    const scanned = conversations?.count || 0;
    await addLog(run.id, tenantId, "conversation_scan", "info", `扫描 ${scanned} 条历史对话`, { workspaceIds });

    const broken = await query<{ id: string; title: string; workspace_id: string }>(
      `select mc.id, mc.title, c.workspace_id
         from message_citations mc
         join messages m on m.id = mc.message_id
         join conversations c on c.id = m.conversation_id
         join assets a on a.id = mc.asset_id
        where c.tenant_id = $1 and c.workspace_id = any($2)
          and mc.asset_id is not null and a.deleted_at is not null`,
      [tenantId, workspaceIds]
    );

    let repaired = 0;
    if (broken.length > 0) {
      // 批量查找替换资产，避免 N+1 查询
      const replacements = await query<{ citation_id: string; asset_id: string; title: string }>(
        `select DISTINCT ON (mc.id)
           mc.id as citation_id,
           a.id as asset_id,
           mc.title
         from unnest($1::text[], $2::text[], $3::text[]) as broken(citation_id, title, workspace_id)
         join message_citations mc on mc.id = broken.citation_id
         join assets a on lower(a.title) = lower(broken.title)
           and a.workspace_id = broken.workspace_id
           and a.tenant_id = $4
           and a.deleted_at is null
           and a.status = 'ready'
         order by mc.id, a.updated_at desc`,
        [
          broken.map(c => c.id),
          broken.map(c => c.title),
          broken.map(c => c.workspace_id),
          tenantId
        ]
      );

      const replacementMap = new Map(replacements.map(r => [r.citation_id, r.asset_id]));

      // 批量更新引用
      if (replacementMap.size > 0) {
        const citationIds = Array.from(replacementMap.keys());
        const assetIds = citationIds.map(id => replacementMap.get(id)!);

        await query(
          `update message_citations mc
           set asset_id = r.asset_id
           from (
             select unnest($1::text[]) as citation_id,
                    unnest($2::text[]) as asset_id
           ) r
           where mc.id = r.citation_id`,
          [citationIds, assetIds]
        );
        repaired = replacementMap.size;
      }

      // 对无法找到替换的引用，将 asset_id 设为 null
      const unrepairable = broken.filter(c => !replacementMap.has(c.id));
      if (unrepairable.length > 0) {
        await query(
          `update message_citations set asset_id = null where id = any($1::text[])`,
          [unrepairable.map(c => c.id)]
        );
      }
    }

    await addLog(
      run.id, tenantId, "citation_repair", broken.length ? "warning" : "info",
      broken.length ? `处理 ${repaired} 条失效引用，无法重连的引用已解除错误资产关联` : "引用检查通过"
    );

    let relations = 0;
    let organized = 0;
    for (const workspace of workspaces) {
      try {
        const rebuilt = await rebuildWorkspaceRelations(tenantId, workspace.id);
        relations += rebuilt.length;
        const nodes = await one<{ count: number }>(
          `select count(*)::int as count from graph_nodes where tenant_id = $1 and workspace_id = $2`,
          [tenantId, workspace.id]
        );
        organized += nodes?.count || 0;
        await addLog(run.id, tenantId, "knowledge_structure", "info", `${workspace.name}：整理 ${nodes?.count || 0} 个节点，生成 ${rebuilt.length} 条关系`);
      } catch (error) {
        await addLog(run.id, tenantId, "knowledge_structure", "warning", `${workspace.name}：${error instanceof Error ? error.message : "整理失败"}`);
      }
    }

    const [completed] = await query<ConsolidationRun>(
      `update consolidation_runs
          set status = 'completed', conversations_scanned = $2, relations_added = $3,
              citations_repaired = $4, structures_organized = $5, completed_at = now(),
              lease_owner = null, lease_expires_at = null
        where id = $1 and lease_owner = $6 returning *`,
      [run.id, scanned, relations, repaired, organized, consolidationWorkerId]
    );
    await addLog(run.id, tenantId, "complete", "info", "夜间巩固完成");
    return completed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "夜间巩固失败";
    await query(
      `update consolidation_runs
          set status = 'failed', error = $2, completed_at = now(), lease_owner = null, lease_expires_at = null
        where id = $1 and lease_owner = $3`,
      [run.id, message.slice(0, 2_000), consolidationWorkerId]
    );
    await addLog(run.id, tenantId, "failed", "error", message);
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

async function addLog(
  runId: string,
  tenantId: string,
  phase: string,
  level: "info" | "warning" | "error",
  message: string,
  metadata: Record<string, unknown> = {}
) {
  await query(
    `insert into consolidation_logs (id, tenant_id, run_id, phase, level, message, metadata)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [createId("consolidation_log"), tenantId, runId, phase, level, message.slice(0, 2_000), JSON.stringify(metadata)]
  );
}

function dateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value || 0);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

function zonedDateToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const actual = dateParts(guess, timezone);
  const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
  return new Date(guess.getTime() - (represented - guess.getTime()));
}
