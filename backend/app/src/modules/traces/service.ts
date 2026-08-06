import type { User } from "../../db/schema.js";
import { one, query } from "../../db/pool.js";
import { env } from "../../config/env.js";
import { createId } from "../../utils/id.js";

export interface TraceRequest {
  workspaceId: string;
  workspaceIds?: string[];
  question: string;
  modelId?: string;
  options?: Record<string, unknown>;
  source?: "web" | "wechat";
}

export async function startTrace(user: User, body: TraceRequest, workspaceIds: string[]) {
  const id = createId("trace");
  await query(
    `insert into qa_traces
      (id, tenant_id, workspace_id, workspace_ids, user_id, source, question, model_id, source_flags)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, user.tenant_id, body.workspaceId, workspaceIds, user.id, body.source || "web", body.question, body.modelId || env.model.id, JSON.stringify(body.options || {})]
  );
  return { id, startedAt: Date.now() };
}

export async function traceEvent(
  user: Pick<User, "tenant_id">,
  traceId: string,
  phase: string,
  status: "running" | "completed" | "failed" | "skipped",
  detail = "",
  durationMs?: number,
  metadata: Record<string, unknown> = {}
) {
  await query(
    `insert into qa_trace_events (id, tenant_id, trace_id, phase, status, detail, duration_ms, metadata)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [createId("trace_event"), user.tenant_id, traceId, phase, status, detail, durationMs ?? null, JSON.stringify(metadata)]
  );
}

export async function failTrace(traceId: string, error: unknown, startedAt: number, issueType = "model") {
  const message = error instanceof Error ? error.message : String(error || "unknown_error");
  const status = issueType === "cancelled" ? "cancelled" : "failed";
  await query(
    `update qa_traces
        set status = $2, issue_type = $3, error = $4, duration_ms = $5,
            completed_at = now(), updated_at = now()
      where id = $1`,
    [traceId, status, issueType, message.slice(0, 2_000), Date.now() - startedAt]
  );
}

export async function rateTraceForMessage(messageId: string, value: "up" | "down") {
  await query(
    `update qa_traces
        set rating = $2, issue_type = case when $2 = 'down' then 'user_feedback' else 'none' end, updated_at = now()
      where assistant_message_id = $1`,
    [messageId, value]
  );
}

export async function traceById(id: string, tenantId: string) {
  return one(`select * from qa_traces where id = $1 and tenant_id = $2`, [id, tenantId]);
}
