import { tx } from "../db/pool.js";
import type { Asset, AssetMedia } from "../db/schema.js";
import { deleteGBrainPage, putGBrainPage } from "./gbrain.js";
import { removeStoredFile } from "./storage.js";

export interface AssetDeletionResult {
  cleanupWarnings: string[];
  gbrainStatus: string | null;
}

function storedPaths(asset: Asset) {
  return [...new Set([asset.storage_key, asset.markdown_storage_key, asset.thumbnail_storage_key].filter(Boolean))] as string[];
}

async function removeStoredFiles(asset: Asset) {
  const warnings: string[] = [];
  for (const storageKey of storedPaths(asset)) {
    try {
      await removeStoredFile(storageKey);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : `无法删除 ${storageKey}`);
    }
  }
  return warnings;
}

export async function deleteKnowledgeAsset(asset: Asset): Promise<AssetDeletionResult> {
  let gbrainStatus: string | null = null;
  if (asset.gbrain_slug) {
    const result = await deleteGBrainPage(asset.gbrain_slug);
    gbrainStatus = result.status;
  }

  try {
    await tx(async (client) => {
      await client.query(`delete from graph_nodes where asset_id = $1`, [asset.id]);
      await client.query(`delete from asset_entities where asset_id = $1`, [asset.id]);
      await client.query(`delete from image_embeddings where asset_id = $1`, [asset.id]);
      await client.query(`delete from document_chunks where asset_id = $1`, [asset.id]);
      await client.query(`delete from retrieval_result_cache where tenant_id = $1 and workspace_id = $2`, [asset.tenant_id, asset.workspace_id]);
      await client.query(`delete from jobs where asset_id = $1`, [asset.id]);
      await client.query(
        `update assets set status = 'deleted', deleted_at = now(), updated_at = now() where id = $1`,
        [asset.id]
      );
    });
  } catch (error) {
    if (asset.gbrain_slug) {
      const fallback = asset.extracted_text || asset.summary || `# ${asset.title}`;
      await putGBrainPage(asset.gbrain_slug, fallback).catch(() => undefined);
    }
    throw error;
  }

  return { cleanupWarnings: [], gbrainStatus };
}

export async function purgeKnowledgeAsset(asset: Asset): Promise<AssetDeletionResult> {
  let gbrainStatus: string | null = null;
  if (asset.gbrain_slug) {
    const result = await deleteGBrainPage(asset.gbrain_slug).catch(() => null);
    gbrainStatus = result?.status || null;
  }
  const media = await tx(async (client) => {
    const mediaResult = await client.query<AssetMedia>(`select * from asset_media where asset_id = $1`, [asset.id]);
    await client.query(`update message_citations set asset_id = null where asset_id = $1`, [asset.id]);
    await client.query(`update capture_records set asset_id = null where asset_id = $1`, [asset.id]);
    await client.query(`delete from assets where id = $1`, [asset.id]);
    return mediaResult.rows;
  });
  const cleanupWarnings = await removeStoredFiles(asset);
  for (const item of media) {
    await removeStoredFile(item.storage_key).catch((error: unknown) => {
      cleanupWarnings.push(error instanceof Error ? error.message : `无法删除 ${item.storage_key}`);
    });
  }
  return { cleanupWarnings, gbrainStatus };
}
