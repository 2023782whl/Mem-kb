import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../../auth/context.js";
import { one, query } from "../../db/pool.js";
import type { Message, QaTrace, QaTraceEvent } from "../../db/schema.js";

const filtersSchema = z.object({
  status: z.enum(["running", "completed", "failed", "cancelled"]).optional(),
  rating: z.enum(["up", "down", "unrated"]).optional(),
  issueType: z.string().max(80).optional(),
  userId: z.string().optional(),
  source: z.enum(["web", "wechat"]).optional(),
  search: z.string().max(200).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

export async function registerTraceRoutes(app: FastifyInstance) {
  app.get("/api/traces", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const filters = filtersSchema.parse(request.query);
    const values: unknown[] = [user.tenant_id];
    const clauses = ["t.tenant_id = $1"];
    const add = (sql: string, value: unknown) => { values.push(value); clauses.push(sql.replace("?", `$${values.length}`)); };
    if (filters.status) add("t.status = ?", filters.status);
    if (filters.rating === "unrated") clauses.push("t.rating is null");
    else if (filters.rating) add("t.rating = ?", filters.rating);
    if (filters.issueType) add("t.issue_type = ?", filters.issueType);
    if (filters.userId) add("t.user_id = ?", filters.userId);
    if (filters.source) add("t.source = ?", filters.source);
    if (filters.search) {
      values.push(`%${filters.search}%`);
      clauses.push(`(t.question ilike $${values.length} or t.answer_preview ilike $${values.length})`);
    }
    values.push(filters.limit, filters.offset);
    const where = clauses.join(" and ");
    const items = await query<QaTrace & { user_name: string; workspace_name: string }>(
      `select t.*, u.name as user_name, w.name as workspace_name
         from qa_traces t join users u on u.id = t.user_id join workspaces w on w.id = t.workspace_id
        where ${where} order by t.created_at desc limit $${values.length - 1} offset $${values.length}`,
      values
    );
    const countValues = values.slice(0, -2);
    const total = await one<{ count: number }>(`select count(*)::int as count from qa_traces t where ${where}`, countValues);
    return { items, total: total?.count || 0, offset: filters.offset, limit: filters.limit };
  });

  app.get("/api/traces/:id", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const trace = await one<QaTrace & { user_name: string; workspace_name: string }>(
      `select t.*, u.name as user_name, w.name as workspace_name
         from qa_traces t join users u on u.id = t.user_id join workspaces w on w.id = t.workspace_id
        where t.id = $1 and t.tenant_id = $2`,
      [id, user.tenant_id]
    );
    if (!trace) return reply.code(404).send({ error: "trace_not_found", message: "Trace 不存在" });
    const [events, messages, citations] = await Promise.all([
      query<QaTraceEvent>(`select * from qa_trace_events where trace_id = $1 order by created_at`, [id]),
      trace.conversation_id ? query<Message>(`select * from messages where conversation_id = $1 order by created_at`, [trace.conversation_id]) : [],
      trace.conversation_id ? query(
        `select mc.* from message_citations mc join messages m on m.id = mc.message_id where m.conversation_id = $1 order by mc.created_at`,
        [trace.conversation_id]
      ) : []
    ]);
    return { trace, events, messages, citations };
  });
}
