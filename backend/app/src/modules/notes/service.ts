import { audit } from "../../auth/context.js";
import { assertWorkspace } from "../../auth/permissions.js";
import { one, query } from "../../db/pool.js";
import type { Asset, Note, NoteFact, NoteRevision, User } from "../../db/schema.js";
import { searchWeb } from "../../providers/web.js";
import { retrieveDocumentKnowledge } from "../../services/document-retrieval.js";
import {
  addGBrainTimelineEntry,
  extractGBrainFacts,
  forgetGBrainFact,
  getGBrainBacklinks,
  getGBrainPage,
  getGBrainTags,
  getGBrainTimeline,
  getGBrainVersions,
  recallGBrainFacts,
  revertGBrainVersion,
  type GBrainFact
} from "../../services/gbrain.js";
import { createId, slugSegment } from "../../utils/id.js";
import { normalizeNoteTags, noteBodyFromPage } from "./content.js";
import { purgePublishedNote, restorePublishedNote, trashPublishedNote } from "./publication.js";
import { findNote, listVerifiedFactText } from "./repository.js";

export function noteSlug(tenantId: string, workspaceId: string, noteId: string) {
  return `aiteam/${slugSegment(tenantId)}/workspace/${slugSegment(workspaceId)}/notes/${slugSegment(noteId)}`;
}

function readArray<T>(value: unknown, key: string): T[] {
  if (Array.isArray(value)) return value as T[];
  if (!value || typeof value !== "object") return [];
  const nested = (value as Record<string, unknown>)[key];
  return Array.isArray(nested) ? nested as T[] : [];
}

export async function createNote(user: User, input: { workspaceId: string; folderId?: string | null; title: string; content?: string; contentJson?: Record<string, unknown>; tags?: string[]; sourceAssetId?: string | null }) {
  await assertWorkspace(user, input.workspaceId, "write");
  const id = createId("note");
  const note = await one<Note>(
    `insert into notes
     (id, tenant_id, workspace_id, owner_id, folder_id, title, content_markdown, content_json, tags, gbrain_slug, source_asset_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
    [id, user.tenant_id, input.workspaceId, user.id, input.folderId || null, input.title, input.content || "",
     JSON.stringify(input.contentJson || {}), normalizeNoteTags(input.tags || []), noteSlug(user.tenant_id, input.workspaceId, id), input.sourceAssetId || null]
  );
  if (!note) throw new Error("笔记创建失败");
  await audit(user, "note.create", "note", note.id, { workspaceId: note.workspace_id });
  return note;
}

export async function createNoteFromAsset(user: User, asset: Asset, folderId?: string | null) {
  await assertWorkspace(user, asset.workspace_id, "write");
  const existing = await one<Note>(
    `select * from notes where tenant_id = $1 and owner_id = $2 and source_asset_id = $3 and status = 'active'
     order by updated_at desc limit 1`,
    [user.tenant_id, user.id, asset.id]
  );
  if (existing) return { note: existing, created: false };
  const note = await createNote(user, {
    workspaceId: asset.workspace_id,
    folderId,
    title: asset.title.replace(/\.[^.]+$/, ""),
    content: asset.extracted_text || asset.summary || "",
    tags: asset.tags,
    sourceAssetId: asset.id
  });
  await audit(user, "note.create_from_asset", "note", note.id, { workspaceId: asset.workspace_id, assetId: asset.id });
  return { note, created: true };
}

export async function updateNote(user: User, note: Note, input: {
  expectedVersion: number;
  title?: string;
  content?: string;
  contentJson?: Record<string, unknown>;
  folderId?: string | null;
  tags?: string[];
  favorite?: boolean;
  autoPublish?: boolean;
}) {
  await assertWorkspace(user, note.workspace_id, "write");
  const updated = await one<Note>(
    `update notes set
       title = coalesce($1, title),
       content_markdown = coalesce($2, content_markdown),
       content_json = coalesce($3, content_json),
       folder_id = case when $4::boolean then $5 else folder_id end,
       tags = coalesce($6, tags),
       is_favorite = coalesce($7, is_favorite),
       auto_publish = coalesce($8, auto_publish),
       sync_status = 'pending', sync_error = null, version = version + 1, updated_at = now()
     where id = $9 and tenant_id = $10 and version = $11 and status = 'active' returning *`,
    [input.title ?? null, input.content ?? null, input.contentJson ? JSON.stringify(input.contentJson) : null,
     Object.prototype.hasOwnProperty.call(input, "folderId"), input.folderId ?? null,
     input.tags ? normalizeNoteTags(input.tags) : null, input.favorite ?? null, input.autoPublish ?? null,
     note.id, user.tenant_id, input.expectedVersion]
  );
  if (!updated) {
    const error = new Error("笔记已在其他位置更新，请刷新后重试");
    error.name = "NoteConflict";
    throw error;
  }
  await audit(user, "note.draft.save", "note", note.id, { workspaceId: note.workspace_id, version: updated.version });
  return updated;
}

export async function deleteNote(user: User, note: Note) {
  await assertWorkspace(user, note.workspace_id, "write");
  await trashPublishedNote(user, note);
  await query(`update notes set status = 'deleted', deleted_at = now(), sync_status = 'synced', updated_at = now() where id = $1`, [note.id]);
  await audit(user, "note.delete", "note", note.id, { workspaceId: note.workspace_id });
}

export async function restoreNote(user: User, note: Note) {
  await assertWorkspace(user, note.workspace_id, "write");
  await restorePublishedNote(user, note);
  const restored = await one<Note>(
    `update notes set status = 'active', deleted_at = null, sync_status = 'synced', sync_error = null, updated_at = now() where id = $1 returning *`,
    [note.id]
  );
  await audit(user, "note.restore", "note", note.id, { workspaceId: note.workspace_id });
  return restored!;
}

export async function purgeNote(user: User, note: Note) {
  await assertWorkspace(user, note.workspace_id, "manage", true);
  await purgePublishedNote(user, note);
  await query(`delete from notes where id = $1 and tenant_id = $2 and status = 'deleted'`, [note.id, user.tenant_id]);
  await audit(user, "note.purge", "note", note.id, { workspaceId: note.workspace_id });
}

export async function noteLifecycle(user: User, note: Note) {
  await assertWorkspace(user, note.workspace_id, "read");
  const [tags, versions, timeline, backlinks, revisions] = await Promise.all([
    getGBrainTags(note.gbrain_slug).catch(() => ({ tags: [] })),
    getGBrainVersions(note.gbrain_slug).catch(() => ({ versions: [] })),
    getGBrainTimeline(note.gbrain_slug).catch(() => ({ entries: [] })),
    getGBrainBacklinks(note.gbrain_slug).catch(() => ({ backlinks: [] })),
    query<NoteRevision>(`select * from note_revisions where note_id = $1 order by version desc limit 30`, [note.id])
  ]);
  return {
    tags: readArray<string>(tags, "tags"),
    versions: readArray<Record<string, unknown>>(versions, "versions"),
    timeline: readArray<Record<string, unknown>>(timeline, "entries"),
    backlinks: readArray<Record<string, unknown>>(backlinks, "backlinks"),
    revisions
  };
}

export async function revertNote(user: User, note: Note, versionId: number) {
  await assertWorkspace(user, note.workspace_id, "write");
  await revertGBrainVersion(note.gbrain_slug, versionId);
  const page = await getGBrainPage(note.gbrain_slug);
  const content = noteBodyFromPage(String(page.compiled_truth || page.content || ""));
  const updated = await one<Note>(
    `update notes set content_markdown = $1, version = version + 1, sync_status = 'synced', sync_error = null, updated_at = now()
     where id = $2 returning *`,
    [content, note.id]
  );
  await addGBrainTimelineEntry(note.gbrain_slug, "笔记已回滚", `恢复到 GBrain 版本 ${versionId}`);
  await audit(user, "note.revert", "note", note.id, { workspaceId: note.workspace_id, versionId });
  return updated!;
}

function factRows(value: Awaited<ReturnType<typeof recallGBrainFacts>>) {
  return readArray<GBrainFact>(value, "facts");
}

export async function extractFacts(user: User, note: Note) {
  await assertWorkspace(user, note.workspace_id, "write");
  const result = await extractGBrainFacts(`${note.title}\n\n${note.content_markdown}`, note.workspace_id);
  const ids = result.fact_ids || [];
  if (!ids.length) return [];
  const recalled = factRows(await recallGBrainFacts(note.workspace_id, true, 100));
  const created: NoteFact[] = [];
  for (const fact of recalled.filter((item) => ids.includes(Number(item.id)))) {
    const row = await one<NoteFact>(
      `insert into note_facts
       (id, tenant_id, workspace_id, note_id, gbrain_fact_id, fact, kind, entity_slug, confidence, metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (note_id, gbrain_fact_id) where gbrain_fact_id is not null
       do update set fact = excluded.fact, confidence = excluded.confidence, metadata = excluded.metadata, updated_at = now()
       returning *`,
      [createId("fact"), user.tenant_id, note.workspace_id, note.id, fact.id, fact.fact, fact.kind || "knowledge", fact.entity_slug || null, Number(fact.confidence || 0), JSON.stringify(fact)]
    );
    if (row) created.push(row);
  }
  await audit(user, "note.facts.extract", "note", note.id, { workspaceId: note.workspace_id, count: created.length });
  return created;
}

export interface NoteAssistantSource {
  assetId: string;
  title: string;
  heading: string;
  snippet: string;
  score: number;
}

export async function buildNoteAssistantContext(
  user: User,
  note: Note,
  instruction: string,
  options: { knowledgeSearch?: boolean; webSearch?: boolean; assetIds?: string[] }
) {
  await assertWorkspace(user, note.workspace_id, "read");
  const sections: string[] = [];
  const sources: NoteAssistantSource[] = [];
  if (options.knowledgeSearch !== false) {
    if (options.assetIds?.length) {
      const assets = await query<Asset>(
        `select * from assets where tenant_id = $1 and workspace_id = $2 and id = any($3::text[])
         and deleted_at is null and status = 'ready'`,
        [user.tenant_id, note.workspace_id, options.assetIds]
      );
      if (assets.length !== new Set(options.assetIds).size) {
        const error = new Error("指定资料不存在、未就绪或不属于当前 Workspace");
        error.name = "InvalidAssistantScope";
        throw error;
      }
      assets.forEach((asset) => sources.push({
        assetId: asset.id,
        title: asset.title,
        heading: "指定文档",
        snippet: (asset.index_text || asset.extracted_text || asset.summary || asset.title).slice(0, 4_000),
        score: 1
      }));
    } else {
      const hits = await retrieveDocumentKnowledge(user.tenant_id, note.workspace_id, instruction).catch(() => []);
      hits.forEach((hit) => sources.push({
        assetId: hit.assetId,
        title: hit.title,
        heading: hit.heading,
        snippet: hit.content.slice(0, 4_000),
        score: hit.score
      }));
    }
    if (sources.length) sections.push(`# Workspace 知识\n${sources.map((source, index) => `[${index + 1}] ${source.title}${source.heading ? ` · ${source.heading}` : ""}\n${source.snippet}`).join("\n\n")}`);
  }
  const facts = await listVerifiedFactText(user.tenant_id, note.workspace_id);
  if (facts.length) sections.push(`# 已确认长期事实\n${facts.map((fact) => `- ${fact}`).join("\n")}`);
  if (options.webSearch) {
    const web = await searchWeb(instruction, 5).catch(() => []);
    if (web.length) sections.push(`# 联网资料\n${web.map((item) => `- ${item.title}: ${item.snippet} (${item.url})`).join("\n")}`);
  }
  return { context: sections.join("\n\n"), sources };
}

export async function correctFact(user: User, fact: NoteFact, corrected: string) {
  await assertWorkspace(user, fact.workspace_id, "write");
  if (fact.gbrain_fact_id) await forgetGBrainFact(fact.gbrain_fact_id, "corrected-in-aiteam");
  const extracted = await extractGBrainFacts(corrected, fact.workspace_id);
  const nextId = extracted.fact_ids?.[0] || null;
  const updated = await one<NoteFact>(
    `update note_facts set corrected_fact = $1, gbrain_fact_id = $2, status = 'verified', updated_at = now() where id = $3 returning *`,
    [corrected, nextId, fact.id]
  );
  await audit(user, "fact.correct", "note_fact", fact.id, { workspaceId: fact.workspace_id, gbrainFactId: nextId });
  return updated!;
}
