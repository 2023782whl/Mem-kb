import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { z } from "zod";
import { audit, requireUser } from "../../auth/context.js";
import { assertWorkspace } from "../../auth/permissions.js";
import { one, query, runAsSystem } from "../../db/pool.js";
import type { Asset, AssetMedia, Product } from "../../db/schema.js";
import { retryAssetProcessing, scheduleAssetProcessing } from "../../services/asset-processing.js";
import { deleteKnowledgeAsset, purgeKnowledgeAsset } from "../../services/asset-deletion.js";
import { verifyInternalSourceUrl } from "../../services/internal-files.js";
import { documentMediaUrl, storeIncomingDocumentMedia } from "../../services/document-media.js";
import { classifyMime, ensureStoredFile, persistStoredFile, removeStoredFile, saveMultipartFile, storagePath, supportedUploadDescription, validateStoredSignature } from "../../services/storage.js";
import { createId, slugSegment } from "../../utils/id.js";
import { deleteGBrainPage } from "../../services/gbrain.js";

const queryBoolean = z.enum(["true", "false"]).transform((value) => value === "true");

function fieldValue(fields: Record<string, unknown>, key: string) {
  const raw = fields[key] as { value?: unknown } | Array<{ value?: unknown }> | undefined;
  const field = Array.isArray(raw) ? raw[0] : raw;
  return typeof field?.value === "string" ? field.value : undefined;
}

function gbrainSlug(tenantId: string, workspaceId: string, assetId: string) {
  return `aiteam/${slugSegment(tenantId)}/workspace/${slugSegment(workspaceId)}/assets/${slugSegment(assetId)}`;
}

export async function registerAssetRoutes(app: FastifyInstance) {
  app.get("/internal/assets/:id/source", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { expires = "", signature = "" } = request.query as { expires?: string; signature?: string };
    if (!verifyInternalSourceUrl(id, expires, signature)) {
      return reply.code(403).send({ error: "invalid_signature", message: "文件访问地址已失效" });
    }
    const asset = await runAsSystem(() => one<Asset>(`select * from assets where id = $1 and deleted_at is null`, [id]));
    if (!asset) return reply.code(404).send({ error: "asset_not_found", message: "文件不存在" });
    const absolutePath = await ensureStoredFile(asset.storage_key).catch(() => "");
    if (!absolutePath) return reply.code(404).send({ error: "file_missing", message: "原文件不存在" });
    reply.header("cache-control", "private, no-store");
    reply.header("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(asset.title)}`);
    reply.type(asset.mime_type);
    return reply.send(fs.createReadStream(absolutePath));
  });

  app.post("/internal/assets/:id/media", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { expires = "", signature = "" } = request.query as { expires?: string; signature?: string };
    if (!verifyInternalSourceUrl(id, expires, signature)) {
      return reply.code(403).send({ error: "invalid_signature", message: "媒体上传地址已失效" });
    }
    const asset = await runAsSystem(() => one<Asset>(`select * from assets where id = $1 and deleted_at is null`, [id]));
    if (!asset) return reply.code(404).send({ error: "asset_not_found", message: "文件不存在" });
    const file = await request.file();
    if (!file || !file.mimetype.startsWith("image/")) {
      file?.file.resume();
      return reply.code(415).send({ error: "invalid_media", message: "仅允许上传图片" });
    }
    const bytes = await file.toBuffer();
    if (bytes.length > 30 * 1024 * 1024) {
      return reply.code(413).send({ error: "media_too_large", message: "单张文档图片不能超过 30MB" });
    }
    const media = await runAsSystem(() => storeIncomingDocumentMedia(asset, bytes, file.mimetype, file.filename));
    return { mediaId: media.id, url: documentMediaUrl(asset.id, media.id) };
  });

  app.get("/api/assets", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const querySchema = z.object({
      workspaceId: z.string(),
      kind: z.string().optional(),
      search: z.string().optional(),
      deleted: queryBoolean.optional().default(false)
    });
    const params = querySchema.parse(request.query);
    await assertWorkspace(user, params.workspaceId, "read");

    const values: unknown[] = [user.tenant_id, params.workspaceId];
    let sql = `select * from assets where tenant_id = $1 and workspace_id = $2 and deleted_at is ${params.deleted ? "not null" : "null"}`;
    if (params.kind && params.kind !== "all") {
      values.push(params.kind);
      sql += ` and type = $${values.length}`;
    }
    if (params.search) {
      values.push(`%${params.search}%`);
      sql += ` and (title ilike $${values.length} or coalesce(summary,'') ilike $${values.length})`;
    }
    sql += ` order by created_at desc`;
    return { assets: await query<Asset>(sql, values) };
  });

  app.post("/api/assets/upload", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const file = await request.file();
    if (!file) {
      reply.code(400).send({ error: "missing_file", message: "请选择文件" });
      return;
    }
    const workspaceId = fieldValue(file.fields, "workspaceId");
    if (!workspaceId) {
      reply.code(400).send({ error: "missing_workspace", message: "请选择 Workspace" });
      return;
    }
    const workspace = await assertWorkspace(user, workspaceId, "write");
    const categoryId = fieldValue(file.fields, "categoryId") || null;
    const productId = fieldValue(file.fields, "productId") || null;
    const requestedType = classifyMime(file.mimetype, file.filename);
    if (!requestedType) {
      file.file.resume();
      return reply.code(415).send({ error: "unsupported_file", message: supportedUploadDescription() });
    }

    if (workspace.kind !== "mixed" && requestedType !== workspace.kind) {
      return reply.code(400).send({ error: "workspace_kind_mismatch", message: "文件类型与 Workspace 类型不匹配" });
    }
    if (requestedType === "image") {
      if (!categoryId || !productId) return reply.code(400).send({ error: "image_relation_required", message: "图片必须关联三级类目和商品" });
      const product = await one<Product>(
        `select p.* from products p join categories c on c.id = p.category_id
         where p.id = $1 and p.category_id = $2 and p.workspace_id = $3 and p.tenant_id = $4 and c.level = 3`,
        [productId, categoryId, workspaceId, user.tenant_id]
      );
      if (!product) return reply.code(400).send({ error: "invalid_image_relation", message: "类目或商品不属于当前 Workspace" });
    } else if (categoryId || productId) {
      return reply.code(400).send({ error: "unexpected_relation", message: "仅图片素材支持类目和商品关联" });
    }

    const stored = await saveMultipartFile(file);
    if (!validateStoredSignature(stored.absolutePath, stored.format)) {
      await removeStoredFile(stored.storageKey).catch(() => fs.rmSync(stored.absolutePath, { force: true }));
      return reply.code(415).send({ error: "invalid_file_content", message: "文件内容与扩展名不匹配" });
    }
    const duplicated = await one<Asset>(
      `select * from assets
       where tenant_id = $1 and workspace_id = $2 and sha256 = $3 and deleted_at is null
       order by created_at desc limit 1`,
      [user.tenant_id, workspaceId, stored.sha256]
    );
    if (duplicated) {
      fs.rmSync(stored.absolutePath, { force: true });
      return { asset: duplicated, deduplicated: true };
    }

    const assetId = createId("asset");
    const type = requestedType;
    const slug = gbrainSlug(user.tenant_id, workspaceId, assetId);
    const title = fieldValue(file.fields, "title") || file.filename;

    const asset = await one<Asset>(
      `insert into assets
       (id, tenant_id, workspace_id, owner_id, type, format, title, mime_type, size_bytes, storage_key,
        sha256, status, gbrain_slug, category_id, product_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'queued', $12, $13, $14)
       returning *`,
      [
        assetId,
        user.tenant_id,
        workspaceId,
        user.id,
        type,
        stored.format,
        title,
        stored.mimeType,
        stored.sizeBytes,
        stored.storageKey,
        stored.sha256,
        slug,
        categoryId,
        productId
      ]
    );
    if (!asset) throw new Error("资产创建失败");

    await query(
      `insert into jobs (id, tenant_id, workspace_id, asset_id, type, status, progress)
       values ($1,$2,$3,$4,$5,'queued',0)`,
      [createId("job"), user.tenant_id, workspaceId, assetId, type === "image" ? "image-index" : "document-index"]
    );
    await audit(user, "asset.upload.queued", "asset", assetId, { workspaceId, title, gbrainSlug: slug });
    scheduleAssetProcessing(assetId);
    return reply.code(202).send({ asset, deduplicated: false });
  });

  app.post("/api/assets/:id/retry", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const asset = await one<Asset>(`select * from assets where id = $1 and tenant_id = $2 and deleted_at is null`, [id, user.tenant_id]);
    if (!asset) return reply.code(404).send({ error: "asset_not_found", message: "文件不存在" });
    await assertWorkspace(user, asset.workspace_id, "write");
    if (asset.status !== "failed") return reply.code(409).send({ error: "asset_not_failed", message: "只有失败任务可以重试" });
    await retryAssetProcessing(asset);
    await audit(user, "asset.process.retry", "asset", id, { workspaceId: asset.workspace_id });
    return reply.code(202).send({ asset: { ...asset, status: "queued", error: null } });
  });

  app.post("/api/assets/:id/reprocess", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const asset = await one<Asset>(`select * from assets where id = $1 and tenant_id = $2 and deleted_at is null`, [id, user.tenant_id]);
    if (!asset) return reply.code(404).send({ error: "asset_not_found", message: "文件不存在" });
    await assertWorkspace(user, asset.workspace_id, "write");
    if (asset.status === "queued" || asset.status === "indexing") {
      return reply.code(409).send({ error: "asset_processing", message: "文件正在解析中" });
    }
    await retryAssetProcessing(asset);
    await audit(user, "asset.process.reprocess", "asset", id, { workspaceId: asset.workspace_id });
    return reply.code(202).send({ asset: { ...asset, status: "queued", error: null } });
  });

  app.get("/api/assets/:id/preview", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const asset = await one<Asset>(`select * from assets where id = $1 and tenant_id = $2 and deleted_at is null`, [
      id,
      user.tenant_id
    ]);
    if (!asset) {
      reply.code(404).send({ error: "asset_not_found", message: "文件不存在" });
      return;
    }
    await assertWorkspace(user, asset.workspace_id, "read");
    return { asset, text: asset.extracted_text || asset.summary || "" };
  });

  app.get("/api/assets/:id/media/:mediaId", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id, mediaId } = request.params as { id: string; mediaId: string };
    const media = await one<AssetMedia>(
      `select media.* from asset_media media
       join assets asset on asset.id = media.asset_id
       where media.id = $1 and media.asset_id = $2 and media.tenant_id = $3 and asset.deleted_at is null`,
      [mediaId, id, user.tenant_id]
    );
    if (!media) return reply.code(404).send({ error: "media_not_found", message: "文档图片不存在" });
    await assertWorkspace(user, media.workspace_id, "read");
    const absolutePath = await ensureStoredFile(media.storage_key).catch(() => "");
    if (!absolutePath) return reply.code(404).send({ error: "media_missing", message: "文档图片文件不存在" });
    reply.header("cache-control", "private, max-age=3600");
    reply.header("etag", `"${media.sha256}"`);
    reply.header("content-length", String(media.size_bytes));
    reply.type(media.mime_type);
    return reply.send(fs.createReadStream(absolutePath));
  });

  app.put("/api/assets/:id/markdown", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const asset = await one<Asset>(
      `select * from assets where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, user.tenant_id]
    );
    if (!asset) return reply.code(404).send({ error: "asset_not_found", message: "文件不存在" });
    await assertWorkspace(user, asset.workspace_id, "read");
    return reply.code(403).send({ error: "asset_read_only", message: "知识库文档为只读内容，请在笔记中编辑" });
  });

  app.get("/api/assets/:id/download", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const asset = await one<Asset>(`select * from assets where id = $1 and tenant_id = $2 and deleted_at is null`, [
      id,
      user.tenant_id
    ]);
    if (!asset) {
      reply.code(404).send({ error: "asset_not_found", message: "文件不存在" });
      return;
    }
    await assertWorkspace(user, asset.workspace_id, "read");
    const absolutePath = await ensureStoredFile(asset.storage_key).catch(() => "");
    if (!absolutePath) {
      reply.code(404).send({ error: "file_missing", message: "原文件不存在" });
      return;
    }
    await audit(user, "asset.download", "asset", asset.id, { title: asset.title });
    reply.header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(asset.title)}`);
    reply.header("accept-ranges", "bytes");
    reply.type(asset.mime_type);
    const size = fs.statSync(absolutePath).size;
    const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    if (range) {
      const suffixLength = !range[1] && range[2] ? Number(range[2]) : 0;
      const start = suffixLength ? Math.max(0, size - suffixLength) : range[1] ? Number(range[1]) : 0;
      const end = suffixLength ? size - 1 : range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
        return reply.code(416).header("content-range", `bytes */${size}`).send();
      }
      reply.code(206);
      reply.header("content-range", `bytes ${start}-${end}/${size}`);
      reply.header("content-length", String(end - start + 1));
      return reply.send(fs.createReadStream(absolutePath, { start, end }));
    }
    reply.header("content-length", String(size));
    return reply.send(fs.createReadStream(absolutePath));
  });

  app.patch("/api/assets/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const body = z.object({
      title: z.string().min(1).max(240).optional(),
      workspaceId: z.string().optional(),
      categoryId: z.string().nullable().optional(),
      productId: z.string().nullable().optional(),
      tags: z.array(z.string().min(1).max(40)).max(30).optional()
    }).refine((value) => Object.keys(value).length > 0, "至少修改一个字段").parse(request.body);
    const asset = await one<Asset>(`select * from assets where id = $1 and tenant_id = $2 and deleted_at is null`, [id, user.tenant_id]);
    if (!asset) return reply.code(404).send({ error: "asset_not_found", message: "文件不存在" });
    await assertWorkspace(user, asset.workspace_id, "write");
    const targetWorkspaceId = body.workspaceId || asset.workspace_id;
    const targetWorkspace = await assertWorkspace(user, targetWorkspaceId, "write");
    if (targetWorkspace.kind !== "mixed" && targetWorkspace.kind !== asset.type) {
      return reply.code(400).send({ error: "workspace_kind_mismatch", message: "目标 Workspace 不支持该资产类型" });
    }
    const categoryId = Object.prototype.hasOwnProperty.call(body, "categoryId") ? body.categoryId : asset.category_id;
    const productId = Object.prototype.hasOwnProperty.call(body, "productId") ? body.productId : asset.product_id;
    if (asset.type === "image") {
      if (!categoryId || !productId) return reply.code(400).send({ error: "image_relation_required", message: "图片必须关联三级类目和商品" });
      const relation = await one<{ id: string }>(
        `select p.id from products p join categories c on c.id = p.category_id
         where p.id = $1 and p.category_id = $2 and p.workspace_id = $3 and p.tenant_id = $4 and c.level = 3`,
        [productId, categoryId, targetWorkspaceId, user.tenant_id]
      );
      if (!relation) return reply.code(400).send({ error: "invalid_image_relation", message: "目标类目或商品无效" });
    }
    const nextSlug = targetWorkspaceId === asset.workspace_id ? asset.gbrain_slug : gbrainSlug(user.tenant_id, targetWorkspaceId, id);
    const updated = await one<Asset>(
      `update assets set title = coalesce($1, title), workspace_id = $2, category_id = $3, product_id = $4,
              tags = coalesce($5, tags), gbrain_slug = $6, updated_at = now()
       where id = $7 and tenant_id = $8 returning *`,
      [body.title || null, targetWorkspaceId, categoryId || null, productId || null, body.tags || null, nextSlug, id, user.tenant_id]
    );
    await audit(user, "asset.update", "asset", id, { fromWorkspaceId: asset.workspace_id, toWorkspaceId: targetWorkspaceId, title: body.title });
    if (targetWorkspaceId !== asset.workspace_id) {
      if (asset.gbrain_slug) await deleteGBrainPage(asset.gbrain_slug).catch(() => undefined);
      await query(`delete from graph_nodes where asset_id = $1`, [id]);
      await query(`update assets set status = 'queued' where id = $1`, [id]);
      await query(`insert into jobs (id, tenant_id, workspace_id, asset_id, type, status, progress) values ($1,$2,$3,$4,$5,'queued',0)`, [createId("job"), user.tenant_id, targetWorkspaceId, id, asset.type === "image" ? "image-index" : "document-index"]);
      scheduleAssetProcessing(id);
    }
    return { asset: targetWorkspaceId === asset.workspace_id ? updated : { ...updated, status: "queued" } };
  });

  app.post("/api/assets/:id/restore", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const asset = await one<Asset>(`select * from assets where id = $1 and tenant_id = $2 and deleted_at is not null`, [id, user.tenant_id]);
    if (!asset) return reply.code(404).send({ error: "asset_not_found", message: "回收站中没有该文件" });
    await assertWorkspace(user, asset.workspace_id, "write");
    if (!await ensureStoredFile(asset.storage_key).then(() => true).catch(() => false)) return reply.code(409).send({ error: "source_missing", message: "原文件已不存在，无法恢复" });
    const duplicate = await one<Asset>(
      `select * from assets where tenant_id = $1 and workspace_id = $2 and sha256 = $3 and deleted_at is null and id <> $4 limit 1`,
      [user.tenant_id, asset.workspace_id, asset.sha256, id]
    );
    if (duplicate) return reply.code(409).send({ error: "duplicate_asset", message: "当前 Workspace 已有相同文件，无法恢复" });
    const restored = await one<Asset>(`update assets set status = 'queued', deleted_at = null, error = null, updated_at = now() where id = $1 returning *`, [id]);
    await query(`insert into jobs (id, tenant_id, workspace_id, asset_id, type, status, progress) values ($1,$2,$3,$4,$5,'queued',0)`, [createId("job"), user.tenant_id, asset.workspace_id, id, asset.type === "image" ? "image-index" : "document-index"]);
    await audit(user, "asset.restore", "asset", id, { workspaceId: asset.workspace_id });
    scheduleAssetProcessing(id);
    return reply.code(202).send({ asset: restored });
  });

  app.delete("/api/assets/:id/permanent", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const asset = await one<Asset>(`select * from assets where id = $1 and tenant_id = $2 and deleted_at is not null`, [id, user.tenant_id]);
    if (!asset) return reply.code(404).send({ error: "asset_not_found", message: "回收站中没有该文件" });
    await assertWorkspace(user, asset.workspace_id, "manage");
    const result = await purgeKnowledgeAsset(asset);
    await audit(user, "asset.purge", "asset", id, { workspaceId: asset.workspace_id, cleanupWarnings: result.cleanupWarnings });
    return { ok: true, ...result };
  });

  app.get("/api/assets/:id/content", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const asset = await one<Asset>(`select * from assets where id = $1 and tenant_id = $2 and deleted_at is null`, [id, user.tenant_id]);
    if (!asset) return reply.code(404).send({ error: "asset_not_found", message: "文件不存在" });
    await assertWorkspace(user, asset.workspace_id, "read");
    const { variant } = z.object({ variant: z.enum(["original", "thumbnail"]).optional().default("original") }).parse(request.query);
    const useThumbnail = variant === "thumbnail" && asset.type === "image";
    let contentKey = asset.thumbnail_storage_key || "";
    let thumbnailAvailable = false;
    if (useThumbnail && contentKey) thumbnailAvailable = await ensureStoredFile(contentKey).then(() => true).catch(() => false);
    if (useThumbnail && !thumbnailAvailable) {
      const originalPath = await ensureStoredFile(asset.storage_key).catch(() => "");
      if (!originalPath) return reply.code(404).send({ error: "file_missing", message: "原文件不存在" });
      contentKey = `thumbnails/${new Date().toISOString().slice(0, 10)}/${asset.id}.webp`;
      const thumbnailPath = storagePath(contentKey);
      fs.mkdirSync(path.dirname(thumbnailPath), { recursive: true });
      await sharp(originalPath).rotate().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toFile(thumbnailPath);
      await persistStoredFile(contentKey, thumbnailPath);
      await query(`update assets set thumbnail_storage_key = $1 where id = $2`, [contentKey, asset.id]);
    }
    if (!useThumbnail) contentKey = asset.storage_key;
    const absolutePath = await ensureStoredFile(contentKey).catch(() => "");
    if (!absolutePath) return reply.code(404).send({ error: "file_missing", message: "文件不存在" });
    reply.header("cache-control", "private, max-age=300");
    reply.type(useThumbnail ? "image/webp" : asset.mime_type);
    return reply.send(fs.createReadStream(absolutePath));
  });

  app.delete("/api/assets/:id", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const { id } = request.params as { id: string };
    const asset = await one<Asset>(`select * from assets where id = $1 and tenant_id = $2`, [id, user.tenant_id]);
    if (!asset) return reply.code(404).send({ error: "asset_not_found", message: "文件不存在" });
    await assertWorkspace(user, asset.workspace_id, "write");
    if (asset.deleted_at) {
      return { ok: true, alreadyDeleted: true, cleanupWarnings: [], gbrainStatus: null };
    }
    const result = await deleteKnowledgeAsset(asset);
    await audit(user, "asset.trash", "asset", id, {
      workspaceId: asset.workspace_id,
      title: asset.title,
      gbrainStatus: result.gbrainStatus,
      cleanupWarnings: result.cleanupWarnings
    });
    return { ok: true, ...result };
  });
}
