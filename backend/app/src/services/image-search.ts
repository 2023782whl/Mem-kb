import { query } from "../db/pool.js";
import type { Asset } from "../db/schema.js";
import { embedMultimodal, vectorLiteral } from "../providers/embedding.js";

export async function searchImagesByVector(tenantId: string, workspaceId: string, vector: number[]) {
  return query<Asset & { similarity: number }>(
    `select a.*, 1 - (ie.embedding <=> $3::vector) as similarity
     from image_embeddings ie join assets a on a.id = ie.asset_id
     where ie.tenant_id = $1 and ie.workspace_id = $2 and a.deleted_at is null and a.status = 'ready'
     order by ie.embedding <=> $3::vector limit 30`,
    [tenantId, workspaceId, vectorLiteral(vector)]
  );
}

export async function searchImagesByText(tenantId: string, workspaceId: string, text: string) {
  return searchImagesByVector(tenantId, workspaceId, await embedMultimodal({ text }));
}
