import fs from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { Worker } from "bullmq";
import { buildApp } from "../src/http/app.js";
import { pool } from "../src/db/pool.js";
import { ensureDatabase, migrateAndSeed } from "../src/db/setup.js";
import { env } from "../src/config/env.js";
import { EOperaDocumentProcessor } from "../src/services/document-processor.js";
import { processAsset } from "../src/services/asset-processing.js";
import { redisConnection } from "../src/services/asset-queue.js";

const cleanupState = {
  app: null as Awaited<ReturnType<typeof buildApp>> | null,
  baseUrl: "",
  token: "",
  assetIds: [] as string[],
  noteIds: [] as string[],
  workspaceIds: [] as string[],
  files: [] as string[],
  worker: null as Worker<{ assetId: string }> | null
};

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function cleanupRegressionData() {
  if (cleanupState.baseUrl && cleanupState.token) {
    for (const noteId of cleanupState.noteIds) {
      await fetch(`${cleanupState.baseUrl}/api/notes/${noteId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${cleanupState.token}` }
      }).catch(() => undefined);
      await fetch(`${cleanupState.baseUrl}/api/notes/${noteId}/permanent`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${cleanupState.token}` }
      }).catch(() => undefined);
    }
    for (const assetId of cleanupState.assetIds) {
      await fetch(`${cleanupState.baseUrl}/api/assets/${assetId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${cleanupState.token}` }
      }).catch(() => undefined);
      await fetch(`${cleanupState.baseUrl}/api/assets/${assetId}/permanent`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${cleanupState.token}` }
      }).catch(() => undefined);
    }
  }
  if (cleanupState.workspaceIds.length) {
    await pool.query(`delete from workspaces where id = any($1::text[])`, [cleanupState.workspaceIds]).catch(() => undefined);
  }
  cleanupState.files.forEach((filePath) => fs.rmSync(filePath, { force: true }));
  if (cleanupState.worker) {
    await cleanupState.worker.close().catch(() => undefined);
    cleanupState.worker = null;
  }
  if (cleanupState.app) {
    await cleanupState.app.close().catch(() => undefined);
    cleanupState.app = null;
  }
}

async function main() {
  await ensureDatabase();
  await migrateAndSeed();
  const app = await buildApp();
  cleanupState.app = app;
  cleanupState.worker = new Worker<{ assetId: string }>(
    "aiteam-asset-processing",
    async (job) => processAsset(job.data.assetId),
    { connection: redisConnection, concurrency: 2 }
  );
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo | null;
  if (!address) throw new Error("server did not start");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  cleanupState.baseUrl = baseUrl;

  async function json<T>(pathName: string, init: RequestInit = {}) {
    const response = await fetch(`${baseUrl}${pathName}`, init);
    const payload = await response.json().catch(() => ({}));
    return { response, payload: payload as T };
  }

  async function waitForAsset(assetId: string, token: string, timeoutMs = 180_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
    const result = await json<{ asset: { id: string; status: string; processing_provider: string | null; markdown_storage_key: string | null; updated_at: string; error: string | null }; text: string }>(`/api/assets/${assetId}/preview`, {
        headers: { authorization: `Bearer ${token}` }
      });
      if (["ready", "failed"].includes(result.payload.asset.status)) return result.payload;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`asset processing timed out: ${assetId}`);
  }

  const adminLogin = await json<{ user: { id: string } }>("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@mem-kb.local", password: "admin123456" })
  });
  assert(adminLogin.response.ok, "admin login failed");
  const adminToken = adminLogin.response.headers.get("set-cookie")?.match(/aiteam_session=([^;]+)/)?.[1] || "";
  assert(Boolean(adminToken), "admin session cookie missing");
  cleanupState.token = adminToken;

  const viewerLogin = await json<{ user: { id: string } }>("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "viewer@mem-kb.local", password: "viewer123456" })
  });
  assert(viewerLogin.response.ok, "viewer login failed");
  const viewerToken = viewerLogin.response.headers.get("set-cookie")?.match(/aiteam_session=([^;]+)/)?.[1] || "";
  assert(Boolean(viewerToken), "viewer session cookie missing");

  const workspaces = await json<{ workspaces: Array<{ id: string; name: string }> }>("/api/workspaces", {
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(workspaces.payload.workspaces.length > 0, "workspace list empty");

  const models = await json<{ models: Array<{ id: string; name: string; modelName: string; configured: boolean }> }>("/api/models", {
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(models.response.ok && models.payload.models.some((item) => [item.id, item.name, item.modelName].includes("gpt-5.5") && item.configured), "model catalog unavailable");

  const units = await json<{ businessUnits: Array<{ id: string }> }>("/api/business-units", {
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(units.response.ok && units.payload.businessUnits.some((item) => item.id === "bu-ecommerce"), "business partition unavailable");

  const runId = Date.now();
  const documentWorkspace = await json<{ workspace: { id: string } }>("/api/workspaces", {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({ name: `回归文档 ${runId}`, description: "自动化测试专用", scope: "personal", kind: "document" })
  });
  assert(documentWorkspace.response.ok, "document regression workspace creation failed");
  const workspaceId = documentWorkspace.payload.workspace.id;
  cleanupState.workspaceIds.push(workspaceId);

  const imageWorkspace = await json<{ workspace: { id: string } }>("/api/workspaces", {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({ name: `回归图片 ${runId}`, description: "自动化测试专用", scope: "personal", kind: "image" })
  });
  assert(imageWorkspace.response.ok, "image regression workspace creation failed");
  const imageWorkspaceId = imageWorkspace.payload.workspace.id;
  cleanupState.workspaceIds.push(imageWorkspaceId);

  let parentId: string | null = null;
  for (const name of ["回归一级", "回归二级", "回归三级"]) {
    const categoryResult: { response: Response; payload: { category: { id: string } } } = await json<{ category: { id: string } }>(`/api/workspaces/${imageWorkspaceId}/categories`, {
      method: "POST",
      headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
      body: JSON.stringify({ name: `${name}-${runId}`, parentId })
    });
    assert(categoryResult.response.ok, `regression category creation failed: ${name}`);
    parentId = categoryResult.payload.category.id;
  }
  const product = await json<{ product: { id: string } }>(`/api/workspaces/${imageWorkspaceId}/products`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({ categoryId: parentId, name: `回归商品-${runId}` })
  });
  assert(product.response.ok, "regression product creation failed");

  const tmpFile = path.join(os.tmpdir(), `aiteam-regression-${runId}.md`);
  cleanupState.files.push(tmpFile);
  fs.writeFileSync(tmpFile, `# 回归测试文档 ${runId}\n\n这是一个用于验证上传、解析、GBrain 入库和知识图谱的 SOP。\n\n\`\`\`mermaid\nflowchart LR\n  A[上传] --> B[入库]\n\`\`\``);
  const adminForm = new FormData();
  adminForm.append("workspaceId", workspaceId);
  adminForm.append("file", new Blob([fs.readFileSync(tmpFile)], { type: "text/markdown" }), "regression.md");
  const upload = await fetch(`${baseUrl}/api/assets/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}` },
    body: adminForm
  });
  const uploadPayload = (await upload.json()) as { asset?: { id: string; status: string } };
  assert(upload.ok, `admin upload failed: ${JSON.stringify(uploadPayload)}`);
  assert(Boolean(uploadPayload.asset?.id) && ["queued", "indexing", "ready"].includes(uploadPayload.asset!.status), "upload did not enter processing queue");
  cleanupState.assetIds.push(uploadPayload.asset!.id);
  const processedUpload = await waitForAsset(uploadPayload.asset!.id, adminToken);
  assert(processedUpload.asset.status === "ready", `document processing failed: ${processedUpload.asset.error || "unknown"}`);
  assert(Boolean(processedUpload.asset.processing_provider) && Boolean(processedUpload.asset.markdown_storage_key), "document processing metadata missing");
  assert(processedUpload.text.includes("```mermaid"), "processed Markdown did not preserve Mermaid block");

  const readOnlyEdit = await json<{ error: string }>(`/api/assets/${uploadPayload.asset!.id}/markdown`, {
    method: "PUT",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({ markdown: `${processedUpload.text}\n\n不应保存`, expectedUpdatedAt: processedUpload.asset.updated_at })
  });
  assert(readOnlyEdit.response.status === 403 && readOnlyEdit.payload.error === "asset_read_only", "knowledge document should be read-only");

  const deniedEdit = await json(`/api/assets/${uploadPayload.asset!.id}/markdown`, {
    method: "PUT",
    headers: { authorization: `Bearer ${viewerToken}`, "content-type": "application/json" },
    body: JSON.stringify({ markdown: "不应保存", expectedUpdatedAt: processedUpload.asset.updated_at })
  });
  assert(deniedEdit.response.status === 403, "viewer document edit should be denied");

  const workingCopy = await json<{ note: { id: string; source_asset_id: string; published_asset_id: string | null; published_version: number; version: number; sync_status: string } }>(`/api/assets/${uploadPayload.asset!.id}/open-in-notes`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert(workingCopy.response.status === 201, "knowledge asset did not create an authoring copy");
  const noteId = workingCopy.payload.note.id;
  cleanupState.noteIds.push(noteId);
  assert(workingCopy.payload.note.source_asset_id === uploadPayload.asset!.id && workingCopy.payload.note.published_version === 0, "working copy provenance or draft state is invalid");

  const draft = await json<{ note: { id: string; version: number; sync_status: string; published_asset_id: string | null; published_version: number } }>(`/api/notes/${noteId}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      expectedVersion: workingCopy.payload.note.version,
      title: `回归工作文档 ${runId}`,
      content: `${processedUpload.text}\n\n## 草稿补充\n仅保存在 Authoring Document。`,
      contentJson: { type: "doc", content: [{ type: "paragraph" }] }
    })
  });
  assert(draft.response.ok && draft.payload.note.sync_status === "pending", "draft autosave failed");
  assert(draft.payload.note.published_asset_id === null && draft.payload.note.published_version === 0, "draft save unexpectedly published knowledge");

  const publication = await json<{ note: { id: string; sync_status: string; published_asset_id: string; published_version: number }; asset: { id: string; status: string }; revision: { version: number } }>(`/api/notes/${noteId}/publish`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(publication.response.ok && publication.payload.note.sync_status === "synced", `note publication failed: ${JSON.stringify(publication.payload)}`);
  assert(publication.payload.note.published_version === 1 && publication.payload.asset.status === "ready" && publication.payload.revision.version === 1, "published revision is incomplete");

  const noteAssistant = await fetch(`${baseUrl}/api/notes/${noteId}/assist/stream`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json", origin: "http://127.0.0.1:5178" },
    body: JSON.stringify({ action: "outline", instruction: "生成执行大纲", assetIds: [uploadPayload.asset!.id], options: { knowledgeSearch: true } })
  });
  const noteAssistantText = await noteAssistant.text();
  assert(noteAssistant.ok && noteAssistantText.includes("event: source") && noteAssistantText.includes("event: done"), "workspace-scoped note assistant stream is incomplete");

  const removedNote = await json(`/api/notes/${noteId}`, { method: "DELETE", headers: { authorization: `Bearer ${adminToken}` } });
  assert(removedNote.response.ok, "published note could not move to trash");
  const deletedPublication = await pool.query(`select deleted_at from assets where id = $1`, [publication.payload.asset.id]);
  const deletedChunks = await pool.query(`select id from document_chunks where asset_id = $1`, [publication.payload.asset.id]);
  assert(Boolean(deletedPublication.rows[0]?.deleted_at) && deletedChunks.rowCount === 0, "trashed note remains available to local RAG");

  const restoredNote = await json<{ note: { id: string; status: string } }>(`/api/notes/${noteId}/restore`, { method: "POST", headers: { authorization: `Bearer ${adminToken}` } });
  assert(restoredNote.response.ok && restoredNote.payload.note.status === "active", "published note restore failed");
  const restoredPublication = await pool.query(`select status, deleted_at from assets where id = $1`, [publication.payload.asset.id]);
  const restoredChunks = await pool.query(`select id from document_chunks where asset_id = $1`, [publication.payload.asset.id]);
  assert(restoredPublication.rows[0]?.status === "ready" && !restoredPublication.rows[0]?.deleted_at && restoredChunks.rowCount! > 0, "restored note was not re-indexed");

  const viewerForm = new FormData();
  viewerForm.append("workspaceId", workspaceId);
  viewerForm.append("file", new Blob(["# viewer"], { type: "text/markdown" }), "viewer.md");
  const denied = await fetch(`${baseUrl}/api/assets/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${viewerToken}` },
    body: viewerForm
  });
  assert(denied.status === 403, "viewer upload should be denied");

  const ask = await json<{ answer: string; conversation: { id: string }; assistantMessage: { id: string } }>("/api/qa/ask", {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, question: "如何沉淀运营 SOP？", modelId: "gpt-5.5" })
  });
  assert(ask.response.ok, `qa ask failed: ${JSON.stringify(ask.payload)}`);
  assert(Boolean(ask.payload.answer), "qa answer empty");

  const conversationList = await json<{ conversations: Array<{ id: string }> }>(`/api/qa/conversations?workspaceId=${workspaceId}`, {
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(conversationList.response.ok && conversationList.payload.conversations.some((item) => item.id === ask.payload.conversation.id), "conversation history missing");

  const conversationDetail = await json<{ messages: Array<{ id: string; role: string; citations: Array<{ assetId?: string | null; asset_id?: string | null }> }> }>(`/api/qa/conversations/${ask.payload.conversation.id}`, {
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(conversationDetail.response.ok && conversationDetail.payload.messages.length === 2, "conversation detail incomplete");
  assert(conversationDetail.payload.messages.some((item) => item.role === "assistant" && Array.isArray(item.citations)), "message citations missing");
  const restoredCitations = conversationDetail.payload.messages.flatMap((item) => item.citations);
  assert(restoredCitations.every((item) => !("asset_id" in item)), "conversation citations should use public field names");

  const deniedConversation = await json(`/api/qa/conversations/${ask.payload.conversation.id}`, {
    headers: { authorization: `Bearer ${viewerToken}` }
  });
  assert(deniedConversation.response.status === 404, "another user should not read the conversation");

  const stream = await fetch(`${baseUrl}/api/qa/stream`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json", origin: "http://127.0.0.1:5178" },
    body: JSON.stringify({ workspaceId, question: "用三点总结当前运营知识。", modelId: "gpt-5.5" })
  });
  const streamText = await stream.text();
  assert(stream.ok && stream.headers.get("access-control-allow-origin") === "http://127.0.0.1:5178", "SSE CORS headers missing");
  assert(streamText.includes("event: delta") && streamText.includes("event: done"), "SSE stream incomplete");

  const capture = await json<{ asset: { id: string; status: string } }>(`/api/qa/messages/${ask.payload.assistantMessage.id}/capture`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, title: "回归沉淀文档", content: ask.payload.answer })
  });
  assert(capture.response.ok, `capture failed: ${JSON.stringify(capture.payload)}`);
  assert(capture.payload.asset.status === "ready", "captured asset not ready");
  cleanupState.assetIds.push(capture.payload.asset.id);

  const insights = await json<{ questions: Array<{ question: string; count: number }> }>(`/api/analytics/insights?workspaceId=${workspaceId}`, {
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(insights.response.ok && insights.payload.questions.length > 0, "usage insights empty");

  const graph = await json<{ nodes: Array<{ id: string; type: string; assetId?: string | null }>; edges: Array<{ id: string; sourceType?: string; confidence?: number }> }>(`/api/workspaces/${workspaceId}/graph`, {
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(graph.response.ok && graph.payload.nodes.length > 1 && graph.payload.edges.length > 0, "knowledge graph empty");
  assert(graph.payload.nodes.some((node) => node.type !== "workspace" && Boolean(node.assetId)), "knowledge graph contains no asset nodes");
  assert(graph.payload.edges.every((edge) => Boolean(edge.sourceType) && typeof edge.confidence === "number"), "knowledge graph evidence metadata missing");

  const blockedWeb = await json<{ error: string }>("/api/web/inspect", {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, url: "http://127.0.0.1:8788", persist: false })
  });
  assert(blockedWeb.response.status === 400 && blockedWeb.payload.error === "web_fetch_failed", "private URL should be blocked");

  const imageBuffer = await sharp({ create: { width: 96, height: 96, channels: 3, background: { r: 32, g: 190, b: 126 } } }).png().toBuffer();
  const imageForm = new FormData();
  imageForm.append("workspaceId", imageWorkspaceId);
  imageForm.append("categoryId", parentId!);
  imageForm.append("productId", product.payload.product.id);
  imageForm.append("file", new Blob([imageBuffer], { type: "image/png" }), "regression-product.png");
  const imageUpload = await fetch(`${baseUrl}/api/assets/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}` },
    body: imageForm
  });
  const imagePayload = (await imageUpload.json()) as { asset?: { id: string; status: string; summary: string } };
  assert(imageUpload.ok && Boolean(imagePayload.asset?.id), "image upload failed");
  cleanupState.assetIds.push(imagePayload.asset!.id);
  const processedImage = await waitForAsset(imagePayload.asset!.id, adminToken);
  assert(processedImage.asset.status === "ready", "image VLM pipeline failed");

  const crossWorkspaceAssistant = await json<{ error: string }>(`/api/notes/${noteId}/assist/stream`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({ action: "outline", instruction: "不应跨区召回", assetIds: [imagePayload.asset!.id], options: { knowledgeSearch: true } })
  });
  assert(crossWorkspaceAssistant.response.status === 400 && crossWorkspaceAssistant.payload.error === "invalid_assistant_scope", "note assistant accepted a cross-workspace source");

  const thumbnail = await fetch(`${baseUrl}/api/assets/${imagePayload.asset!.id}/content?variant=thumbnail`, {
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(thumbnail.ok && thumbnail.headers.get("content-type")?.includes("image/webp"), "image thumbnail was not generated");

  const rangedDownload = await fetch(`${baseUrl}/api/assets/${imagePayload.asset!.id}/download`, {
    headers: { authorization: `Bearer ${adminToken}`, range: "bytes=-10" }
  });
  assert(rangedDownload.status === 206 && (await rangedDownload.arrayBuffer()).byteLength === 10, "suffix Range download failed");

  const imageSearch = await json<{ assets: Array<{ id: string }> }>("/api/image-search/text", {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({ workspaceId: imageWorkspaceId, query: "绿色商品素材" })
  });
  assert(imageSearch.response.ok && imageSearch.payload.assets.length > 0, "text-to-image search empty");

  const stub = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk.toString()));
    request.on("end", () => {
      const payload = JSON.parse(body) as { files: Array<{ doc_id: string; filename: string; oss_url: string }> };
      const file = payload.files[0];
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        message: "转换成功",
        data: [{ doc_id: file.doc_id, filename: file.filename, oss_url: file.oss_url, parent_id: null, status: "completed", current_version: "1.0.0", markdown_content: "# EOpera 契约通过" }]
      }));
    });
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const stubAddress = stub.address() as AddressInfo;
  const previousBaseUrl = env.documentProcessor.baseUrl;
  env.documentProcessor.baseUrl = `http://127.0.0.1:${stubAddress.port}`;
  const eoperaResult = await new EOperaDocumentProcessor().process({
    assetId: `contract-${runId}`,
    tenantId: "tenant-zw",
    userId: "user-admin",
    filename: "contract.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    absolutePath: tmpFile,
    sourceUrl: "http://127.0.0.1/source.docx"
  });
  env.documentProcessor.baseUrl = previousBaseUrl;
  await new Promise<void>((resolve, reject) => stub.close((error) => error ? reject(error) : resolve()));
  assert(eoperaResult.provider === "eopera" && eoperaResult.markdown.includes("契约通过"), "EOpera process-oss adapter contract failed");

  for (const assetId of [uploadPayload.asset!.id, capture.payload.asset.id, imagePayload.asset!.id]) {
    const removed = await json(`/api/assets/${assetId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${adminToken}` }
    });
    assert(removed.response.ok, `asset cleanup failed: ${assetId}`);
    const graphNode = await pool.query(`select id from graph_nodes where asset_id = $1`, [assetId]);
    assert(graphNode.rowCount === 0, `deleted asset graph node remains: ${assetId}`);
  }

  const activeAfterDelete = await json<{ assets: Array<{ id: string }> }>(`/api/assets?workspaceId=${workspaceId}&deleted=false`, {
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(activeAfterDelete.response.ok && !activeAfterDelete.payload.assets.some((asset) => cleanupState.assetIds.includes(asset.id)), "deleted=false returned trashed assets");
  const trashedAfterDelete = await json<{ assets: Array<{ id: string }> }>(`/api/assets?workspaceId=${workspaceId}&deleted=true`, {
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(trashedAfterDelete.response.ok && trashedAfterDelete.payload.assets.some((asset) => asset.id === uploadPayload.asset!.id), "deleted=true did not return trashed assets");

  const deniedConversationDelete = await json(`/api/qa/conversations/${ask.payload.conversation.id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${viewerToken}` }
  });
  assert(deniedConversationDelete.response.status === 404, "another user should not delete the conversation");

  const removedConversation = await json(`/api/qa/conversations/${ask.payload.conversation.id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(removedConversation.response.ok, "conversation deletion failed");
  const removedConversationDetail = await json(`/api/qa/conversations/${ask.payload.conversation.id}`, {
    headers: { authorization: `Bearer ${adminToken}` }
  });
  assert(removedConversationDetail.response.status === 404, "deleted conversation remains readable");

  await cleanupRegressionData();
  await pool.end();
  console.log("Regression passed: auth, ACL, isolated upload, read-only knowledge documents, EOpera adapter, GBrain, QA/SSE/history deletion, capture, analytics, real graph, SSRF, image VLM/search, cleanup.");
}

main().catch(async (error) => {
  console.error(error);
  await cleanupRegressionData();
  await pool.end().catch(() => undefined);
  process.exit(1);
});
