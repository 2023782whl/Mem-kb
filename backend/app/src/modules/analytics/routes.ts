import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../../auth/context.js";
import { assertWorkspace } from "../../auth/permissions.js";
import { query } from "../../db/pool.js";

export async function registerAnalyticsRoutes(app: FastifyInstance) {
  app.get("/api/analytics/insights", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { workspaceId } = z.object({ workspaceId: z.string() }).parse(request.query);
    await assertWorkspace(user, workspaceId, "read");
    const questions = await query<{ question: string; count: number }>(
      `select normalized_question as question, count(*)::int as count from query_events
       where tenant_id = $1 and workspace_id = $2 group by normalized_question order by count(*) desc, max(created_at) desc limit 8`,
      [user.tenant_id, workspaceId]
    );
    const documents = await query<{ asset_id: string; title: string; count: number }>(
      `select mc.asset_id, max(mc.title) as title, count(*)::int as count
       from message_citations mc join messages m on m.id = mc.message_id
       join conversations c on c.id = m.conversation_id
       where c.tenant_id = $1 and c.workspace_id = $2 and mc.asset_id is not null
       group by mc.asset_id order by count(*) desc limit 8`,
      [user.tenant_id, workspaceId]
    );
    return { questions, documents };
  });
}
