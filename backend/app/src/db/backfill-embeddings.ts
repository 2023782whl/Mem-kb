import { pool, query } from "./pool.js";
import type { Asset } from "./schema.js";
import { indexDocumentChunks } from "../services/document-retrieval.js";

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
      console.log(`${asset.title}: ${count} chunks`);
    } catch (error) {
      failures.push(asset.id);
      console.error(`${asset.title}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`Embedding backfill complete: ${assets.length - failures.length}/${assets.length} assets, ${indexed} chunks`);
  await pool.end();
  if (failures.length) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
