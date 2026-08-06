import { pool, query } from "./pool.js";
import type { Asset } from "./schema.js";
import { indexDocumentChunks } from "../services/document-retrieval.js";
import { logger } from "../utils/logger.js";

async function main() {
  const assets = await query<Asset>(
    `select a.* from assets a
     where a.deleted_at is null and a.status = 'ready' and a.type in ('document','webpage','ai_answer')
       and coalesce(a.extracted_text, '') <> ''
     order by a.created_at`
  );
  let indexed = 0;
  const failures: string[] = [];
  for (const asset of assets) {
    try {
      const count = await indexDocumentChunks(asset, asset.extracted_text!);
      indexed += count;
      logger.info({ title: asset.title, chunks: count }, "Asset indexed");
    } catch (error) {
      failures.push(asset.id);
      logger.error({ title: asset.title, error: error instanceof Error ? error.message : String(error) }, "Asset indexing failed");
    }
  }
  logger.info({
    success: assets.length - failures.length,
    total: assets.length,
    chunks: indexed
  }, "Embedding backfill complete");
  await pool.end();
  if (failures.length) process.exitCode = 1;
}

main().catch(async (error) => {
  logger.error({ error: error instanceof Error ? error.message : error }, "Embedding backfill failed");
  await pool.end().catch(() => undefined);
  process.exit(1);
});
