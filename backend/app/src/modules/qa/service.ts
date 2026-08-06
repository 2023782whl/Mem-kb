import { audit } from "../../auth/context.js";
import { assertWorkspace } from "../../auth/permissions.js";
import { env } from "../../config/env.js";
import { one, query } from "../../db/pool.js";
import type { Asset, Conversation, Message, User } from "../../db/schema.js";
import { extractUrls, fetchWebPage, searchWeb } from "../../providers/web.js";
import { searchGBrain } from "../../services/gbrain.js";
import { searchImagesByText } from "../../services/image-search.js";
import { retrieveDocumentKnowledge } from "../../services/document-retrieval.js";
import type { AskInput, ModelCitation } from "../../services/model.js";
import { createId, slugSegment } from "../../utils/id.js";
import { listVerifiedFactText } from "../notes/repository.js";
import { attachTraceMessages, completeTrace, failTrace, startTrace, traceEvent } from "../traces/service.js";

export interface QaRequest {
  workspaceId: string;
  workspaceIds?: string[];
  assetIds?: string[];
  question: string;
  modelId?: string;
  conversationId?: string;
  options?: { documentQa?: boolean; webSearch?: boolean; imageSearch?: boolean };
  source?: "web" | "wechat";
}

export interface QaCitation extends ModelCitation {
  assetId?: string | null;
  score: number;
  kind: "document" | "image" | "web";
}

export class InvalidQaScopeError extends Error {
  override name = "InvalidQaScopeError";
}

function snippet(text: string, queryText: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const index = normalized.toLowerCase().indexOf(queryText.slice(0, 8).toLowerCase());
  return normalized.slice(Math.max(0, index > -1 ? index - 40 : 0), Math.max(0, index > -1 ? index - 40 : 0) + 220);
}

function gbrainCitation(row: Record<string, unknown>): QaCitation {
  const slug = String(row.slug || row.page_slug || "");
  return {
    title: String(row.title || slug || "GBrain 页面"),
    snippet: String(row.snippet || row.content || row.text || row.compiled_truth || "").slice(0, 220),
    slug,
    score: Number(row.score || row.rrf_score || 0),
    kind: "document"
  };
}

export async function prepareQa(user: User, body: QaRequest) {
  const startedAt = Date.now();
  const workspace = await assertWorkspace(user, body.workspaceId, "read");
  const workspaceIds = [...new Set([body.workspaceId, ...(body.workspaceIds || [])])];
  const scopedWorkspaces = await Promise.all(workspaceIds.map((id) => assertWorkspace(user, id, "read")));
  const trace = await startTrace(user, body, workspaceIds);
  await traceEvent(user, trace.id, "scope", "completed", `已授权 ${workspaceIds.length} 个知识库`, Date.now() - startedAt, { workspaceIds });
  return prepareQaContext({ user, body, workspace, workspaceIds, scopedWorkspaces, trace, startedAt })
    .catch(async (error) => {
      await traceEvent(user, trace.id, "retrieval", "failed", error instanceof Error ? error.message : "知识准备失败");
      await failTrace(trace.id, error, trace.startedAt, "retrieval");
      throw error;
    });
}

async function prepareQaContext({ user, body, workspace, workspaceIds, scopedWorkspaces, trace, startedAt }: {
  user: User;
  body: QaRequest;
  workspace: Awaited<ReturnType<typeof assertWorkspace>>;
  workspaceIds: string[];
  scopedWorkspaces: Array<Awaited<ReturnType<typeof assertWorkspace>>>;
  trace: { id: string; startedAt: number };
  startedAt: number;
}) {
  const retrievalStartedAt = Date.now();
  const prefixes = workspaceIds.map((id) => `aiteam/${slugSegment(user.tenant_id)}/workspace/${slugSegment(id)}/`);
  const citations: QaCitation[] = [];

  if (body.options?.documentQa !== false) {
    if (body.assetIds?.length) {
      const exactAssets = await query<Asset>(
        `select * from assets where tenant_id = $1 and id = any($2::text[]) and workspace_id = any($3::text[])
         and deleted_at is null and status = 'ready' order by updated_at desc`,
        [user.tenant_id, body.assetIds, workspaceIds]
      );
      if (exactAssets.length !== new Set(body.assetIds).size) throw new InvalidQaScopeError("指定文件不存在、未就绪或无权访问");
      citations.push(...exactAssets.map((asset) => ({
        title: asset.title,
        snippet: (asset.extracted_text || asset.summary || `${asset.title}（文件仍在解析中）`).slice(0, 4_000),
        slug: asset.gbrain_slug,
        assetId: asset.id,
        score: 1,
        kind: asset.type === "image" ? "image" as const : "document" as const
      })));
    } else {
      try {
        const hitGroups = await Promise.all(workspaceIds.map((id) => retrieveDocumentKnowledge(user.tenant_id, id, body.question)));
        const hits = hitGroups.flat();
        citations.push(...hits.map((hit) => ({
          title: hit.title,
          snippet: hit.content.slice(0, 700),
          slug: hit.slug,
          assetId: hit.assetId,
          score: hit.score,
          kind: "document" as const
        })));
        if (!hits.length) {
          const rows = await searchGBrain(body.question, 30);
          citations.push(...rows.filter((row) => prefixes.some((prefix) => String(row.slug || row.page_slug || "").startsWith(prefix))).map(gbrainCitation));
        }
      } catch {
        const assets = await query<Asset>(
          `select * from assets where tenant_id = $1 and workspace_id = any($2::text[]) and deleted_at is null and status = 'ready'
           order by case when title ilike $3 then 0 else 1 end, updated_at desc limit 12`,
          [user.tenant_id, workspaceIds, `%${body.question.slice(0, 20)}%`]
        );
        citations.push(...assets.map((asset) => ({
          title: asset.title,
          snippet: snippet(asset.extracted_text || asset.summary || asset.title, body.question),
          slug: asset.gbrain_slug,
          assetId: asset.id,
          score: 0.5,
          kind: asset.type === "image" ? "image" as const : "document" as const
        })));
      }
    }
  }

  if (body.options?.imageSearch) {
    try {
      const images = (await Promise.all(workspaceIds.map((id) => searchImagesByText(user.tenant_id, id, body.question)))).flat();
      citations.push(...images.slice(0, 5).map((asset) => ({
        title: asset.title,
        snippet: asset.summary || asset.extracted_text || "图片素材",
        slug: asset.gbrain_slug,
        assetId: asset.id,
        score: Number(asset.similarity || 0),
        kind: "image" as const
      })));
    } catch {
      // Image search remains optional when its provider is unavailable.
    }
  }

  const urls = extractUrls(body.question);
  for (const url of urls) {
    try {
      const page = await fetchWebPage(url);
      citations.push({ title: page.title, snippet: page.snippet, url: page.url, score: 1, kind: "web" });
    } catch {
      // Invalid or private links are intentionally excluded from context.
    }
  }
  if (body.options?.webSearch) {
    try {
      const results = await searchWeb(body.question.replace(/https?:\/\/\S+/g, " "), 5);
      citations.push(...results.map((item) => ({ ...item, score: 0.4, kind: "web" as const })));
    } catch {
      // The answer still proceeds with authorized local knowledge.
    }
  }

  const deduped = citations
    .filter((item, index, list) => list.findIndex((next) => (next.url || next.slug || next.assetId || next.title) === (item.url || item.slug || item.assetId || item.title)) === index)
    .sort((left, right) => right.score - left.score)
    .slice(0, 20);
  const evidenceContext = deduped.map((item, index) => `[${index + 1}] (${item.kind}) ${item.title}\n${item.snippet}\n${item.url || item.slug || "local"}`).join("\n\n");
  const verifiedFacts = (await Promise.all(workspaceIds.map((id) => listVerifiedFactText(user.tenant_id, id)))).flat();
  const context = [
    evidenceContext,
    verifiedFacts.length ? `# 已确认长期事实\n${verifiedFacts.map((fact) => `- ${fact}`).join("\n")}` : ""
  ].filter(Boolean).join("\n\n");
  await traceEvent(user, trace.id, "retrieval", "completed", `召回 ${deduped.length} 条来源与 ${verifiedFacts.length} 条事实`, Date.now() - retrievalStartedAt, {
    citations: deduped.length,
    documents: deduped.filter((item) => item.kind === "document").length,
    images: deduped.filter((item) => item.kind === "image").length,
    web: deduped.filter((item) => item.kind === "web").length
  });

  let conversation = body.conversationId
    ? await one<Conversation>(
      `select * from conversations where id = $1 and tenant_id = $2 and user_id = $3 and workspace_id = $4`,
      [body.conversationId, user.tenant_id, user.id, body.workspaceId]
    )
    : null;
  const history = conversation
    ? await query<Message>(
      `select * from (
         select * from messages where conversation_id = $1 order by created_at desc limit 12
       ) recent order by created_at`,
      [conversation.id]
    )
    : [];
  if (!conversation) {
    conversation = await one<Conversation>(
      `insert into conversations (id, tenant_id, workspace_id, user_id, title, model_id)
       values ($1,$2,$3,$4,$5,$6) returning *`,
      [createId("conversation"), user.tenant_id, body.workspaceId, user.id, body.question.slice(0, 40), body.modelId || env.model.id]
    );
  }
  const userMessage = await one<Message>(
    `insert into messages (id, conversation_id, role, content) values ($1,$2,'user',$3) returning *`,
    [createId("message"), conversation!.id, body.question]
  );
  await attachTraceMessages(trace.id, conversation!.id, userMessage!.id);
  await traceEvent(user, trace.id, "conversation", "completed", history.length ? `载入 ${history.length} 条历史消息` : "创建新会话", undefined, { conversationId: conversation!.id });
  const modelInput: AskInput = {
    question: body.question,
    workspaceName: scopedWorkspaces.map((item) => item.name).join("、"),
    modelId: body.modelId,
    context,
    citations: deduped,
    history: history.map((message) => ({ role: message.role, content: message.content }))
  };
  return { workspace, conversation: conversation!, userMessage: userMessage!, citations: deduped, modelInput, startedAt, trace };
}

export async function persistQaAnswer(user: User, body: QaRequest, prepared: Awaited<ReturnType<typeof prepareQa>>, answer: string) {
  const assistantMessage = await one<Message>(
    `insert into messages (id, conversation_id, role, content, model_id) values ($1,$2,'assistant',$3,$4) returning *`,
    [createId("message"), prepared.conversation.id, answer, body.modelId || env.model.id]
  );
  for (const item of prepared.citations) {
    await query(
      `insert into message_citations (id, message_id, asset_id, gbrain_slug, title, snippet, score, kind, url)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [createId("citation"), assistantMessage!.id, item.assetId || null, item.slug || null, item.title, item.snippet, item.score, item.kind, item.url || null]
    );
  }
  await query(`update conversations set updated_at = now() where id = $1`, [prepared.conversation.id]);
  await query(
    `insert into query_events
     (id, tenant_id, workspace_id, user_id, conversation_id, normalized_question, model_id, source_flags, latency_ms)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [createId("query"), user.tenant_id, body.workspaceId, user.id, prepared.conversation.id, body.question.replace(/\s+/g, " ").trim(), body.modelId || env.model.id, JSON.stringify(body.options || {}), Date.now() - prepared.startedAt]
  );
  await audit(user, "qa.ask", "workspace", body.workspaceId, { modelId: body.modelId || env.model.id, citations: prepared.citations.length });
  await traceEvent(user, prepared.trace.id, "persistence", "completed", "回答、引用与统计已保存");
  await completeTrace(prepared.trace.id, assistantMessage!.id, answer, prepared.citations.length, prepared.trace.startedAt);
  return assistantMessage!;
}
