import { pool, query } from "./pool.js";
import type { Asset } from "./schema.js";
import { indexKnowledgeAsset } from "../services/knowledge-indexer.js";

async function main() {
  const selector = process.argv[2]?.trim();
  const assets = selector
    ? await query<Asset>(
        `select * from assets
         where deleted_at is null and status = 'ready' and type <> 'image'
           and (id = $1 or title = $1)
         order by created_at`,
        [selector]
      )
    : await query<Asset>(
        `select * from assets
         where deleted_at is null and status = 'ready' and type <> 'image'
           and (cardinality(tags) <> 5 or metadata #>> '{analysis,version}' is distinct from 'document-analysis-v2')
         order by created_at`
      );

  for (const asset of assets) {
    const body = asset.extracted_text?.trim();
    if (!body) continue;
    const analysis = await indexKnowledgeAsset({
      asset,
      title: asset.title,
      body,
      sha256: asset.sha256,
      source: "aiteam-analysis-backfill"
    });
    console.log(`${asset.title}: ${analysis.tags.join("、")}`);
  }

  console.log(`Analyzed ${assets.length} assets.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
