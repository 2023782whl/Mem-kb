import { pool, query } from "./pool.js";
import type { Asset } from "./schema.js";
import { rebuildWorkspaceRelations } from "../services/knowledge-indexer.js";
import { writeProcessedMarkdown } from "../services/storage.js";

async function main() {
  const assets = await query<Asset>(
    `select * from assets
     where deleted_at is null and status = 'ready' and processing_provider is null
     order by created_at asc`
  );
  for (const asset of assets) {
    if (asset.type === "image") {
      await query(
        `update assets set processing_provider = 'legacy-vlm', processing_version = 'migration-v1',
         processed_at = coalesce(updated_at, created_at), updated_at = now() where id = $1`,
        [asset.id]
      );
      continue;
    }
    if (!asset.extracted_text?.trim()) continue;
    const markdown = await writeProcessedMarkdown(asset.id, asset.extracted_text);
    await query(
      `update assets set markdown_storage_key = $1, processing_provider = 'legacy-content',
       processing_version = 'migration-v1', processed_at = coalesce(updated_at, created_at), updated_at = now()
       where id = $2`,
      [markdown.storageKey, asset.id]
    );
  }
  const workspaces = await query<{ tenant_id: string; workspace_id: string }>(
    `select distinct tenant_id, workspace_id from assets where deleted_at is null and status = 'ready'`
  );
  for (const workspace of workspaces) {
    await rebuildWorkspaceRelations(workspace.tenant_id, workspace.workspace_id);
  }
  const orphanNodes = await query<{ count: number }>(`select count(*)::int as count from graph_nodes where asset_id is null`);
  console.log(`Backfilled ${assets.length} assets; orphan graph nodes: ${orphanNodes[0]?.count || 0}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
