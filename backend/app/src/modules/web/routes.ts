import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit, requireUser } from "../../auth/context.js";
import { assertWorkspace } from "../../auth/permissions.js";
import { one } from "../../db/pool.js";
import type { Asset } from "../../db/schema.js";
import { fetchWebPage } from "../../providers/web.js";
import { indexKnowledgeAsset } from "../../services/knowledge-indexer.js";
import { writeGeneratedMarkdown } from "../../services/storage.js";
import { createId, slugSegment } from "../../utils/id.js";

export async function registerWebRoutes(app: FastifyInstance) {
  app.post("/api/web/inspect", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const body = z.object({ workspaceId: z.string(), url: z.string().url(), persist: z.boolean().default(false) }).parse(request.body);
    await assertWorkspace(user, body.workspaceId, body.persist ? "write" : "read");
    let page;
    try {
      page = await fetchWebPage(body.url);
    } catch (error) {
      return reply.code(400).send({ error: "web_fetch_failed", message: error instanceof Error ? error.message : "网页解析失败" });
    }
    if (!body.persist) return { page };

    const assetId = createId("asset");
    const content = `# ${page.title}\n\n来源：${page.url}\n\n${page.markdown || page.snippet}`;
    const stored = await writeGeneratedMarkdown(page.title, content);
    const slug = `aiteam/${slugSegment(user.tenant_id)}/workspace/${slugSegment(body.workspaceId)}/web/${slugSegment(assetId)}`;
    const asset = await one<Asset>(
      `insert into assets
       (id, tenant_id, workspace_id, owner_id, type, format, title, mime_type, size_bytes, storage_key,
        sha256, status, summary, extracted_text, gbrain_slug, source_url)
       values ($1,$2,$3,$4,'webpage','md',$5,'text/markdown',$6,$7,$8,'indexing',$9,$10,$11,$12)
       returning *`,
      [assetId, user.tenant_id, body.workspaceId, user.id, page.title, stored.sizeBytes, stored.storageKey, stored.sha256, page.snippet.slice(0, 100), page.markdown || page.snippet, slug, page.url]
    );
    try {
      const indexed = await indexKnowledgeAsset({ asset: asset!, title: page.title, body: page.markdown || page.snippet, sha256: stored.sha256, source: "aiteam-web-capture" });
      const ready = await one<Asset>(`update assets set status = 'ready', summary = $1, updated_at = now() where id = $2 returning *`, [indexed.summary || page.snippet.slice(0, 100), assetId]);
      await audit(user, "web.capture", "asset", assetId, { workspaceId: body.workspaceId, url: page.url });
      return { page, asset: ready };
    } catch (error) {
      await one(`update assets set status = 'failed', error = $1, updated_at = now() where id = $2 returning id`, [error instanceof Error ? error.message : "网页入库失败", assetId]);
      throw error;
    }
  });
}
