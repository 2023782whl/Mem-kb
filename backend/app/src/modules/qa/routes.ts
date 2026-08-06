import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit, requireUser } from "../../auth/context.js";
import { assertWorkspace } from "../../auth/permissions.js";
import { env } from "../../config/env.js";
import { one, query } from "../../db/pool.js";
import type { Asset, Citation, Conversation, Message } from "../../db/schema.js";
import { indexKnowledgeAsset } from "../../services/knowledge-indexer.js";
import { runKnowledgeAnswer, streamKnowledgeAnswer } from "../../services/model.js";
import { writeGeneratedMarkdown } from "../../services/storage.js";
import { createId, slugSegment } from "../../utils/id.js";
import { persistQaAnswer, prepareQa, type QaRequest } from "./service.js";
import { failTrace, rateTraceForMessage, traceEvent } from "../traces/service.js";

const askSchema = z.object({
  workspaceId: z.string(),
  workspaceIds: z.array(z.string()).min(1).max(20).optional(),
  assetIds: z.array(z.string()).max(30).optional(),
  question: z.string().min(1).max(8000),
  modelId: z.string().optional(),
  conversationId: z.string().optional(),
  options: z.object({ documentQa: z.boolean().optional(), webSearch: z.boolean().optional(), imageSearch: z.boolean().optional() }).optional()
});

function answerSlug(tenantId: string, workspaceId: string, assetId: string) {
  return `aiteam/${slugSegment(tenantId)}/workspace/${slugSegment(workspaceId)}/answers/${slugSegment(assetId)}`;
}

function sse(reply: { raw: NodeJS.WritableStream & { destroyed?: boolean; writableEnded?: boolean } }, event: string, data: unknown) {
  if (reply.raw.destroyed || reply.raw.writableEnded) return;
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function publicCitation(citation: Citation) {
  return {
    id: citation.id,
    message_id: citation.message_id,
    title: citation.title,
    snippet: citation.snippet,
    assetId: citation.asset_id,
    slug: citation.gbrain_slug,
    score: citation.score,
    kind: citation.kind,
    url: citation.url
  };
}

export async function registerQaRoutes(app: FastifyInstance) {
  app.get("/api/qa/conversations", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const params = z.object({ workspaceId: z.string().optional() }).parse(request.query);
    const values: unknown[] = [user.tenant_id, user.id];
    let sql = `select * from conversations where tenant_id = $1 and user_id = $2`;
    if (params.workspaceId) {
      await assertWorkspace(user, params.workspaceId, "read");
      values.push(params.workspaceId);
      sql += ` and workspace_id = $${values.length}`;
    }
    return { conversations: await query<Conversation>(`${sql} order by updated_at desc limit 40`, values) };
  });

  app.get("/api/qa/conversations/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const conversation = await one<Conversation>(
      `select * from conversations where id = $1 and tenant_id = $2 and user_id = $3`,
      [id, user.tenant_id, user.id]
    );
    if (!conversation) return reply.code(404).send({ error: "conversation_not_found", message: "会话不存在" });
    await assertWorkspace(user, conversation.workspace_id, "read");
    const [messages, citations] = await Promise.all([
      query<Message>(`select * from messages where conversation_id = $1 order by created_at`, [id]),
      query<Citation>(
        `select mc.* from message_citations mc join messages m on m.id = mc.message_id
         where m.conversation_id = $1 order by mc.created_at`,
        [id]
      )
    ]);
    const citationsByMessage = new Map<string, ReturnType<typeof publicCitation>[]>();
    for (const citation of citations) {
      const items = citationsByMessage.get(citation.message_id) || [];
      items.push(publicCitation(citation));
      citationsByMessage.set(citation.message_id, items);
    }
    return {
      conversation,
      messages: messages.map((message) => ({ ...message, citations: citationsByMessage.get(message.id) || [] }))
    };
  });

  app.delete("/api/qa/conversations/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const conversation = await one<Conversation>(
      `delete from conversations where id = $1 and tenant_id = $2 and user_id = $3 returning *`,
      [id, user.tenant_id, user.id]
    );
    if (!conversation) return reply.code(404).send({ error: "conversation_not_found", message: "会话不存在" });
    await audit(user, "qa.conversation.delete", "conversation", id, { workspaceId: conversation.workspace_id });
    return { ok: true };
  });

  app.post("/api/qa/ask", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const body = askSchema.parse(request.body) as QaRequest;
    const prepared = await prepareQa(user, body);
    try {
      const modelStartedAt = Date.now();
      await traceEvent(user, prepared.trace.id, "model", "running", `调用 ${body.modelId || env.model.id}`);
      const answer = await runKnowledgeAnswer(prepared.modelInput);
      await traceEvent(user, prepared.trace.id, "model", "completed", "模型生成完成", Date.now() - modelStartedAt);
      const assistantMessage = await persistQaAnswer(user, body, prepared, answer);
      return { conversation: prepared.conversation, userMessage: prepared.userMessage, assistantMessage, citations: prepared.citations, answer };
    } catch (error) {
      await traceEvent(user, prepared.trace.id, "model", "failed", error instanceof Error ? error.message : "模型调用失败");
      await failTrace(prepared.trace.id, error, prepared.trace.startedAt);
      return reply.code(502).send({ error: "model_call_failed", message: error instanceof Error ? error.message : "模型调用失败" });
    }
  });

  app.post("/api/qa/stream", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const body = askSchema.parse(request.body) as QaRequest;
    const prepared = await prepareQa(user, body);
    const origin = request.headers.origin;
    const allowedOrigins = new Set([env.frontendOrigin, "http://127.0.0.1:5177", "http://127.0.0.1:5178"]);
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      ...(origin && allowedOrigins.has(origin) ? { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", vary: "Origin" } : {})
    });
    sse(reply, "meta", { conversationId: prepared.conversation.id, userMessageId: prepared.userMessage.id, modelId: body.modelId });
    prepared.citations.forEach((citation, index) => sse(reply, "citation", { index: index + 1, ...citation }));
    const controller = new AbortController();
    reply.raw.once("close", () => {
      if (!reply.raw.writableEnded) controller.abort(new Error("client_disconnected"));
    });
    try {
      const modelStartedAt = Date.now();
      await traceEvent(user, prepared.trace.id, "model", "running", `流式调用 ${body.modelId || env.model.id}`);
      const answer = await streamKnowledgeAnswer(prepared.modelInput, (delta) => sse(reply, "delta", { text: delta }), controller.signal);
      await traceEvent(user, prepared.trace.id, "model", "completed", "流式生成完成", Date.now() - modelStartedAt);
      const assistantMessage = await persistQaAnswer(user, body, prepared, answer);
      sse(reply, "done", { assistantMessage, answer });
    } catch (error) {
      await traceEvent(user, prepared.trace.id, "model", controller.signal.aborted ? "skipped" : "failed", error instanceof Error ? error.message : "流式问答失败");
      await failTrace(prepared.trace.id, error, prepared.trace.startedAt, controller.signal.aborted ? "cancelled" : "model");
      if (!controller.signal.aborted) sse(reply, "error", { message: error instanceof Error ? error.message : "流式问答失败", recoverable: true });
    } finally {
      reply.raw.end();
    }
  });

  app.post("/api/qa/messages/:id/feedback", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const body = z.object({ value: z.enum(["up", "down"]) }).parse(request.body);
    const message = await one<Message>(
      `select m.* from messages m join conversations c on c.id = m.conversation_id
       where m.id = $1 and c.tenant_id = $2 and c.user_id = $3`,
      [id, user.tenant_id, user.id]
    );
    if (!message) return reply.code(404).send({ error: "message_not_found", message: "消息不存在" });
    const feedback = await one(
      `insert into feedback (id, message_id, user_id, value) values ($1,$2,$3,$4)
       on conflict (message_id, user_id) do update set value = excluded.value, created_at = now() returning *`,
      [createId("feedback"), id, user.id, body.value]
    );
    await rateTraceForMessage(id, body.value);
    await audit(user, "qa.feedback", "message", id, { value: body.value });
    return { feedback };
  });

  app.post("/api/qa/messages/:id/capture", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const body = z.object({ workspaceId: z.string(), title: z.string().min(1).max(120), content: z.string().min(1).max(200_000) }).parse(request.body);
    await assertWorkspace(user, body.workspaceId, "write");
    const sourceMessage = await one<Message>(
      `select m.* from messages m join conversations c on c.id = m.conversation_id
       where m.id = $1 and c.tenant_id = $2 and c.user_id = $3`,
      [id, user.tenant_id, user.id]
    );
    if (!sourceMessage) return reply.code(404).send({ error: "message_not_found", message: "消息不存在" });

    const citationRows = await query<Citation>(`select * from message_citations where message_id = $1 order by created_at`, [id]);
    const stored = await writeGeneratedMarkdown(body.title, body.content);
    const duplicate = await one<Asset>(
      `select * from assets where tenant_id = $1 and workspace_id = $2 and sha256 = $3 and deleted_at is null limit 1`,
      [user.tenant_id, body.workspaceId, stored.sha256]
    );
    if (duplicate) {
      fs.rmSync(stored.absolutePath, { force: true });
      return { asset: duplicate, deduplicated: true };
    }

    const assetId = createId("asset");
    const slug = answerSlug(user.tenant_id, body.workspaceId, assetId);
    const sourceAppendix = citationRows.length
      ? `\n\n## 来源引用\n${citationRows.map((item) => `- ${item.title}: ${item.snippet}${item.url ? ` (${item.url})` : ""}`).join("\n")}`
      : "";
    const asset = await one<Asset>(
      `insert into assets
       (id, tenant_id, workspace_id, owner_id, type, format, title, mime_type, size_bytes, storage_key,
        sha256, status, summary, extracted_text, gbrain_slug)
       values ($1,$2,$3,$4,'ai_answer','md',$5,'text/markdown',$6,$7,$8,'indexing',$9,$10,$11) returning *`,
      [assetId, user.tenant_id, body.workspaceId, user.id, body.title, stored.sizeBytes, stored.storageKey, stored.sha256, body.content.replace(/\s+/g, " ").slice(0, 100), body.content, slug]
    );
    try {
      const indexed = await indexKnowledgeAsset({ asset: asset!, title: body.title, body: body.content + sourceAppendix, sha256: stored.sha256, source: "aiteam-answer-capture" });
      const ready = await one<Asset>(`update assets set status = 'ready', summary = $1, updated_at = now() where id = $2 returning *`, [indexed.summary || asset!.summary, assetId]);
      const record = await one(
        `insert into capture_records (id, tenant_id, workspace_id, source_message_id, asset_id, status)
         values ($1,$2,$3,$4,$5,'ready') returning *`,
        [createId("capture"), user.tenant_id, body.workspaceId, id, assetId]
      );
      await audit(user, "qa.capture", "asset", assetId, { workspaceId: body.workspaceId, title: body.title });
      return { asset: ready, record };
    } catch (error) {
      const message = error instanceof Error ? error.message : "GBrain 写入失败";
      await query(`update assets set status = 'failed', error = $1, updated_at = now() where id = $2`, [message, assetId]);
      const record = await one(
        `insert into capture_records (id, tenant_id, workspace_id, source_message_id, asset_id, status, error)
         values ($1,$2,$3,$4,$5,'failed',$6) returning *`,
        [createId("capture"), user.tenant_id, body.workspaceId, id, assetId, message]
      );
      return reply.code(502).send({ error: "capture_failed", message, record });
    }
  });
}
