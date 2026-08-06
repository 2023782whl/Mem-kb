import crypto from "node:crypto";
import { env } from "../config/env.js";
import { query } from "../db/pool.js";
import type { Asset } from "../db/schema.js";
import { embedMultimodal, vectorLiteral } from "../providers/embedding.js";
import { Singleflight } from "../utils/singleflight.js";

const embeddingFlights = new Singleflight<number[]>();

function normalizeWorkspaceIds(workspaceIds: string | string[]) {
  return [...new Set(Array.isArray(workspaceIds) ? workspaceIds : [workspaceIds])].filter(Boolean);
}

function imageQueryHash(text: string) {
  return crypto.createHash("sha256").update(text.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex");
}

async function queryEmbedding(tenantId: string, text: string) {
  const hash = imageQueryHash(text);
  const cached = await query<{ embedding: string }>(
    `update query_embedding_cache_v2 set last_used_at=now()
     where tenant_id=$1 and query_hash=$2 and model_id=$3 returning embedding::text as embedding`,
    [tenantId, hash, env.embedding.multimodalModel]
  );
  if (cached[0]) return JSON.parse(cached[0].embedding) as number[];
  return embeddingFlights.run(`${tenantId}:${env.embedding.multimodalModel}:${hash}`, async () => {
    const embedding = await embedMultimodal({ text }, AbortSignal.timeout(8_000));
    await query(
      `insert into query_embedding_cache_v2 (tenant_id, query_hash, model_id, embedding)
       values ($1,$2,$3,$4::vector)
       on conflict (tenant_id, query_hash, model_id)
       do update set embedding=excluded.embedding, last_used_at=now()`,
      [tenantId, hash, env.embedding.multimodalModel, vectorLiteral(embedding)]
    );
    return embedding;
  });
}

export async function searchImagesByVector(tenantId: string, workspaceIds: string | string[], vector: number[]) {
  const scope = normalizeWorkspaceIds(workspaceIds);
  if (!scope.length) return [];
  return query<Asset & { similarity: number }>(
    `select a.*, 1 - (ie.embedding <=> $3::vector) as similarity
     from image_embeddings ie join assets a on a.id = ie.asset_id
     where ie.tenant_id = $1 and ie.workspace_id = any($2::text[]) and a.deleted_at is null and a.status = 'ready'
     order by ie.embedding <=> $3::vector limit 30`,
    [tenantId, scope, vectorLiteral(vector)]
  );
}

export async function searchImagesByText(tenantId: string, workspaceIds: string | string[], text: string) {
  const scope = normalizeWorkspaceIds(workspaceIds);
  if (!scope.length) return [];
  const lexical = await query<Asset & { similarity: number }>(
    `select a.*, greatest(similarity(a.title,$3), similarity(coalesce(a.summary,''),$3), similarity(coalesce(a.ocr_text,''),$3))::double precision as similarity
     from assets a where a.tenant_id=$1 and a.workspace_id=any($2::text[]) and a.type='image'
       and a.deleted_at is null and a.status='ready'
       and (a.title % $3 or coalesce(a.summary,'') % $3 or coalesce(a.ocr_text,'') % $3
         or a.title ilike '%' || $3 || '%' or coalesce(a.summary,'') ilike '%' || $3 || '%' or coalesce(a.ocr_text,'') ilike '%' || $3 || '%')
     order by similarity desc, a.updated_at desc limit 10`,
    [tenantId, scope, text]
  );
  if (lexical.length) return lexical;
  return searchImagesByVector(tenantId, scope, await queryEmbedding(tenantId, text));
}
