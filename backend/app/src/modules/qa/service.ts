import { assertWorkspaces } from "../../auth/permissions.js";
import { env } from "../../config/env.js";
import { one, query, tx } from "../../db/pool.js";
import type { Asset, Conversation, Message, User } from "../../db/schema.js";
import { extractUrls, fetchWebPage, searchWeb } from "../../providers/web.js";
import { searchGBrain } from "../../services/gbrain.js";
import { searchImagesByText } from "../../services/image-search.js";
import { retrieveDocumentKnowledge } from "../../services/document-retrieval.js";
import type { AskInput, ModelCitation } from "../../services/model.js";
import { createId, slugSegment } from "../../utils/id.js";
import { mapWithConcurrency } from "../../utils/concurrency.js";
import { listVerifiedFactTextForWorkspaces } from "../notes/repository.js";
import { failTrace, startTrace, traceEvent } from "../traces/service.js";

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
  workspaceId?: string | null;
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
  const workspaceIds = [...new Set([body.workspaceId, ...(body.workspaceIds || [])])];
  if (workspaceIds.length > env.retrieval.maxWorkspaceScope) {
    throw new InvalidQaScopeError(`单次最多检索 ${env.retrieval.maxWorkspaceScope} 个知识库`);
  }
  const scopedWorkspaces = await assertWorkspaces(user, workspaceIds, "read");
  const workspace = scopedWorkspaces.find((item) => item.id === body.workspaceId)!;
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
  workspace: Awaited<ReturnType<typeof assertWorkspaces>>[number];
  workspaceIds: string[];
  scopedWorkspaces: Awaited<ReturnType<typeof assertWorkspaces>>;
  trace: { id: string; startedAt: number };
  startedAt: number;
}) {
  const retrievalStartedAt = Date.now();
  const prefixes = workspaceIds.map((id) => `aiteam/${slugSegment(user.tenant_id)}/workspace/${slugSegment(id)}/`);
  const documentPromise = (async (): Promise<QaCitation[]> => {
    if (body.options?.documentQa === false) return [];
    if (body.assetIds?.length) {
      const exactAssets = await query<Asset>(
        `select * from assets where tenant_id = $1 and id = any($2::text[]) and workspace_id = any($3::text[])
         and deleted_at is null and status = 'ready' order by updated_at desc`,
        [user.tenant_id, body.assetIds, workspaceIds]
      );
      if (exactAssets.length !== new Set(body.assetIds).size) throw new InvalidQaScopeError("指定文件不存在、未就绪或无权访问");
      return exactAssets.map((asset) => ({
        title: asset.title,
        snippet: (asset.extracted_text || asset.summary || `${asset.title}（文件仍在解析中）`).slice(0, 4_000),
        slug: asset.gbrain_slug,
        assetId: asset.id,
        workspaceId: asset.workspace_id,
        score: 1,
        kind: asset.type === "image" ? "image" as const : "document" as const
      }));
    }
    try {
      const hits = await retrieveDocumentKnowledge(user.tenant_id, workspaceIds, body.question);
      const local = hits.map((hit) => ({
          title: hit.title,
          snippet: hit.content.slice(0, 700),
          slug: hit.slug,
          assetId: hit.assetId,
          workspaceId: hit.workspaceId,
          score: hit.score,
          kind: "document" as const
        }));
      if (local.length) return local;
      const rows = await searchGBrain(body.question, 30);
      return rows.filter((row) => prefixes.some((prefix) => String(row.slug || row.page_slug || "").startsWith(prefix))).map(gbrainCitation);
    } catch {
      const assets = await query<Asset>(
        `select * from assets where tenant_id = $1 and workspace_id = any($2::text[]) and deleted_at is null and status = 'ready'
         order by case when title ilike $3 then 0 else 1 end, updated_at desc limit 12`,
        [user.tenant_id, workspaceIds, `%${body.question.slice(0, 20)}%`]
      );
      return assets.map((asset) => ({
        title: asset.title,
        snippet: snippet(asset.extracted_text || asset.summary || asset.title, body.question),
        slug: asset.gbrain_slug,
        assetId: asset.id,
        workspaceId: asset.workspace_id,
        score: 0.5,
        kind: asset.type === "image" ? "image" as const : "document" as const
      }));
    }
  })();

  const imagePromise = (async (): Promise<QaCitation[]> => {
    if (!body.options?.imageSearch) return [];
    try {
      const images = await searchImagesByText(user.tenant_id, workspaceIds, body.question);
      return images.slice(0, 5).map((asset) => ({
        title: asset.title,
        snippet: asset.summary || asset.extracted_text || "图片素材",
        slug: asset.gbrain_slug,
        assetId: asset.id,
        workspaceId: asset.workspace_id,
        score: Number(asset.similarity || 0),
        kind: "image" as const
      }));
    } catch {
      return [];
    }
  })();

  const pagePromise = mapWithConcurrency(extractUrls(body.question), 3, async (url): Promise<QaCitation | null> => {
    try {
      const page = await fetchWebPage(url);
      return { title: page.title, snippet: page.snippet, url: page.url, score: 1, kind: "web" };
    } catch {
      return null;
    }
  });

  const webPromise = (async (): Promise<QaCitation[]> => {
    if (!body.options?.webSearch) return [];
    try {
      const results = await searchWeb(body.question.replace(/https?:\/\/\S+/g, " "), 5);
      return results.map((item) => ({ ...item, score: 0.4, kind: "web" as const }));
    } catch {
      return [];
    }
  })();

  const [documents, images, pages, web, verifiedFacts] = await Promise.all([
    documentPromise,
    imagePromise,
    pagePromise,
    webPromise,
    listVerifiedFactTextForWorkspaces(user.tenant_id, workspaceIds)
  ]);
  const citations = [...documents, ...images, ...pages.filter((item): item is QaCitation => Boolean(item)), ...web];

  const deduped = citations
    .filter((item, index, list) => list.findIndex((next) => (next.url || next.slug || next.assetId || next.title) === (item.url || item.slug || item.assetId || item.title)) === index)
    .sort((left, right) => right.score - left.score)
    .slice(0, 20);
  const evidenceContext = deduped.map((item, index) => `[${index + 1}] (${item.kind}) ${item.title}\n${item.snippet}\n${item.url || item.slug || "local"}`).join("\n\n");
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

  const { conversation, history, userMessage } = await tx(async (client) => {
    let selected = body.conversationId
      ? (await client.query<Conversation>(
        `select * from conversations where id = $1 and tenant_id = $2 and user_id = $3 and workspace_id = $4`,
        [body.conversationId, user.tenant_id, user.id, body.workspaceId]
      )).rows[0] || null
      : null;
    if (selected) {
      selected = (await client.query<Conversation>(
        `update conversations set workspace_ids = $2, updated_at = now() where id = $1 returning *`,
        [selected.id, workspaceIds]
      )).rows[0];
    }
    const recent = selected
      ? (await client.query<Message>(
        `select * from (
           select * from messages where conversation_id = $1 order by created_at desc limit 12
         ) messages order by created_at`,
        [selected.id]
      )).rows
      : [];
    if (!selected) {
      selected = (await client.query<Conversation>(
        `insert into conversations (id, tenant_id, workspace_id, workspace_ids, user_id, title, model_id)
         values ($1,$2,$3,$4,$5,$6,$7) returning *`,
        [createId("conversation"), user.tenant_id, body.workspaceId, workspaceIds, user.id, body.question.slice(0, 40), body.modelId || env.model.id]
      )).rows[0];
    }
    const message = (await client.query<Message>(
      `insert into messages (id, conversation_id, role, content) values ($1,$2,'user',$3) returning *`,
      [createId("message"), selected.id, body.question]
    )).rows[0];
    await client.query(
      `update qa_traces set conversation_id = $2, user_message_id = $3, updated_at = now() where id = $1`,
      [trace.id, selected.id, message.id]
    );
    await client.query(
      `insert into qa_trace_events (id, tenant_id, trace_id, phase, status, detail, metadata)
       values ($1,$2,$3,'conversation','completed',$4,$5)`,
      [createId("trace_event"), user.tenant_id, trace.id, recent.length ? `载入 ${recent.length} 条历史消息` : "创建新会话", JSON.stringify({ conversationId: selected.id })]
    );
    return { conversation: selected, history: recent, userMessage: message };
  });
  const modelInput: AskInput = {
    tenantId: user.tenant_id,
    question: body.question,
    workspaceName: scopedWorkspaces.map((item) => item.name).join("、"),
    modelId: body.modelId,
    context,
    citations: deduped,
    history: history.map((message) => ({ role: message.role, content: message.content }))
  };
  return { workspace, conversation, userMessage, citations: deduped, modelInput, startedAt, trace };
}

export async function persistQaAnswer(user: User, body: QaRequest, prepared: Awaited<ReturnType<typeof prepareQa>>, answer: string) {
  return tx(async (client) => {
    const assistantMessage = (await client.query<Message>(
      `insert into messages (id, conversation_id, role, content, model_id) values ($1,$2,'assistant',$3,$4) returning *`,
      [createId("message"), prepared.conversation.id, answer, body.modelId || env.model.id]
    )).rows[0];
    if (prepared.citations.length) {
      const citations = prepared.citations.map((item) => ({
        id: createId("citation"),
        message_id: assistantMessage.id,
        workspace_id: item.workspaceId || null,
        asset_id: item.assetId || null,
        gbrain_slug: item.slug || null,
        title: item.title,
        snippet: item.snippet,
        score: item.score,
        kind: item.kind,
        url: item.url || null
      }));
      await client.query(
        `insert into message_citations
          (id, message_id, workspace_id, asset_id, gbrain_slug, title, snippet, score, kind, url)
         select id, message_id, workspace_id, asset_id, gbrain_slug, title, snippet, score, kind, url
         from jsonb_to_recordset($1::jsonb) as item(
           id text, message_id text, workspace_id text, asset_id text, gbrain_slug text,
           title text, snippet text, score double precision, kind text, url text
         )`,
        [JSON.stringify(citations)]
      );
    }
    const durationMs = Date.now() - prepared.startedAt;
    await client.query(`update conversations set updated_at = now() where id = $1`, [prepared.conversation.id]);
    await client.query(
      `insert into query_events
       (id, tenant_id, workspace_id, workspace_ids, user_id, conversation_id, normalized_question, model_id, source_flags, latency_ms)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [createId("query"), user.tenant_id, body.workspaceId, prepared.conversation.workspace_ids, user.id, prepared.conversation.id, body.question.replace(/\s+/g, " ").trim(), body.modelId || env.model.id, JSON.stringify(body.options || {}), durationMs]
    );
    await client.query(
      `insert into audit_logs (id, tenant_id, user_id, action, resource_type, resource_id, metadata)
       values ($1,$2,$3,'qa.ask','workspace',$4,$5)`,
      [createId("audit"), user.tenant_id, user.id, body.workspaceId, JSON.stringify({ modelId: body.modelId || env.model.id, citations: prepared.citations.length })]
    );
    await client.query(
      `insert into qa_trace_events (id, tenant_id, trace_id, phase, status, detail)
       values ($1,$2,$3,'persistence','completed','回答、引用与统计已保存')`,
      [createId("trace_event"), user.tenant_id, prepared.trace.id]
    );
    await client.query(
      `update qa_traces
          set assistant_message_id = $2, answer_preview = $3, citation_count = $4,
              status = 'completed', duration_ms = $5, completed_at = now(), updated_at = now()
        where id = $1`,
      [prepared.trace.id, assistantMessage.id, answer.slice(0, 800), prepared.citations.length, durationMs]
    );
    return assistantMessage;
  });
}
