import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { audit, requireUser } from "../../auth/context.js";
import { assertWorkspace } from "../../auth/permissions.js";
import { env } from "../../config/env.js";
import { one, query } from "../../db/pool.js";
import type { Asset, Note, NoteFact, NoteFolder } from "../../db/schema.js";
import { forgetGBrainFact } from "../../services/gbrain.js";
import { streamNoteAssistant } from "../../services/model.js";
import { createId } from "../../utils/id.js";
import { createFolder, findNote, listNoteFacts } from "./repository.js";
import {
  buildNoteAssistantContext,
  correctFact,
  createNote,
  createNoteFromAsset,
  deleteNote,
  purgeNote,
  extractFacts,
  noteLifecycle,
  restoreNote,
  revertNote,
  updateNote
} from "./service.js";
import { publishNote } from "./publication.js";

const queryBoolean = z.enum(["true", "false"]).transform((value) => value === "true");

const noteUpdateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  title: z.string().min(1).max(160).optional(),
  content: z.string().max(2_000_000).optional(),
  contentJson: z.record(z.string(), z.unknown()).optional(),
  folderId: z.string().nullable().optional(),
  tags: z.array(z.string().max(30)).max(8).optional(),
  favorite: z.boolean().optional(),
  autoPublish: z.boolean().optional()
});

function sendSse(reply: FastifyReply, event: string, data: unknown) {
  if (reply.raw.destroyed || reply.raw.writableEnded) return;
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function startSse(reply: FastifyReply, origin?: string) {
  const allowed = new Set([env.frontendOrigin, "http://127.0.0.1:5177", "http://127.0.0.1:5178"]);
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    ...(origin && allowed.has(origin) ? { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", vary: "Origin" } : {})
  });
}

async function requireNote(user: NonNullable<Awaited<ReturnType<typeof requireUser>>>, id: string, includeDeleted = false) {
  const note = await findNote(user.tenant_id, id, includeDeleted);
  if (!note) return null;
  await assertWorkspace(user, note.workspace_id, includeDeleted ? "write" : "read");
  return note;
}

export async function registerNoteRoutes(app: FastifyInstance) {
  app.get("/api/note-folders", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { workspaceId } = z.object({ workspaceId: z.string() }).parse(request.query);
    await assertWorkspace(user, workspaceId, "read");
    return { folders: await query<NoteFolder>(`select * from note_folders where tenant_id = $1 and workspace_id = $2 order by sort_order, name`, [user.tenant_id, workspaceId]) };
  });

  app.post("/api/note-folders", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const body = z.object({ workspaceId: z.string(), parentId: z.string().nullable().optional(), name: z.string().min(1).max(80) }).parse(request.body);
    await assertWorkspace(user, body.workspaceId, "write");
    const folder = await createFolder({ id: createId("folder"), tenant_id: user.tenant_id, workspace_id: body.workspaceId, owner_id: user.id, parent_id: body.parentId || null, name: body.name.trim() });
    await audit(user, "note.folder.create", "note_folder", folder!.id, { workspaceId: body.workspaceId });
    return reply.code(201).send({ folder });
  });

  app.get("/api/notes", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const params = z.object({ workspaceId: z.string(), folderId: z.string().optional(), search: z.string().optional(), deleted: queryBoolean.optional(), favorite: queryBoolean.optional() }).parse(request.query);
    await assertWorkspace(user, params.workspaceId, "read");
    const values: unknown[] = [user.tenant_id, params.workspaceId, params.deleted ? "deleted" : "active"];
    let sql = `select * from notes where tenant_id = $1 and workspace_id = $2 and status = $3`;
    if (params.folderId) { values.push(params.folderId); sql += ` and folder_id = $${values.length}`; }
    if (params.search) { values.push(`%${params.search}%`); sql += ` and (title ilike $${values.length} or content_markdown ilike $${values.length})`; }
    if (params.favorite) sql += ` and is_favorite = true`;
    return { notes: await query<Note>(`${sql} order by is_favorite desc, updated_at desc`, values) };
  });

  app.post("/api/notes", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const body = z.object({ workspaceId: z.string(), folderId: z.string().nullable().optional(), title: z.string().min(1).max(160), content: z.string().max(2_000_000).optional(), contentJson: z.record(z.string(), z.unknown()).optional(), tags: z.array(z.string()).max(8).optional() }).parse(request.body);
    return reply.code(201).send({ note: await createNote(user, body) });
  });

  app.get("/api/notes/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const note = await requireNote(user, (request.params as { id: string }).id);
    return note ? { note } : reply.code(404).send({ error: "note_not_found", message: "笔记不存在" });
  });

  app.post("/api/assets/:id/open-in-notes", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const asset = await one<Asset>(
      `select * from assets where id = $1 and tenant_id = $2 and deleted_at is null and status = 'ready'`,
      [id, user.tenant_id]
    );
    if (!asset) return reply.code(404).send({ error: "asset_not_found", message: "知识资产不存在或尚未解析完成" });
    const { folderId } = z.object({ folderId: z.string().nullable().optional() }).parse(request.body || {});
    const result = await createNoteFromAsset(user, asset, folderId);
    return reply.code(result.created ? 201 : 200).send(result);
  });

  app.put("/api/notes/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const note = await requireNote(user, (request.params as { id: string }).id);
    if (!note) return reply.code(404).send({ error: "note_not_found", message: "笔记不存在" });
    try {
      return { note: await updateNote(user, note, noteUpdateSchema.parse(request.body)) };
    } catch (error) {
      if (error instanceof Error && error.name === "NoteConflict") return reply.code(409).send({ error: "note_conflict", message: error.message });
      throw error;
    }
  });

  app.post("/api/notes/:id/publish", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const note = await requireNote(user, (request.params as { id: string }).id);
    if (!note) return reply.code(404).send({ error: "note_not_found", message: "笔记不存在" });
    return publishNote(user, note);
  });

  app.delete("/api/notes/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const note = await requireNote(user, (request.params as { id: string }).id);
    if (!note) return reply.code(404).send({ error: "note_not_found", message: "笔记不存在" });
    await deleteNote(user, note);
    return { ok: true };
  });

  app.post("/api/notes/:id/restore", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const note = await requireNote(user, (request.params as { id: string }).id, true);
    if (!note) return reply.code(404).send({ error: "note_not_found", message: "笔记不存在" });
    return { note: await restoreNote(user, note) };
  });

  app.delete("/api/notes/:id/permanent", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const note = await requireNote(user, (request.params as { id: string }).id, true);
    if (!note || note.status !== "deleted") return reply.code(404).send({ error: "note_not_found", message: "回收站中没有该笔记" });
    await purgeNote(user, note);
    return { ok: true };
  });

  app.get("/api/notes/:id/lifecycle", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const note = await requireNote(user, (request.params as { id: string }).id);
    if (!note) return reply.code(404).send({ error: "note_not_found", message: "笔记不存在" });
    return noteLifecycle(user, note);
  });

  app.post("/api/notes/:id/revert", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const note = await requireNote(user, (request.params as { id: string }).id);
    if (!note) return reply.code(404).send({ error: "note_not_found", message: "笔记不存在" });
    const { versionId } = z.object({ versionId: z.number().int().positive() }).parse(request.body);
    return { note: await revertNote(user, note, versionId) };
  });

  app.post("/api/notes/:id/extract-facts", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const note = await requireNote(user, (request.params as { id: string }).id);
    if (!note) return reply.code(404).send({ error: "note_not_found", message: "笔记不存在" });
    return { facts: await extractFacts(user, note) };
  });

  app.post("/api/notes/:id/assist/stream", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const note = await requireNote(user, (request.params as { id: string }).id);
    if (!note) return reply.code(404).send({ error: "note_not_found", message: "笔记不存在" });
    const body = z.object({
      action: z.enum(["continue", "rewrite", "summarize", "outline", "custom"]),
      instruction: z.string().max(4000).default(""),
      selection: z.string().max(100_000).optional(),
      cursorContext: z.string().max(20_000).optional(),
      assetIds: z.array(z.string()).max(30).optional(),
      modelId: z.string().optional(),
      options: z.object({ knowledgeSearch: z.boolean().optional(), webSearch: z.boolean().optional() }).default({})
    }).parse(request.body);
    let scoped;
    try {
      scoped = await buildNoteAssistantContext(user, note, body.instruction || body.selection || body.cursorContext || note.title, { ...body.options, assetIds: body.assetIds });
    } catch (error) {
      if (error instanceof Error && error.name === "InvalidAssistantScope") {
        return reply.code(400).send({ error: "invalid_assistant_scope", message: error.message });
      }
      throw error;
    }
    startSse(reply, request.headers.origin);
    scoped.sources.forEach((source) => sendSse(reply, "source", source));
    const controller = new AbortController();
    reply.raw.once("close", () => {
      if (!reply.raw.writableEnded) controller.abort(new Error("client_disconnected"));
    });
    try {
      const answer = await streamNoteAssistant({ ...body, selection: body.selection || body.cursorContext, title: note.title, markdown: note.content_markdown, context: scoped.context }, (text) => sendSse(reply, "delta", { text }), controller.signal);
      sendSse(reply, "done", { answer });
    } catch (error) {
      if (!controller.signal.aborted) sendSse(reply, "error", { message: error instanceof Error ? error.message : "AI 写作失败" });
    } finally {
      reply.raw.end();
    }
  });

  app.get("/api/facts", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const params = z.object({ workspaceId: z.string(), status: z.enum(["pending", "verified", "forgotten"]).optional(), noteId: z.string().optional() }).parse(request.query);
    await assertWorkspace(user, params.workspaceId, "read");
    return { facts: await listNoteFacts(user.tenant_id, params.workspaceId, params.status, params.noteId) };
  });

  app.post("/api/facts/:id/verify", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const fact = await one<NoteFact>(`select * from note_facts where id = $1 and tenant_id = $2`, [(request.params as { id: string }).id, user.tenant_id]);
    if (!fact) return reply.code(404).send({ error: "fact_not_found", message: "事实不存在" });
    await assertWorkspace(user, fact.workspace_id, "write");
    const updated = await one<NoteFact>(`update note_facts set status = 'verified', updated_at = now() where id = $1 returning *`, [fact.id]);
    await audit(user, "fact.verify", "note_fact", fact.id, { workspaceId: fact.workspace_id });
    return { fact: updated };
  });

  app.post("/api/facts/:id/correct", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const fact = await one<NoteFact>(`select * from note_facts where id = $1 and tenant_id = $2`, [(request.params as { id: string }).id, user.tenant_id]);
    if (!fact) return reply.code(404).send({ error: "fact_not_found", message: "事实不存在" });
    const { fact: corrected } = z.object({ fact: z.string().min(1).max(2000) }).parse(request.body);
    return { fact: await correctFact(user, fact, corrected) };
  });

  app.post("/api/facts/:id/forget", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const fact = await one<NoteFact>(`select * from note_facts where id = $1 and tenant_id = $2`, [(request.params as { id: string }).id, user.tenant_id]);
    if (!fact) return reply.code(404).send({ error: "fact_not_found", message: "事实不存在" });
    await assertWorkspace(user, fact.workspace_id, "write");
    if (fact.gbrain_fact_id) await forgetGBrainFact(fact.gbrain_fact_id);
    const updated = await one<NoteFact>(`update note_facts set status = 'forgotten', updated_at = now() where id = $1 returning *`, [fact.id]);
    await audit(user, "fact.forget", "note_fact", fact.id, { workspaceId: fact.workspace_id });
    return { fact: updated };
  });
}
