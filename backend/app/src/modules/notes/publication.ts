import crypto from "node:crypto";
import type { Asset, Note, NoteRevision, User } from "../../db/schema.js";
import { one, query } from "../../db/pool.js";
import { assertWorkspace } from "../../auth/permissions.js";
import { audit } from "../../auth/context.js";
import { deleteKnowledgeAsset, purgeKnowledgeAsset } from "../../services/asset-deletion.js";
import { addGBrainTag, addGBrainTimelineEntry, deleteGBrainPage, getGBrainTags, removeGBrainTag, restoreGBrainPage } from "../../services/gbrain.js";
import { indexKnowledgeAsset } from "../../services/knowledge-indexer.js";
import { removeStoredFile, writeGeneratedMarkdown } from "../../services/storage.js";
import { createId } from "../../utils/id.js";
import { normalizeNoteTags } from "./content.js";

export function notePublicationHash(note: Pick<Note, "title" | "content_markdown" | "content_json" | "tags">) {
  return crypto.createHash("sha256").update(JSON.stringify({
    title: note.title.trim(),
    markdown: note.content_markdown,
    json: note.content_json,
    tags: normalizeNoteTags(note.tags)
  })).digest("hex");
}

async function syncTags(slug: string, tags: string[]) {
  const raw = await getGBrainTags(slug).catch(() => ({ tags: [] }));
  const current = Array.isArray(raw) ? raw : Array.isArray((raw as { tags?: unknown }).tags) ? (raw as { tags: string[] }).tags : [];
  await Promise.all([
    ...tags.filter((tag) => !current.includes(tag)).map((tag) => addGBrainTag(slug, tag)),
    ...current.filter((tag) => !tags.includes(tag)).map((tag) => removeGBrainTag(slug, tag))
  ]);
}

async function stagePublishedAsset(user: User, note: Note, stored: Awaited<ReturnType<typeof writeGeneratedMarkdown>>) {
  const existing = note.published_asset_id
    ? await one<Asset>(`select * from assets where id = $1 and tenant_id = $2 and deleted_at is null`, [note.published_asset_id, user.tenant_id])
    : null;
  if (existing) {
    const updated = await one<Asset>(
      `update assets set title = $1, size_bytes = $2, storage_key = $3, sha256 = $4,
       extracted_text = $5, index_text = $5, markdown_storage_key = $3, status = 'indexing',
       error = null, gbrain_slug = $6, updated_at = now() where id = $7 returning *`,
      [note.title, stored.sizeBytes, stored.storageKey, stored.sha256, note.content_markdown, note.gbrain_slug, existing.id]
    );
    return { asset: updated!, previousStorageKey: existing.storage_key };
  }

  const id = createId("asset");
  const created = await one<Asset>(
    `insert into assets
     (id, tenant_id, workspace_id, owner_id, type, format, title, mime_type, size_bytes,
      storage_key, sha256, status, summary, extracted_text, index_text, markdown_storage_key,
      processing_provider, processing_version, processed_at, gbrain_slug, tags, metadata)
     values ($1,$2,$3,$4,'document','md',$5,'text/markdown',$6,$7,$8,'indexing',$9,$10,$10,$7,
      'note-publisher','note-publication-v1',now(),$11,$12,$13::jsonb) returning *`,
    [
      id, user.tenant_id, note.workspace_id, user.id, note.title, stored.sizeBytes,
      stored.storageKey, stored.sha256, note.content_markdown.replace(/\s+/g, " ").slice(0, 180),
      note.content_markdown, note.gbrain_slug, normalizeNoteTags(note.tags),
      JSON.stringify({ source: "authoring-note", noteId: note.id, sourceAssetId: note.source_asset_id })
    ]
  );
  return { asset: created!, previousStorageKey: null };
}

export async function publishNote(user: User, note: Note) {
  await assertWorkspace(user, note.workspace_id, "write");
  const current = await one<Note>(`select * from notes where id = $1 and tenant_id = $2 and status = 'active'`, [note.id, user.tenant_id]);
  if (!current) throw new Error("笔记不存在");
  const contentHash = notePublicationHash(current);
  if (current.last_published_hash === contentHash && current.published_asset_id) {
    const asset = await one<Asset>(`select * from assets where id = $1 and tenant_id = $2`, [current.published_asset_id, user.tenant_id]);
    const revision = await one<NoteRevision>(`select * from note_revisions where note_id = $1 order by version desc limit 1`, [current.id]);
    return { note: current, asset, revision, unchanged: true };
  }

  const body = current.content_markdown.trim() || `# ${current.title}`;
  const storedBody = [
    "---",
    `title: ${JSON.stringify(current.title)}`,
    `source_note_id: ${JSON.stringify(current.id)}`,
    "---",
    "",
    body
  ].join("\n");
  const stored = await writeGeneratedMarkdown(`${current.title}.md`, storedBody);
  let staged: Awaited<ReturnType<typeof stagePublishedAsset>> | null = null;
  try {
    staged = await stagePublishedAsset(user, current, stored);
    const indexed = await indexKnowledgeAsset({
      asset: staged.asset,
      title: current.title,
      body,
      sha256: stored.sha256,
      source: "aiteam-note-publication"
    });
    const ready = await one<Asset>(
      `update assets set status = 'ready', summary = coalesce($1, summary), tags = $2, error = null, updated_at = now()
       where id = $3 returning *`,
      [indexed.summary || null, normalizeNoteTags(current.tags), staged.asset.id]
    );
    const nextVersion = current.published_version + 1;
    const revision = await one<NoteRevision>(
      `insert into note_revisions
       (id, tenant_id, workspace_id, note_id, published_asset_id, created_by, version,
        title, content_markdown, content_json, content_hash)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [createId("revision"), user.tenant_id, current.workspace_id, current.id, ready!.id, user.id,
       nextVersion, current.title, current.content_markdown, JSON.stringify(current.content_json || {}), contentHash]
    );
    const published = await one<Note>(
      `update notes set published_asset_id = $1, published_version = $2, last_published_hash = $3,
       last_published_at = now(), sync_status = 'synced', sync_error = null, updated_at = now()
       where id = $4 returning *`,
      [ready!.id, nextVersion, contentHash, current.id]
    );
    await syncTags(current.gbrain_slug, normalizeNoteTags(current.tags));
    await addGBrainTimelineEntry(current.gbrain_slug, "笔记已发布", `发布版本 ${nextVersion}`);
    if (staged.previousStorageKey && staged.previousStorageKey !== stored.storageKey) {
      await removeStoredFile(staged.previousStorageKey).catch(() => undefined);
    }
    await audit(user, "note.publish", "note", current.id, { workspaceId: current.workspace_id, version: nextVersion, assetId: ready!.id });
    return { note: published!, asset: ready!, revision: revision!, unchanged: false };
  } catch (error) {
    await query(`update notes set sync_status = 'failed', sync_error = $1 where id = $2`, [error instanceof Error ? error.message : String(error), current.id]);
    if (staged?.asset.id) await query(`update assets set status = 'failed', error = $1 where id = $2`, [error instanceof Error ? error.message : String(error), staged.asset.id]);
    if (!staged || stored.storageKey !== staged.previousStorageKey) await removeStoredFile(stored.storageKey).catch(() => undefined);
    throw error;
  }
}

async function publishedAsset(user: User, note: Note, includeDeleted = false) {
  if (!note.published_asset_id) return null;
  return one<Asset>(
    `select * from assets where id = $1 and tenant_id = $2 ${includeDeleted ? "" : "and deleted_at is null"}`,
    [note.published_asset_id, user.tenant_id]
  );
}

export async function trashPublishedNote(user: User, note: Note) {
  const asset = await publishedAsset(user, note);
  if (asset) {
    await deleteKnowledgeAsset(asset);
    return;
  }
  if (note.published_version > 0) await deleteGBrainPage(note.gbrain_slug);
}

export async function restorePublishedNote(user: User, note: Note) {
  const asset = await publishedAsset(user, note, true);
  if (!asset) {
    if (note.published_version > 0) await restoreGBrainPage(note.gbrain_slug);
    return;
  }
  if (!asset.deleted_at) return;
  const restoring = await one<Asset>(
    `update assets set deleted_at = null, status = 'indexing', error = null, updated_at = now() where id = $1 returning *`,
    [asset.id]
  );
  try {
    const indexed = await indexKnowledgeAsset({
      asset: restoring!,
      title: note.title,
      body: note.content_markdown.trim() || `# ${note.title}`,
      sha256: asset.sha256,
      source: "aiteam-note-restore"
    });
    await query(
      `update assets set status = 'ready', summary = coalesce($1, summary), error = null, updated_at = now() where id = $2`,
      [indexed.summary || null, asset.id]
    );
  } catch (error) {
    await query(
      `update assets set status = 'deleted', deleted_at = now(), error = $1, updated_at = now() where id = $2`,
      [error instanceof Error ? error.message : String(error), asset.id]
    );
    throw error;
  }
}

export async function purgePublishedNote(user: User, note: Note) {
  const asset = await publishedAsset(user, note, true);
  if (asset) {
    if (!asset.deleted_at) await deleteKnowledgeAsset(asset);
    const deleted = await publishedAsset(user, note, true);
    if (deleted) await purgeKnowledgeAsset(deleted);
    return;
  }
  if (note.published_version > 0) await deleteGBrainPage(note.gbrain_slug).catch(() => undefined);
}
