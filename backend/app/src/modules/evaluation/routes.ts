import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../../auth/context.js";
import { assertWorkspace } from "../../auth/permissions.js";
import { one, query } from "../../db/pool.js";
import type { RagEvaluationRun } from "../../db/schema.js";
import { runRagEvaluation } from "./service.js";

export async function registerEvaluationRoutes(app: FastifyInstance) {
  app.get("/api/evaluations", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const { workspaceId } = z.object({ workspaceId: z.string().optional() }).parse(request.query);
    const values: unknown[] = [user.tenant_id];
    const scope = workspaceId ? "and r.workspace_id = $2" : "";
    if (workspaceId) {
      await assertWorkspace(user, workspaceId, "read");
      values.push(workspaceId);
    }
    const runs = await query<RagEvaluationRun & { workspace_name: string }>(
      `select r.*, w.name as workspace_name from rag_evaluation_runs r
       join workspaces w on w.id = r.workspace_id
       where r.tenant_id = $1 ${scope} order by r.created_at desc limit 30`,
      values
    );
    return { runs };
  });

  app.get("/api/evaluations/:id", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const run = await one<RagEvaluationRun & { workspace_name: string }>(
      `select r.*, w.name as workspace_name from rag_evaluation_runs r
       join workspaces w on w.id = r.workspace_id where r.id = $1 and r.tenant_id = $2`,
      [id, user.tenant_id]
    );
    if (!run) return reply.code(404).send({ error: "evaluation_not_found", message: "评测记录不存在" });
    const queries = await query(
      `select q.*,
              coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title)) from assets a where a.id = any(q.hit_document_ids)), '[]'::jsonb) as hit_documents,
              coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title)) from assets a where a.id = any(q.missed_document_ids)), '[]'::jsonb) as missed_documents
       from rag_evaluation_queries q where q.run_id = $1 order by q.created_at`,
      [id]
    );
    return { run, queries };
  });

  app.post("/api/evaluations/run", async (request, reply) => {
    const user = await requireAdmin(request, reply);
    if (!user) return;
    const { workspaceId } = z.object({ workspaceId: z.string() }).parse(request.body);
    await assertWorkspace(user, workspaceId, "read");
    return { run: await runRagEvaluation(user, workspaceId) };
  });
}
