import { one, query } from "../db/pool.js";
import type { AssetMedia } from "../db/schema.js";
import { env } from "../config/env.js";
import { mapWithConcurrency } from "../utils/concurrency.js";
import { describeImage } from "./model.js";
import type { MaterializedMedia } from "./document-media.js";

export interface MediaAnalysisResult {
  media: AssetMedia[];
  warnings: string[];
}

export async function analyzeDocumentMedia(items: MaterializedMedia[]): Promise<MediaAnalysisResult> {
  if (!env.documentProcessor.mediaAnalysisEnabled || !items.length) return { media: items, warnings: [] };
  const cache = await loadAnalysisCache(items);
  const analyzed = await mapWithConcurrency(items, env.documentProcessor.mediaAnalysisConcurrency, async (item) => {
    if (item.description || item.ocr_text) return { media: item };
    const cached = cache.get(item.sha256);
    if (cached) {
      const media = await one<AssetMedia>(
        `update asset_media set description = $1, ocr_text = $2,
         metadata = metadata || $3::jsonb, updated_at = now() where id = $4 returning *`,
        [cached.description, cached.ocr_text, JSON.stringify({ vision: cached.metadata.vision, analysisCache: cached.id }), item.id]
      );
      return { media: media || item };
    }
    try {
      const vision = await describeWithRetry(item);
      const media = await one<AssetMedia>(
        `update asset_media set description = $1, ocr_text = $2,
         metadata = metadata || $3::jsonb, updated_at = now() where id = $4 returning *`,
        [vision.summary, vision.ocr, JSON.stringify({ vision }), item.id]
      );
      return { media: media || item };
    } catch (error) {
      return {
        media: item,
        warning: `${item.alt_text || `图片 ${item.sequence + 1}`}：${error instanceof Error ? error.message : "VLM 分析失败"}`
      };
    }
  });
  return {
    media: analyzed.map((item) => item.media),
    warnings: analyzed.flatMap((item) => item.warning ? [item.warning] : [])
  };
}

async function loadAnalysisCache(items: MaterializedMedia[]) {
  const pending = items.filter((item) => !item.description && !item.ocr_text);
  if (!pending.length) return new Map<string, AssetMedia>();
  const rows = await query<AssetMedia>(
    `select distinct on (sha256) * from asset_media
     where tenant_id = $1 and sha256 = any($2::text[]) and not (id = any($3::text[]))
       and (description <> '' or ocr_text <> '')
     order by sha256, updated_at desc`,
    [pending[0].tenant_id, [...new Set(pending.map((item) => item.sha256))], pending.map((item) => item.id)]
  );
  return new Map(rows.map((item) => [item.sha256, item]));
}

async function describeWithRetry(item: MaterializedMedia) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await describeImage(item.absolutePath, item.mime_type, item.tenant_id);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
