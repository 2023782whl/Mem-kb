import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { audit } from "../auth/context.js";
import { one, query } from "../db/pool.js";
import type { Asset, User } from "../db/schema.js";
import { embedMultimodal, vectorLiteral } from "../providers/embedding.js";
import { createId } from "../utils/id.js";
import { enqueueAssetProcessing } from "./asset-queue.js";
import { createInternalSourceUrl } from "./internal-files.js";
import { indexKnowledgeAsset, rebuildWorkspaceRelations } from "./knowledge-indexer.js";
import { describeImage } from "./model.js";
import { processDocument } from "./document-processor.js";
import { analyzeDocumentMedia } from "./document-media-analysis.js";
import { buildIndexMarkdown, materializeDocumentMedia } from "./document-media.js";
import { evaluateDocumentQuality, inspectSourceMedia } from "./document-quality.js";
import { ensureStoredFile, persistStoredFile, storagePath, writeProcessedMarkdown } from "./storage.js";

function asMessage(error: unknown) {
  return error instanceof Error ? error.message : "资产处理失败";
}

async function processImage(asset: Asset, absolutePath: string) {
  const thumbnailStorageKey = `thumbnails/${new Date().toISOString().slice(0, 10)}/${asset.id}.webp`;
  const thumbnailPath = storagePath(thumbnailStorageKey);
  const thumbnail = async () => {
    fs.mkdirSync(path.dirname(thumbnailPath), { recursive: true });
    await sharp(absolutePath).rotate().resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toFile(thumbnailPath);
    await persistStoredFile(thumbnailStorageKey, thumbnailPath);
  };
  const [, vision, vector] = await Promise.all([
    thumbnail(),
    describeImage(absolutePath, asset.mime_type),
    embedMultimodal({ imagePath: absolutePath })
  ]);
  const staged = await one<Asset>(
    `update assets set summary = $1, extracted_text = $2, ocr_text = $3, tags = $4, thumbnail_storage_key = $5,
     metadata = coalesce(metadata, '{}'::jsonb) || $6::jsonb, processing_provider = 'gpt-vlm',
     processing_version = 'v1', processed_at = now(), updated_at = now()
     where id = $7 returning *`,
    [
      vision.summary,
      [vision.product, vision.scene, ...vision.sellingPoints, vision.style].filter(Boolean).join("\n"),
      vision.ocr,
      vision.tags,
      thumbnailStorageKey,
      JSON.stringify({ vision }),
      asset.id
    ]
  );
  await query(
    `insert into image_embeddings (tenant_id, workspace_id, asset_id, model_id, embedding)
     values ($1,$2,$3,$4,$5::vector)
     on conflict (asset_id) do update
     set model_id = excluded.model_id, embedding = excluded.embedding, created_at = now()`,
    [asset.tenant_id, asset.workspace_id, asset.id, "multimodal-embedding-v1", vectorLiteral(vector)]
  );
  await indexKnowledgeAsset({
    asset: staged || asset,
    title: asset.title,
    body: `## 图片描述\n${vision.summary}\n\n## OCR\n${vision.ocr || "无"}\n\n## 卖点\n${vision.sellingPoints.map((item) => `- ${item}`).join("\n")}`,
    sha256: asset.sha256,
    source: "aiteam-image-upload",
    presetTopics: [...vision.tags, vision.scene, vision.product]
      .filter(Boolean)
      .slice(0, 12)
      .map((label) => ({ label, type: "image-entity", relation: "视觉关联", evidence: vision.summary }))
  });
}

async function processUploadedDocument(asset: Asset, absolutePath: string) {
  const [sourceMediaCount, result] = await Promise.all([
    inspectSourceMedia(absolutePath, asset.format),
    processDocument({
      assetId: asset.id,
      tenantId: asset.tenant_id,
      userId: asset.owner_id,
      filename: asset.title,
      mimeType: asset.mime_type,
      absolutePath,
      sourceUrl: createInternalSourceUrl(asset.id)
    })
  ]);
  const localized = await materializeDocumentMedia(asset, result.markdown, result.provider === "eopera");
  const analysis = await analyzeDocumentMedia(localized.media);
  const indexMarkdown = result.indexMarkdown || buildIndexMarkdown(localized.markdown, analysis.media);
  const quality = evaluateDocumentQuality({
    sourceMediaCount,
    rawMarkdown: result.markdown,
    displayMarkdown: localized.markdown,
    assetId: asset.id,
    uniqueMediaCount: analysis.media.length
  });
  if (!quality.passed) throw new Error(`文档图文质量检查失败：${quality.warnings.join("；")}`);
  const markdownFile = await writeProcessedMarkdown(asset.id, localized.markdown);
  const staged = await one<Asset>(
    `update assets set summary = $1, extracted_text = $2, index_text = $3, markdown_storage_key = $4,
     processing_provider = $5, processing_version = $6, processed_at = now(),
     metadata = coalesce(metadata, '{}'::jsonb) || $7::jsonb, updated_at = now()
     where id = $8 returning *`,
    [
      result.summary,
      localized.markdown,
      indexMarkdown,
      markdownFile.storageKey,
      result.provider,
      result.version,
      JSON.stringify({
        processing: {
          provider: result.provider,
          version: result.version,
          markdownStorageKey: markdownFile.storageKey,
          warning: result.warning || null,
          mediaAnalysisWarnings: analysis.warnings,
          quality,
          processedAt: new Date().toISOString()
        }
      }),
      asset.id
    ]
  );
  await indexKnowledgeAsset({
    asset: staged || asset,
    title: asset.title,
    body: indexMarkdown,
    source: result.provider === "eopera" ? "eopera-process-oss" : "aiteam-upload",
    sha256: asset.sha256
  });
}

export async function processAsset(assetId: string) {
  const asset = await one<Asset>(
    `update assets set status = 'indexing', error = null, updated_at = now()
     where id = $1 and deleted_at is null and status = 'queued' returning *`,
    [assetId]
  );
  if (!asset) return;
  try {
    const absolutePath = await ensureStoredFile(asset.storage_key);
    await query(
      `update jobs set status = 'running', progress = 15, error = null, updated_at = now()
       where asset_id = $1 and status in ('queued','running','failed')`,
      [asset.id]
    );
    if (asset.type === "image") await processImage(asset, absolutePath);
    else if (["document", "webpage", "ai_answer"].includes(asset.type)) await processUploadedDocument(asset, absolutePath);
    else throw new Error(`暂不支持处理 ${asset.type} 类型`);
    await query(`update assets set status = 'ready', error = null, updated_at = now() where id = $1`, [asset.id]);
    await query(`update jobs set status = 'ready', progress = 100, updated_at = now() where asset_id = $1 and status = 'running'`, [asset.id]);
    const owner = await one<User>(`select * from users where id = $1`, [asset.owner_id]);
    if (owner) await audit(owner, "asset.process.ready", "asset", asset.id, { workspaceId: asset.workspace_id, title: asset.title });
  } catch (error) {
    const message = asMessage(error);
    await query(`update assets set status = 'failed', error = $1, updated_at = now() where id = $2`, [message, asset.id]);
    await query(
      `update jobs set status = 'failed', progress = 0, error = $1, attempts = attempts + 1, updated_at = now()
       where asset_id = $2 and status in ('queued','running')`,
      [message, asset.id]
    );
    const owner = await one<User>(`select * from users where id = $1`, [asset.owner_id]);
    if (owner) await audit(owner, "asset.process.failed", "asset", asset.id, { workspaceId: asset.workspace_id, title: asset.title, error: message });
    throw error;
  }
}

export function scheduleAssetProcessing(assetId: string) {
  void enqueueAssetProcessing(assetId).catch(async (error) => {
    const message = error instanceof Error ? error.message : "任务队列不可用";
    await query(`update assets set status = 'failed', error = $1, updated_at = now() where id = $2`, [message, assetId]).catch(() => undefined);
    await query(`update jobs set status = 'failed', error = $1, attempts = attempts + 1, updated_at = now() where asset_id = $2 and status = 'queued'`, [message, assetId]).catch(() => undefined);
  });
}

export async function resumePendingAssetProcessing() {
  await query(
    `update assets asset set status = 'queued', error = '上次解析异常中断，已自动恢复', updated_at = now()
     where asset.status = 'indexing' and asset.updated_at < now() - interval '10 minutes'
       and exists (select 1 from jobs job where job.asset_id = asset.id)`
  );
  await query(
    `update jobs job set status = 'queued', progress = 0, error = null, updated_at = now()
     from assets asset where asset.id = job.asset_id and asset.status = 'queued' and job.status <> 'queued'`
  );
  const pending = await query<{ id: string }>(
    `select a.id from assets a
     join jobs j on j.asset_id = a.id
     where a.deleted_at is null and a.status = 'queued' and j.status = 'queued'
     group by a.id
     order by min(a.created_at) asc`
  );
  pending.forEach((asset) => scheduleAssetProcessing(asset.id));
  const workspaces = await query<{ tenant_id: string; workspace_id: string }>(
    `select distinct tenant_id, workspace_id from assets where deleted_at is null and status = 'ready'`
  );
  for (const workspace of workspaces) {
    await rebuildWorkspaceRelations(workspace.tenant_id, workspace.workspace_id);
  }
}

export async function retryAssetProcessing(asset: Asset) {
  await query(`update assets set status = 'queued', error = null, updated_at = now() where id = $1`, [asset.id]);
  const job = await one<{ id: string }>(`select id from jobs where asset_id = $1 order by created_at desc limit 1`, [asset.id]);
  if (job) {
    await query(`update jobs set status = 'queued', progress = 0, error = null, updated_at = now() where id = $1`, [job.id]);
  } else {
    await query(
      `insert into jobs (id, tenant_id, workspace_id, asset_id, type, status, progress)
       values ($1,$2,$3,$4,$5,'queued',0)`,
      [createId("job"), asset.tenant_id, asset.workspace_id, asset.id, asset.type === "image" ? "image-index" : "document-index"]
    );
  }
  scheduleAssetProcessing(asset.id);
}
